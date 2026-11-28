import { beforeEach, describe, expect, test } from 'bun:test'
import { rateLimitWaitMs, resetRateLimitPause, withRateLimitBackoff } from '../src/lib/rate-limit-backoff'

const ORIGIN = 'https://api.test'
const r429 = (body: object, retryAfter?: string) =>
  new Response(JSON.stringify(body), {
    status: 429,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  })
const ok = () => new Response('{}', { status: 200 })

// A fake clock: a sleep moves it forward, so the waits take no real time.
let clock = 0
const now = () => clock
const sleep = async (ms: number) => {
  clock += ms
}

function setup(responses: Response[]) {
  let calls = 0
  const base = (async () => responses[Math.min(calls++, responses.length - 1)]) as unknown as typeof fetch
  return {
    f: withRateLimitBackoff(base, { apiOrigin: ORIGIN, random: () => 0, now, sleep }),
    calls: () => calls,
  }
}

beforeEach(() => {
  resetRateLimitPause()
  clock = 1_000_000
})

describe('rateLimitWaitMs', () => {
  test('2 s floor doubling to 60 s, or the hint when longer, plus jitter up to 25%', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((streak) => rateLimitWaitMs(streak, null, undefined, () => 0))).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ])
    expect(rateLimitWaitMs(0, '2', 3, () => 0)).toBe(3000)
    expect(rateLimitWaitMs(0, '4', 1, () => 1)).toBe(5000)
    expect(rateLimitWaitMs(0, '1', 1, () => 0)).toBe(2000)
    expect(rateLimitWaitMs(2, '5', null, () => 0)).toBe(8000)
    expect(rateLimitWaitMs(0, '60', null, () => 1)).toBe(75000)
  })
})

describe('429 backoff', () => {
  test('retries a GET after Retry-After then succeeds', async () => {
    const s = setup([r429({ retry_after: 1 }, '1'), ok()])
    const t = clock
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(200)
    expect(s.calls()).toBe(2)
    expect(clock - t).toBe(2000) // the floor: the 1 s hint is shorter
  })

  test('an unkeyed POST or PATCH is not replayed', async () => {
    for (const method of ['POST', 'PATCH']) {
      resetRateLimitPause()
      const s = setup([r429({}, '1'), ok()])
      const res = await s.f(ORIGIN + '/files', { method, body: 'x' })
      expect(res.status).toBe(429)
      expect(s.calls()).toBe(1)
    }
  })

  test('a chunk PUT answered 429 then 200 succeeds after the pause, no key needed', async () => {
    const s = setup([r429({}, '1'), ok()])
    const t = clock
    const res = await s.f(ORIGIN + '/uploads/u1/chunks/0', { method: 'PUT', body: new Uint8Array([1, 2, 3]) })
    expect(res.status).toBe(200)
    expect(s.calls()).toBe(2)
    expect(clock - t).toBe(2000)
  })

  test('an unkeyed DELETE is replayed; a blank key on a POST does not count', async () => {
    const s = setup([r429({}, '1'), ok()])
    expect((await s.f(ORIGIN + '/files/1', { method: 'DELETE' })).status).toBe(200)
    expect(s.calls()).toBe(2)
    resetRateLimitPause()
    const blank = setup([r429({}, '1'), ok()])
    expect((await blank.f(ORIGIN + '/files', { method: 'POST', headers: { 'Idempotency-Key': ' ' } })).status).toBe(429)
    expect(blank.calls()).toBe(1)
    const t = clock
    expect((await blank.f(ORIGIN + '/files')).status).toBe(200)
    expect(clock - t).toBe(2000) // the pause holds the next request
  })

  test('a PUT with a streamed body is not replayed', async () => {
    const s = setup([r429({}, '1'), ok()])
    const body = new ReadableStream<Uint8Array>()
    const res = await s.f(ORIGIN + '/files/1', { method: 'PUT', body, duplex: 'half' } as RequestInit)
    expect(res.status).toBe(429)
    expect(s.calls()).toBe(1)
  })

  test('the streak survives a 200 that lands during a pause', async () => {
    let release!: (r: Response) => void
    const slow = new Promise<Response>((resolve) => (release = resolve))
    const queue: Array<Response | Promise<Response>> = [slow, r429({}, '0'), r429({}, '0'), ok()]
    const base = (async () => queue.shift()!) as unknown as typeof fetch
    const f = withRateLimitBackoff(base, { apiOrigin: ORIGIN, random: () => 0, now, sleep })
    const inFlight = f(ORIGIN + '/slow') // sent before the 429
    await Promise.resolve()
    expect((await f(ORIGIN + '/a', { method: 'POST' })).status).toBe(429) // pause 2 s, streak 1
    release(ok())
    expect((await inFlight).status).toBe(200) // lands inside the pause
    const t = clock
    expect((await f(ORIGIN + '/b')).status).toBe(200)
    // 2 s left of the first pause, then the second 429 doubles to 4 s (2 s if the streak had reset)
    expect(clock - t).toBe(2000 + 4000)
  })

  test('a keyed POST is retried, the key read from a Request or a Headers object', async () => {
    const a = setup([r429({}, '1'), ok()])
    const req = new Request(ORIGIN + '/files', { method: 'POST', headers: { 'idempotency-key': 'k2' } })
    expect((await a.f(req)).status).toBe(200)
    expect(a.calls()).toBe(2)
    resetRateLimitPause()
    const b = setup([r429({}, '1'), ok()])
    const res = await b.f(ORIGIN + '/files', { method: 'POST', headers: new Headers({ 'Idempotency-Key': 'k3' }) })
    expect(res.status).toBe(200)
    expect(b.calls()).toBe(2)
  })

  test('retry-after above 60 s is a policy refusal, no retry', async () => {
    const s = setup([r429({ error: 'rate_limited' }, '120'), ok()])
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(429)
    const j = await res.json()
    expect(j.error).toBe('rate_limited')
    expect(j.policy).toBe(true)
    expect(s.calls()).toBe(1)
    // the tab is now paused: the next request is answered locally
    const again = await s.f(ORIGIN + '/files')
    expect(again.status).toBe(429)
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
    const t = clock
    await s.f(ORIGIN + '/b')
    expect(clock - t).toBe(2000)
  })

  test('gives up after 4 retries, the wait doubling each time', async () => {
    const s = setup([r429({}, '0')])
    const t = clock
    const res = await s.f(ORIGIN + '/files')
    expect(res.status).toBe(429)
    expect(s.calls()).toBe(5)
    expect(clock - t).toBe(2000 + 4000 + 8000 + 16000)
  })
})
