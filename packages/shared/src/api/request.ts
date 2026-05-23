/**
 * Authenticated HTTP request helper.
 *
 * Mirrors the helper that previously lived in repos/web/src/lib/api.ts:
 *  - JSON-by-default (`Content-Type: application/json`).
 *  - Sends `credentials: 'include'` so the browser attaches the httpOnly
 *    `bb_session` cookie (task 0447) on every cross-origin API call AND
 *    accepts Set-Cookie headers back from the server.
 *  - Falls back to `Authorization: Bearer <token>` from `getToken()` when a
 *    legacy localStorage token still exists. After `upgrade-session` runs
 *    once at app startup, the localStorage half is gone and the cookie does
 *    all the work.
 *  - Single retry on raw network failure (no retry on HTTP error responses).
 *  - Surfaces "flaky" connection state after CONNECTION_FAILURE_THRESHOLD
 *    consecutive failures and clears the flag on the first success.
 *  - On 401 with an authenticated request: clears the token and triggers the
 *    registered session-expired handler. Unauthenticated 401s (e.g. wrong-
 *    password login) fall through so the caller sees the actual server
 *    message instead of misleading "session expired" copy.
 *
 * Apps should `setApiUrl(...)` once at startup before calling `request()`.
 */

import { ApiError } from './errors'
import { getApiUrl } from './config'
import { clearToken, getToken } from './token'
import {
  fireConnectionStatus,
  fireErrorNotifier,
  fireSessionExpired,
} from './notifiers'

const CONNECTION_FAILURE_THRESHOLD = 2
const RETRY_DELAY_MS = 800

let consecutiveFailures = 0
let lastReported: 'ok' | 'flaky' = 'ok'

function reportConnection(status: 'ok' | 'flaky'): void {
  if (status === lastReported) return
  lastReported = status
  fireConnectionStatus(status)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const apiUrl = getApiUrl()
  // `credentials: 'include'` is what makes the httpOnly bb_session cookie
  // travel on cross-origin requests (web app on app.beebeeb.io → API on
  // api.beebeeb.io). It also lets the server's Set-Cookie response headers
  // actually land in the browser's jar. The server sets
  // Access-Control-Allow-Credentials: true to match (task 0447).
  const init: RequestInit = { ...options, headers, credentials: 'include' }

  let res: Response
  try {
    res = await fetch(`${apiUrl}${path}`, init)
  } catch (_first) {
    await delay(RETRY_DELAY_MS)
    try {
      res = await fetch(`${apiUrl}${path}`, init)
    } catch (_second) {
      consecutiveFailures += 1
      if (consecutiveFailures >= CONNECTION_FAILURE_THRESHOLD) {
        reportConnection('flaky')
      }
      const message = 'Could not reach the server. Check your connection and try again.'
      fireErrorNotifier(message)
      throw new ApiError(message, 0)
    }
  }

  // Got a response — connection is fine even if the response is an error.
  consecutiveFailures = 0
  reportConnection('ok')

  if (res.status === 401) {
    // With cookie auth we can't observe "the cookie is present" from JS, so
    // we treat any 401 on a path that's normally protected as a session
    // expiry. The legacy `if (token)` guard stays for the localStorage
    // migration window — once everyone is cookie-only it becomes a no-op
    // but the fireSessionExpired() path still runs and bounces the user
    // back to /login.
    if (token) {
      clearToken()
    }
    fireSessionExpired()
    throw new ApiError('Session expired', 401)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<T>
}
