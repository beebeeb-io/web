import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { initSync } from 'beebeeb-wasm'
import {
  parseRetryAfter as wasmParseRetryAfter,
  retryDecide,
  retryDelayMs,
  retryJitteredDelayMs,
  retryPolicy,
} from 'beebeeb-wasm'
import {
  decideRetry,
  parseRetryAfterHeader,
  type RetryPolicy,
} from '../packages/shared/src/api/retry'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// request() must not touch localStorage.
await mockModuleScoped('../packages/shared/src/api/token', import.meta.dir, {
  getToken: () => null,
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
})

let policy: RetryPolicy

beforeAll(() => {
  initSync({ module: readFileSync('packages/beebeeb-wasm/beebeeb_wasm_bg.wasm') })
  policy = retryPolicy() as RetryPolicy
})

// The vector `test-vectors/consolidation/retry.json` (core 8b6446c), case for
// case: the ladder, the jitter bounds, the decision table and `Retry-After`
// parsing. Core is the only place these rules live; the transport below only
// decides how many tries it is willing to make.

describe('retry vector (one backoff policy)', () => {
  it('the ladder: 500 ms doubling to a 30 s cap, retry 0 is 0 ms', async () => {
    const ladder: Array<[number, number]> = [
      [0, 0],
      [1, 500],
      [2, 1000],
      [3, 2000],
      [4, 4000],
      [5, 8000],
      [6, 16000],
      [7, 30000],
    ]
    for (const [retry, ms] of ladder) {
      expect(retryDelayMs(policy, retry)).toBe(ms)
    }
    // The shipped policy itself: six requests in all, 500 ms base, 30 s cap.
    expect(policy).toEqual({ max_attempts: 6, base_ms: 500, cap_ms: 30000, jitter: 'none' })
  })

  it('full jitter shortens the ladder by the sample; none ignores it; the cap holds', () => {
    const full: RetryPolicy = { ...policy, jitter: 'full' }
    expect(retryJitteredDelayMs(full, 1, 0)).toBe(0)
    expect(retryJitteredDelayMs(full, 1, 250)).toBe(125)
    expect(retryJitteredDelayMs(full, 1, 1000)).toBe(500)
    expect(retryJitteredDelayMs(policy, 1, 250)).toBe(500)
    expect(retryJitteredDelayMs(full, 7, 1000)).toBe(30000)
  })

  it('the decision table: 429/5xx/network retry, 4xx/success/fatal stop, Retry-After wins', async () => {
    // [attempts_made, outcome, retry_after, expected ms]
    const rows: Array<[number, unknown, number | null, number | null]> = [
      [1, { status: 429 }, 5, 5000],
      [1, { status: 429 }, null, 500],
      [2, { status: 503 }, null, 1000],
      [3, 'network', null, 2000],
      [1, { status: 400 }, null, null],
      [5, { status: 500 }, null, 8000],
      [6, { status: 500 }, null, null],
      [1, 'success', null, null],
      [1, 'fatal', null, null],
    ]
    for (const [attempts, outcome, retryAfter, ms] of rows) {
      const fromWasm = retryDecide(policy, attempts, outcome, retryAfter)
      expect(fromWasm === null ? null : fromWasm).toBe(ms)
      // …and the same through the shared wrapper the request helper calls.
      const fromShared = await decideRetry(
        policy,
        attempts,
        outcome as 'success' | 'network' | 'fatal' | { status: number },
        retryAfter,
      )
      expect(fromShared).toBe(ms)
    }
  })

  it('Retry-After: delta-seconds only, trimmed, leading zeros fine, everything else null', async () => {
    const rows: Array<[string, number | null]> = [
      ['0', 0],
      ['5', 5],
      [' 7 ', 7],
      ['007', 7],
      ['-1', null],
      ['1.5', null],
      ['', null],
      ['Wed, 21 Oct 2015 07:28:00 GMT', null],
    ]
    for (const [header, seconds] of rows) {
      const fromWasm = wasmParseRetryAfter(header)
      expect(fromWasm === null ? null : fromWasm).toBe(seconds)
      expect(await parseRetryAfterHeader(header)).toBe(seconds)
    }
    expect(await parseRetryAfterHeader(null)).toBe(null)
  })
})

describe('request() failure schedule (unchanged from main)', () => {
  type Canned = { status: number; body: unknown; headers?: Record<string, string> }
  let responses: Canned[] = []
  let calls = 0
  let failing = 0
  const originalFetch = globalThis.fetch

  beforeAll(async () => {
    const { setApiUrl } = await import('../packages/shared/src/api/index')
    setApiUrl('http://test.local')
  })

  function installFetch(): void {
    calls = 0
    failing = 0
    globalThis.fetch = (async () => {
      calls++
      if (failing > 0) {
        failing--
        throw new TypeError('network down')
      }
      const next = responses[calls - 1] ?? responses[responses.length - 1]
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json', ...next.headers },
      })
    }) as unknown as typeof fetch
  }

  it('three 429 retries inside the short window, then the wait-a-moment error', async () => {
    installFetch()
    responses = [
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
    ]
    const { request } = await import('../packages/shared/src/api/index')
    await expect(request('/api/v1/x')).rejects.toThrow(/please wait a moment/)
    // One try plus exactly three retries — main's schedule for this sequence.
    expect(calls).toBe(4)
    globalThis.fetch = originalFetch
  })

  it('a long Retry-After throws at once, carrying the wait time', async () => {
    installFetch()
    responses = [{ status: 429, body: {}, headers: { 'retry-after': '86400' } }]
    const { request } = await import('../packages/shared/src/api/index')
    const start = Date.now()
    await expect(request('/api/v1/x')).rejects.toThrow(/24 hours/)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(calls).toBe(1)
    globalThis.fetch = originalFetch
  })

  it('a raw network failure gets one 800 ms second chance, then the connection error', async () => {
    installFetch()
    failing = 2
    responses = [{ status: 200, body: {} }]
    const { request } = await import('../packages/shared/src/api/index')
    const start = Date.now()
    await expect(request('/api/v1/x')).rejects.toThrow(/Could not reach the server/)
    const elapsed = Date.now() - start
    expect(calls).toBe(2)
    // The 800 ms came out of core's ladder (a one-step policy), not a sleep of
    // its own — same number main used.
    expect(elapsed).toBeGreaterThanOrEqual(750)
    globalThis.fetch = originalFetch
  })

  it('a Retry-After that is not delta-seconds is no instruction: 5 s, then the retry', async () => {
    installFetch()
    responses = [
      { status: 429, body: {}, headers: { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' } },
      { status: 200, body: { ok: true } },
    ]
    const { request } = await import('../packages/shared/src/api/index')
    const start = Date.now()
    const result = await request<{ ok: boolean }>('/api/v1/x')
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(4900)
    globalThis.fetch = originalFetch
  }, 15000)
})
