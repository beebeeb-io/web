import { beforeEach, describe, expect, test } from 'bun:test'
import { rateLimitWaitMs, resetRateLimitPause, withRateLimitBackoff } from './rate-limit-backoff'

const ORIGIN = 'https://api.test'
const r429 = (body: object, retryAfter?: string) =>
  new Response(JSON.stringify(body), {
    status: 429,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  })
const ok = () => new Response('{}', { status: 200 })

function setup(responses: Response[]) {
  let calls = 0
  const base = (async () => responses[Math.min(calls++, responses.length - 1)]) as unknown as typeof fetch
  return { f: withRateLimitBackoff(base, { apiOrigin: ORIGIN, random: () => 0 }), calls: () => calls }
}

beforeEach(resetRateLimitPause)

describe('rateLimitWaitMs', () => {
  test('max of header and body, plus jitter up to 25%', () => {
    expect(rateLimitWaitMs('2', 3, () => 0)).toBe(3000)
    expect(rateLimitWaitMs('4', 1, () => 1)).toBe(5000)
  })
})

describe('429 backoff', () => {
  test('retries a GET after Retry-After then succeeds', async () => {
    const s = setup([r429({ retry_after: 1 }, '1'), ok()])
    const t = Date.now()
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(200)
    expect(s.calls()).toBe(2)
    expect(Date.now() - t).toBeGreaterThanOrEqual(950)
  })

  test('does not retry POST', async () => {
    const s = setup([r429({}, '1'), ok()])
    const res = await s.f(ORIGIN + '/files', { method: 'POST' })
    expect(res.status).toBe(429)
    expect(s.calls()).toBe(1)
  })

  test('retry-after above 60 s is a policy refusal, no retry', async () => {
    const s = setup([r429({ error: 'rate_limited' }, '120'), ok()])
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limit_policy')
    expect(s.calls()).toBe(1)
  })

  test('banned is surfaced as banned', async () => {
    const s = setup([r429({ error: 'banned', retry_after: 5 }, '5'), ok()])
    const res = await s.f(ORIGIN + '/files')
    expect((await res.json()).error).toBe('banned')
    expect(s.calls()).toBe(1)
  })

  test('server_busy and other origins pass through', async () => {
    const a = setup([r429({ error: 'server_busy', retry_after: 1 }, '1')])
    expect((await a.f(ORIGIN + '/x')).status).toBe(429)
    expect(a.calls()).toBe(1)
    const b = setup([r429({}, '1')])
    expect((await b.f('https://other.test/x')).status).toBe(429)
    expect(b.calls()).toBe(1)
  })

  test('a pause holds other API requests', async () => {
    const s = setup([r429({}, '1'), ok(), ok()])
    const first = s.f(ORIGIN + '/a', { method: 'POST' }) // sets pause, returns 429
    await first
    const t = Date.now()
    await s.f(ORIGIN + '/b')
    expect(Date.now() - t).toBeGreaterThanOrEqual(900)
  })

  test('gives up after 4 retries', async () => {
    const s = setup([r429({}, '0')])
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(429)
    expect(s.calls()).toBe(5)
  }, 15000)
})
