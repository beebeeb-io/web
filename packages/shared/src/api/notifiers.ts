/**
 * Cross-cutting notifier hooks consumed by `request()`:
 *  - `notifyError`:        a toast surface for "could not reach server"
 *  - `onSessionExpired`:   global 401 handler (typically: hard-reload to /login)
 *  - `onConnectionStatus`: connectivity transitions (`flaky` ↔ `ok`)
 *
 * Apps register their handlers at startup. Shared code is decoupled from any
 * particular toast/router library.
 */

type ErrorNotifier = (message: string) => void
type SessionExpiredHandler = () => void
type ConnectionStatusHandler = (status: 'ok' | 'flaky') => void

let notifyError: ErrorNotifier | null = null
let onSessionExpired: SessionExpiredHandler | null = null
let onConnectionStatus: ConnectionStatusHandler | null = null

export function registerErrorNotifier(fn: ErrorNotifier): void {
  notifyError = fn
}

export function registerSessionExpiredHandler(fn: SessionExpiredHandler): void {
  onSessionExpired = fn
}

export function registerConnectionStatusHandler(fn: ConnectionStatusHandler): void {
  onConnectionStatus = fn
}

// Read-side accessors used by `request()`. Not part of the public surface.
export function fireErrorNotifier(message: string): void {
  notifyError?.(message)
}

export function fireSessionExpired(): void {
  onSessionExpired?.()
}

export function fireConnectionStatus(status: 'ok' | 'flaky'): void {
  onConnectionStatus?.(status)
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
