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
