/**
 * Post-login redirect safety.
 *
 * The login flow honours a `?next=` parameter so that an auth bounce can return
 * the user to where they were headed — most importantly the CLI device-auth
 * round-trip, which lands on `/cli-auth?code=…`. That parameter is attacker-
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
 *  string (`?code=…`) is preserved, but the path itself cannot vary.
 *  - `/`                — Drive root; carries `?folder=<id>` so a copied deep-link
 *    URL resumes at the exact vault location after login (task 0839). Same-origin
 *    own root → no open-redirect risk; only the query varies, never the path.
 *  - `/cli-auth`        — CLI device-auth round-trip.
 *  - `/settings/privacy`— data-export resume (`DATA_EXPORT_ROUTE`, task 0720);
 *    a same-origin protected route, so no open-redirect risk in allowlisting it. */
export const REDIRECT_ALLOWLIST = ['/', '/cli-auth', '/settings/privacy'] as const

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
  // Rejects absolute URLs ("https://evil", "javascript:…"), protocol-relative
  // ("//evil.com"), and backslash smuggling ("/\evil.com" — browsers normalise
  // "\" to "/"), plus bare values like "evil.com".
  if (raw[0] !== '/') return null
  if (raw[1] === '/' || raw[1] === '\\') return null

  if (CONTROL_CHARS.test(raw)) return null

  // The pathname is everything before the query/fragment, and it must match an
  // allowlisted route EXACTLY — so "/cli-auth/../admin" and "/cli-auth-evil"
  // are rejected while "/cli-auth?code=AB12-CD34" is accepted.
  const pathname = raw.split(/[?#]/)[0]
  if (!(REDIRECT_ALLOWLIST as readonly string[]).includes(pathname)) return null

  return raw
}
