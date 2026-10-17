/**
 * Cross-cutting notifier hooks consumed by `request()`:
 *  - `notifyError`:        a toast surface for "could not reach server"
 *  - `onSessionExpired`:   global 401 handler (typically: hard-reload to /login)
 *  - `onAccountDeleted`:   global 403 `account_deleted` handler (task 1404) —
 *                          the SESSION/credentials were fine, the ACCOUNT is
 *                          gone (task 1403). Distinct from session expiry: an
 *                          app registers this to sign out + show the exact
 *                          "deleted on <date>… shredded on <date>…" copy,
 *                          from WHICHEVER call happens to surface it — not
 *                          just an initial boot request.
 *  - `onAccountSuspended`: global 403 `account_suspended` handler (task 1948) —
 *                          the session belongs to an account that is no longer
 *                          active; the app signs it out on this device.
 *  - `onConnectionStatus`: connectivity transitions (`flaky` ↔ `ok`)
 *
 * Apps register their handlers at startup. Shared code is decoupled from any
 * particular toast/router library.
 */

type ErrorNotifier = (message: string) => void
type SessionExpiredHandler = () => void
/**
 * Receives the full parsed 403 body (`{error, message, deleted_at,
 * shred_after}`) — this is the one error whose UI copy needs fields beyond
 * the `code` that `ApiError` already carries, so `request()` hands the raw
 * body straight to the registered handler instead of extending `ApiError`'s
 * shape for a single error type.
 */
type AccountDeletedHandler = (body: Record<string, unknown>) => void
type ConnectionStatusHandler = (status: 'ok' | 'flaky') => void
/**
 * Task 1948 (1c): fired on a 403 `account_suspended` — the session belongs to
 * an account that is suspended or disabled. Like `account_deleted`, the app
 * signs the login out on this device; unlike it, the body carries nothing the
 * copy needs (and the copy never says why the account is not active).
 *
 * The handler receives the {@link AuthStamp} captured when the refused request
 * was ISSUED (web#169 review, Codex P1): a request sent under login A that only
 * answers after login B became current must not sign B out. The handler compares
 * it with {@link isCurrentAuthStamp} before it does anything.
 */
type AccountSuspendedHandler = (stamp: AuthStamp) => void
/**
 * Task 1531 (web #85 round 2) / server task 1554: fired on a 409
 * `account_mismatch` — the server rejected a mutating request because the
 * `X-Beebeeb-Expected-User` header (the resident key's bound account) did
 * not match the session's actual authenticated user. This can only happen
 * from genuine cross-account key confusion (the exact bug task 1531 closes)
 * or a stale header from a just-switched account — either way the safe
 * response is the same: drop the resident key and route to login so the
 * REAL current account's key gets (re-)established cleanly.
 */
type AccountMismatchHandler = () => void

let notifyError: ErrorNotifier | null = null
let onSessionExpired: SessionExpiredHandler | null = null
let onAccountDeleted: AccountDeletedHandler | null = null
let onAccountSuspended: AccountSuspendedHandler | null = null
let onConnectionStatus: ConnectionStatusHandler | null = null
let onAccountMismatch: AccountMismatchHandler | null = null

export function registerErrorNotifier(fn: ErrorNotifier): void {
  notifyError = fn
}

export function registerSessionExpiredHandler(fn: SessionExpiredHandler): void {
  onSessionExpired = fn
}

export function registerAccountDeletedHandler(fn: AccountDeletedHandler): void {
  onAccountDeleted = fn
}

export function registerAccountSuspendedHandler(fn: AccountSuspendedHandler | null): void {
  onAccountSuspended = fn
}

export function registerConnectionStatusHandler(fn: ConnectionStatusHandler): void {
  onConnectionStatus = fn
}

export function registerAccountMismatchHandler(fn: AccountMismatchHandler): void {
  onAccountMismatch = fn
}

// Read-side accessors used by `request()`. Not part of the public surface.
export function fireErrorNotifier(message: string): void {
  notifyError?.(message)
}

export function fireSessionExpired(): void {
  onSessionExpired?.()
}

export function fireAccountDeleted(body: Record<string, unknown>): void {
  onAccountDeleted?.(body)
}

export function fireAccountSuspended(stamp: AuthStamp): void {
  onAccountSuspended?.(stamp)
}

export function fireConnectionStatus(status: 'ok' | 'flaky'): void {
  onConnectionStatus?.(status)
}

export function fireAccountMismatch(): void {
  onAccountMismatch?.()
}

// ── Session-presence tracking (task 0741) ──────────────────────────────────
// A 401 must only be treated as session EXPIRY (→ global handler → /login) when
// a session plausibly existed: a bearer token OR a confirmed authenticated
// response earlier this page-load. An anonymous visitor on a public route
// (/s/:token, /r/:token, …) whose unconditional boot getMe() 401s must NOT be
// bounced to /login. Apps call `markSessionConfirmed()` on a successful auth
// check (e.g. getMe); `request()` reads `wasSessionConfirmed()` before firing.
// Module-level = scoped to this page-load (resets on reload), the exact window.
let sessionConfirmed = false

export function markSessionConfirmed(): void {
  sessionConfirmed = true
}

export function clearSessionConfirmed(): void {
  sessionConfirmed = false
}

export function wasSessionConfirmed(): boolean {
  return sessionConfirmed
}

// ── Login stamp (task 1948, web#169 review) ────────────────────────────────
// Which login a request belonged to when it was ISSUED. `request()` captures
// `getAuthStamp()` before it sends anything, and hands that stamp to the
// account_suspended handler with the 403. A refusal only applies to the login
// it was issued under: when a newer login became current in between (this tab
// signed in again, another tab signed in on the shared cookie jar, or the dead
// login was already signed out), the stamp is stale and the 403 is ignored.
//
// `generation` is per tab (module state = this page load) and changes whenever
// the tab's login may have changed: the app calls `setAuthIdentity()` whenever
// its signed-in user changes, and `bumpAuthGeneration()` when a new login
// starts, a sign-out happens, or another tab reports a login. `userId` is the
// account this tab believed it was signed in as (null when it did not know,
// e.g. the boot `getMe()` itself was refused); it is the only part another tab
// can compare with its own login.
export interface AuthStamp {
  generation: number
  userId: string | null
}

let authGeneration = 0
let authUserId: string | null = null

export function getAuthStamp(): AuthStamp {
  return { generation: authGeneration, userId: authUserId }
}

/** Anything issued before this belongs to an earlier login. */
export function bumpAuthGeneration(): void {
  authGeneration += 1
}

/** The tab's signed-in account changed (null = signed out / unknown). */
export function setAuthIdentity(userId: string | null): void {
  if (userId === authUserId) return
  authUserId = userId
  authGeneration += 1
}

/** True only when no login change happened since `stamp` was captured. */
export function isCurrentAuthStamp(stamp: AuthStamp): boolean {
  return stamp.generation === authGeneration
}
