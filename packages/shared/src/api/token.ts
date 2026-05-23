/**
 * Auth token storage.
 *
 * As of task 0447 (sessionToken plaintext in localStorage) the web client no
 * longer relies on localStorage for the session token — the server sets a
 * `bb_session` httpOnly cookie that JS cannot read, so XSS can no longer
 * exfiltrate it. The cookie travels automatically on every fetch as long as
 * the request opts in via `credentials: 'include'`.
 *
 * We still keep a thin localStorage layer for two reasons:
 *
 *   1. **Backwards-compat migration.** Existing logged-in users have a token
 *      in localStorage. On app load we hand it to `POST /auth/upgrade-session`
 *      which sets the cookie, then we clear localStorage. After that single
 *      hop they're cookie-only.
 *   2. **CLI handoff.** The `/cli-auth` page needs the raw session token so
 *      it can encrypt it for the CLI device. With cookies that token is no
 *      longer reachable from JS, so the page calls
 *      `GET /auth/session-token` to fetch it from the server. We cache the
 *      result in memory only — it never goes back into localStorage.
 *
 * `tokenStorageKey` is still configurable so the admin portal (which mounts
 * the same shared code at admin.beebeeb.io) can use its own `bb_admin_session`
 * slot without colliding.
 */

let tokenStorageKey: string = 'bb_session'
let onTokenCleared: (() => void) | null = null

export function setTokenStorageKey(key: string): void {
  tokenStorageKey = key
}

export function registerOnTokenCleared(cb: () => void): void {
  onTokenCleared = cb
}

/**
 * Read the legacy localStorage session token. Returns null when the cookie
 * migration has completed (the cookie is httpOnly so we cannot observe it
 * directly from JS — callers should not treat a null result as "logged out",
 * just as "no localStorage token to migrate or attach to a Bearer fetch").
 */
export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(tokenStorageKey)
}

/**
 * Persist a session token to localStorage.
 *
 * Web flows should no longer call this — the server sets the cookie
 * automatically on login/signup/2FA-verify. We keep the function so admin,
 * cli-auth, and any tooling that explicitly wants a Bearer token can still
 * use it, and so the Tauri shell can pre-seed a session before the WebView
 * boots. Calling it on web is a no-op security-wise (cookie still wins).
 */
export function setToken(token: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(tokenStorageKey, token)
}

/**
 * Wipe any localStorage token AND ask the server to clear the cookie.
 *
 * The server side of logout already issues `Set-Cookie: bb_session=; Max-Age=0`
 * — this function deletes the localStorage half so a partial-logout flow
 * (e.g. clearToken called outside the normal logout path) can't leave a
 * stale token behind.
 */
export function clearToken(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(tokenStorageKey)
  }
  try {
    onTokenCleared?.()
  } catch {
    // Never let a post-clear callback failure mask the actual logout.
  }
}
