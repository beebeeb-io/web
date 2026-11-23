/**
 * Generic 429 backoff for API-origin requests (rate-limit proposal, step 8, web).
 *
 * Installed once at app start as a wrapper of `window.fetch`. On a 429 it waits
 * max(Retry-After, body.retry_after) + 0-25 % jitter, then retries an idempotent
 * request (GET, HEAD, PUT) at most 4 times. While a wait is active, every API
 * request from this tab waits for it (no herd). A Retry-After above 60 s, or
 * `error: "banned"`, is a policy refusal: the 429 is returned at once (the server's
 * `error` code kept, plus `policy: true`), the tab pauses for min(wait, 60 s) and
 * answers further requests locally with the same refusal until then.
 * `server_busy` keeps its own path (server-busy-retry.ts) and passes through.
 */
import { SERVER_BUSY_CODE, secondsFrom, sleepAbortable } from './server-busy-retry'

export const RATE_LIMIT_MAX_RETRIES = 4
/** A longer Retry-After is a policy refusal, not a wait. */
export const RATE_LIMIT_POLICY_SECONDS = 60
export const BANNED_CODE = 'banned'
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT'])

let pauseUntil = 0

/** Test hook: clear the tab-wide pause. */
export function resetRateLimitPause(): void {
  pauseUntil = 0
  refusal = null
}

/** Seconds to wait: max(header, body) with 0-25 % jitter added. */
export function rateLimitWaitMs(
  headerValue: string | null,
  bodyValue: unknown,
  random: () => number = Math.random,
): number {
  const base = Math.max(secondsFrom(headerValue) ?? 0, secondsFrom(bodyValue) ?? 0, 1)
  return Math.round(base * 1000 * (1 + 0.25 * random()))
}

function abortError(): Error {
  return new DOMException('Cancelled', 'AbortError')
}

async function waitForPause(signal?: AbortSignal | null): Promise<void> {
  for (;;) {
    const left = pauseUntil - Date.now()
    if (left <= 0) return
    await sleepAbortable(left, signal ?? undefined)
  }
}

function isApiRequest(input: RequestInfo | URL, apiOrigin: string): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(url, globalThis.location?.href ?? apiOrigin).origin === apiOrigin
  } catch {
    return false
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
}

/** A refusal: keep the server's `error` code, mark it with a separate `policy: true`. */
function policyResponse(headers: Headers, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ...body, policy: true }), { status: 429, headers })
}

/** The last refusal, replayed locally until its pause ends. */
let refusal: { until: number; body: Record<string, unknown> } | null = null

function localRefusal(): Response | null {
  if (!refusal) return null
  const left = refusal.until - Date.now()
  if (left <= 0) {
    refusal = null
    return null
  }
  return policyResponse(new Headers({ 'Retry-After': String(Math.ceil(left / 1000)) }), refusal.body)
}

export interface BackoffOptions {
  apiOrigin: string
  random?: () => number
}

/** Wrap a fetch implementation; non-API origins pass straight through. */
export function withRateLimitBackoff(base: typeof fetch, opts: BackoffOptions): typeof fetch {
  const random = opts.random ?? Math.random
  return async (input, init) => {
    if (!isApiRequest(input, opts.apiOrigin)) return base(input, init)
    const signal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : null)
    const retryable =
      IDEMPOTENT.has(methodOf(input, init)) && !(init?.body instanceof ReadableStream)
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError()
      const local = localRefusal()
      if (local) return local
      await waitForPause(signal)
      const res = await base(input, init)
      if (res.status !== 429) return res
      let body: Record<string, unknown> = {}
      try {
        body = ((await res.clone().json()) as Record<string, unknown>) ?? {}
      } catch {
        /* header-only 429 */
      }
      if (body.error === SERVER_BUSY_CODE) return res
      const header = res.headers.get('Retry-After')
      const seconds = Math.max(secondsFrom(header) ?? 0, secondsFrom(body.retry_after) ?? 0)
      if (body.error === BANNED_CODE || seconds > RATE_LIMIT_POLICY_SECONDS) {
        const until = Date.now() + Math.min(Math.max(seconds, 1), RATE_LIMIT_POLICY_SECONDS) * 1000
        pauseUntil = Math.max(pauseUntil, until)
        refusal = { until, body }
        return policyResponse(res.headers, body)
      }
      const waitMs = rateLimitWaitMs(header, body.retry_after, random)
      pauseUntil = Math.max(pauseUntil, Date.now() + waitMs)
      if (!retryable || attempt >= RATE_LIMIT_MAX_RETRIES) return res
    }
  }
}

/** Install once at app start. */
export function installRateLimitBackoff(apiOrigin: string): void {
  const g = globalThis as { fetch: typeof fetch; __bbRateLimitInstalled?: boolean }
  if (g.__bbRateLimitInstalled) return
  g.__bbRateLimitInstalled = true
  g.fetch = withRateLimitBackoff(g.fetch.bind(globalThis), { apiOrigin })
}
