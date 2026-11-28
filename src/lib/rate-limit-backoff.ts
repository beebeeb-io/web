/**
 * Generic 429 backoff for API-origin requests (rate-limit-backoff epic, Client pause rule).
 *
 * Installed once at app start as a wrapper of `window.fetch`. On a 429 it starts a
 * pause of `rateLimitWaitMs`: the 2 s floor doubling per 429 in a row up to 60 s, or
 * the server's hint (max of Retry-After and body.retry_after) when longer, plus
 * 0-25 % jitter. The numbers mirror core's `rate_limit_wait_ms` (retry.rs). A 429
 * that arrives while a pause runs does not start or double a new one, and the
 * streak resets on the first non-429 answer. Only a GET, a HEAD, or a write that
 * carries an Idempotency-Key header is sent again, at most 4 times; any other request
 * gets its 429 back. Every API request waits for a running pause before it is sent.
 * (The epic's rule also names OPTIONS: preflights are the browser's and never pass here.)
 *
 * The pause is shared by every tab of the origin over a BroadcastChannel: each tab
 * takes max(own, received), so a 429 in one tab holds all of them. Without
 * BroadcastChannel the pause is per tab.
 *
 * A Retry-After above 60 s, or `error: "banned"`, is a policy refusal: the 429 is
 * returned at once (the server's `error` code kept, plus `policy: true`), the tabs
 * pause for min(wait, 60 s) and answer further requests locally with the same
 * refusal until then.
 * `server_busy` keeps its own path (server-busy-retry.ts) and passes through.
 */
import { SERVER_BUSY_CODE, secondsFrom, sleepAbortable } from './server-busy-retry'

export const RATE_LIMIT_MAX_RETRIES = 4
/** A longer Retry-After is a policy refusal, not a wait. */
export const RATE_LIMIT_POLICY_SECONDS = 60
/** Core: RATE_LIMIT_WAIT_FLOOR_MS, RATE_LIMIT_WAIT_CAP_MS, CLIENT_429_WAIT_JITTER_PERCENT. */
export const RATE_LIMIT_WAIT_FLOOR_MS = 2_000
export const RATE_LIMIT_WAIT_CAP_MS = 60_000
const JITTER_PERCENT = 25
export const BANNED_CODE = 'banned'
export const RATE_LIMIT_CHANNEL = 'bb-rate-limit'
/** Safe to send again without a key. */
const SAFE_METHODS = new Set(['GET', 'HEAD'])
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

type Refusal = { until: number; body: Record<string, unknown> }
/** What one tab tells the others: its pause, its streak, and a refusal while one is active. */
type PauseMessage = { until: number; streak: number; refusal?: Refusal }

let pauseUntil = 0
/** 429s in a row for the tab group; 0 before the first. */
let streak = 0
/** The last refusal, replayed locally until its pause ends. */
let refusal: Refusal | null = null

/** Test hook: clear the pause, the streak and the refusal. */
export function resetRateLimitPause(): void {
  pauseUntil = 0
  streak = 0
  refusal = null
}

/**
 * Milliseconds to pause after a 429. `streak` is 0 for the first 429 of a run:
 * max(min(2 s << streak, 60 s), hint) with 0-25 % jitter added.
 */
export function rateLimitWaitMs(
  streak: number,
  headerValue: string | null,
  bodyValue: unknown,
  random: () => number = Math.random,
): number {
  const doublings = Math.min(Math.max(Math.trunc(streak) || 0, 0), 16)
  const floor = Math.min(RATE_LIMIT_WAIT_FLOOR_MS * 2 ** doublings, RATE_LIMIT_WAIT_CAP_MS)
  const hint = Math.max(secondsFrom(headerValue) ?? 0, secondsFrom(bodyValue) ?? 0) * 1000
  const base = Math.max(floor, hint)
  const permille = Math.min(Math.max(Math.floor(random() * 1001), 0), 1000)
  return base + Math.floor((base * JITTER_PERCENT * permille) / 100_000)
}

let channel: BroadcastChannel | null | undefined

/** The longest pause another tab can ask for: a full wait or refusal plus jitter. */
const MAX_SHARED_PAUSE_MS = RATE_LIMIT_WAIT_CAP_MS * (1 + JITTER_PERCENT / 100)

function onPauseMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const msg = data as Partial<PauseMessage>
  if (typeof msg.until !== 'number' || !Number.isFinite(msg.until)) return
  const latest = Date.now() + MAX_SHARED_PAUSE_MS
  pauseUntil = Math.max(pauseUntil, Math.min(msg.until, latest))
  if (typeof msg.streak === 'number' && msg.streak >= 0) streak = Math.trunc(msg.streak)
  const r = msg.refusal
  if (r && typeof r.until === 'number' && Number.isFinite(r.until) && r.body && typeof r.body === 'object') {
    refusal = { until: Math.min(r.until, latest), body: r.body }
  }
}

/** Open the channel on first use; null when the browser has none. */
function sharedChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  channel = null
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(RATE_LIMIT_CHANNEL)
      channel.onmessage = (e) => onPauseMessage(e.data)
      // Outside a browser (tests), an open channel must not keep the process alive.
      ;(channel as { unref?: () => void }).unref?.()
    }
  } catch {
    channel = null
  }
  return channel
}

function share(withRefusal = false): void {
  try {
    const msg: PauseMessage = { until: pauseUntil, streak }
    if (withRefusal && refusal) msg.refusal = refusal
    sharedChannel()?.postMessage(msg)
  } catch {
    /* a closed channel or an uncloneable body: the pause stays per tab */
  }
}

function abortError(): Error {
  return new DOMException('Cancelled', 'AbortError')
}

async function waitForPause(clock: Clock, signal?: AbortSignal | null): Promise<void> {
  for (;;) {
    const left = pauseUntil - clock.now()
    if (left <= 0) return
    await clock.sleep(left, signal ?? undefined)
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

/** True when the request carries a non-empty Idempotency-Key; `init.headers` replaces a Request's own. */
function hasIdempotencyKey(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const headers =
      init?.headers !== undefined
        ? new Headers(init.headers)
        : typeof input === 'object' && 'headers' in input
          ? input.headers
          : null
    return !!headers?.get(IDEMPOTENCY_KEY_HEADER)?.trim()
  } catch {
    return false
  }
}

/** A refusal: keep the server's `error` code, mark it with a separate `policy: true`. */
function policyResponse(headers: Headers, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ...body, policy: true }), { status: 429, headers })
}

function localRefusal(now: number): Response | null {
  if (!refusal) return null
  const left = refusal.until - now
  if (left <= 0) {
    refusal = null
    return null
  }
  return policyResponse(new Headers({ 'Retry-After': String(Math.ceil(left / 1000)) }), refusal.body)
}

export interface BackoffOptions {
  apiOrigin: string
  random?: () => number
  /** Test hooks: a clock and a sleep to run the waits without real time. */
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

type Clock = { now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void> }

/** Wrap a fetch implementation; non-API origins pass straight through. */
export function withRateLimitBackoff(base: typeof fetch, opts: BackoffOptions): typeof fetch {
  const random = opts.random ?? Math.random
  const clock: Clock = { now: opts.now ?? Date.now, sleep: opts.sleep ?? sleepAbortable }
  sharedChannel()
  return async (input, init) => {
    if (!isApiRequest(input, opts.apiOrigin)) return base(input, init)
    const signal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : null)
    // A streamed body cannot be sent twice, key or not.
    const retryable =
      (SAFE_METHODS.has(methodOf(input, init)) || hasIdempotencyKey(input, init)) &&
      !(init?.body instanceof ReadableStream)
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError()
      const local = localRefusal(clock.now())
      if (local) return local
      await waitForPause(clock, signal)
      const res = await base(input, init)
      if (res.status !== 429) {
        if (streak !== 0) {
          streak = 0
          share()
        }
        return res
      }
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
        const until = clock.now() + Math.min(Math.max(seconds, 1), RATE_LIMIT_POLICY_SECONDS) * 1000
        pauseUntil = Math.max(pauseUntil, until)
        refusal = { until, body }
        share(true)
        return policyResponse(res.headers, body)
      }
      // A 429 that arrives while a pause runs does not start or double a new one.
      const now = clock.now()
      if (pauseUntil <= now) {
        pauseUntil = now + rateLimitWaitMs(streak, header, body.retry_after, random)
        streak++
        share()
      }
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
