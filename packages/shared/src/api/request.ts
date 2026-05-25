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
const RATE_LIMIT_MAX_RETRIES = 3
const RATE_PACE_THRESHOLD = 0.2

let consecutiveFailures = 0
let lastReported: 'ok' | 'flaky' = 'ok'

let rateLimitRemaining: number | null = null
let rateLimitLimit: number | null = null
let rateLimitReset: number | null = null

function updateRateLimitState(res: Response): void {
  const remaining = res.headers.get('x-ratelimit-remaining')
  const limit = res.headers.get('x-ratelimit-limit')
  const reset = res.headers.get('x-ratelimit-reset')
  if (remaining !== null) rateLimitRemaining = parseInt(remaining, 10)
  if (limit !== null) rateLimitLimit = parseInt(limit, 10)
  if (reset !== null) rateLimitReset = parseInt(reset, 10)
}

async function paceIfNeeded(): Promise<void> {
  if (rateLimitRemaining === null || rateLimitLimit === null || rateLimitReset === null) return
  if (rateLimitLimit === 0) return
  const ratio = rateLimitRemaining / rateLimitLimit
  if (ratio > RATE_PACE_THRESHOLD) return
  const now = Math.floor(Date.now() / 1000)
  const secsUntilReset = Math.max(1, rateLimitReset - now)
  const requestsLeft = Math.max(1, rateLimitRemaining)
  const paceMs = Math.min(5000, Math.floor((secsUntilReset / requestsLeft) * 1000))
  if (paceMs > 50) await delay(paceMs)
}

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

  await paceIfNeeded()

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
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

    consecutiveFailures = 0
    reportConnection('ok')
    updateRateLimitState(res)

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10)
      if (attempt < RATE_LIMIT_MAX_RETRIES) {
        await delay(retryAfter * 1000)
        continue
      }
      throw new ApiError('Rate limited — please wait a moment and try again', 429, 'rate_limit_exceeded')
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
      const code = typeof body.error === 'string' ? body.error : undefined
      const message = (body.message ?? body.error ?? res.statusText) as string

      if (res.status === 401) {
        if (code === 'opaque_ksf_outdated') {
          throw new ApiError(message, 401, code)
        }
        if (token) {
          clearToken()
        }
        fireSessionExpired()
        throw new ApiError('Session expired', 401, code)
      }

      throw new ApiError(message, res.status, code)
    }

    return res.json() as Promise<T>
  }

  throw new ApiError('Rate limited — please wait a moment and try again', 429, 'rate_limit_exceeded')
}
