/**
 * Post-login redirect safety.
 *
 * The login flow honours a `?next=` parameter so that an auth bounce can return
 * the user to where they were headed — most importantly the CLI device-auth
 * round-trip, which lands on `/cli-auth`. That parameter is attacker-
 * influenceable (it travels in the URL), so it MUST be validated before we ever
 * `navigate()` to it, or it becomes an open-redirect.
 *
 * The policy is deliberately strict: only same-origin RELATIVE paths whose
 * pathname is on {@link REDIRECT_ALLOWLIST} are accepted. Everything else —
 * absolute URLs, protocol-relative URLs, backslash-smuggled hosts, control
 * characters, or non-allowlisted paths — returns `null`, and the caller falls
 * back to `/`. Widening the set of post-login destinations is a deliberate edit
 * to the allowlist, not an accident.
 */

/** Exact pathnames a post-login redirect may target. Match is exact: the query
 *  string (`?folder=…`) is preserved, but the path itself cannot vary. (A
 *  `?code=` on `/cli-auth` is also preserved - it is only ever IGNORED by that
 *  page, which warns about it: a device code is typed, never taken from a link.)
 *  - `/`                — Drive root; carries `?folder=<id>` so a copied deep-link
 *    URL resumes at the exact vault location after login (task 0839). Same-origin
 *    own root → no open-redirect risk; only the query varies, never the path.
 *  - `/cli-auth`        — CLI device-auth round-trip.
 *  - `/settings/privacy`— data-export resume (`DATA_EXPORT_ROUTE`, task 0720);
 *    a same-origin protected route, so no open-redirect risk in allowlisting it.
 *  - `/settings/billing`— the public "return to the app" page links here (task 1743);
 *    a person with no web session signs in and lands on Billing instead of the Drive
 *    root. Same-origin protected route, exact path match, so no open-redirect risk. */
export const REDIRECT_ALLOWLIST = ['/', '/cli-auth', '/settings/privacy', '/settings/billing'] as const

/** `/c/<code>`, exactly: no further segment, only the code alphabet (task 1814). */
const COUPON_PATH = /^\/c\/[A-Za-z0-9_-]{3,64}$/

/** Control characters (C0 range + DEL) — illegal in a path and a classic
 *  redirect/header-smuggling vector. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

/**
 * Validate an internal post-login redirect target.
 *
 * @param raw - The `next` value, expected ALREADY percent-decoded (react-router's
 *   `useSearchParams().get('next')` decodes once for us — we deliberately do NOT
 *   decode again, so a literal `%` in a value can't be re-interpreted).
 * @returns The safe path to navigate to (path + query), or `null` when `raw` is
 *   missing or fails any check.
 */
export function sanitizeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null

  // Must be a plain relative path: exactly one leading "/" then a path char.
  // Rejects an absolute URL (a scheme such as "https:" or "javascript:"
  // followed by "://"), a protocol-relative host (a leading double slash),
  // and backslash smuggling (a leading "/\" — browsers normalise "\" to
  // "/"), plus a bare hostname with no leading slash at all.
  if (raw[0] !== '/') return null
  if (raw[1] === '/' || raw[1] === '\\') return null

  if (CONTROL_CHARS.test(raw)) return null

  // The pathname is everything before the query/fragment, and it must match an
  // allowlisted route EXACTLY — so "/cli-auth/../admin" and "/cli-auth-evil"
  // are rejected while "/cli-auth?x=1" is accepted.
  const pathname = raw.split(/[?#]/)[0]
  // Task 1814: a coupon link (`/c/<code>`) is the one allowlisted shape that varies, so
  // someone who opens a link while signed out can sign in and land back on it. The code
  // alphabet is fixed, so no traversal or host can ride along.
  if (!(REDIRECT_ALLOWLIST as readonly string[]).includes(pathname) && !COUPON_PATH.test(pathname)) return null

  // `/settings/billing` is the one allowlisted path whose query is NOT preserved: that page
  // reads `?success=true` / `?upgraded=true` as "a checkout just completed", so a crafted
  // `/login?next=/settings/billing?success=true` must not be able to forge it (task 1743, round 3).
  if (pathname === '/settings/billing') return pathname

  return raw
}
