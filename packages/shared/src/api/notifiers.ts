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
