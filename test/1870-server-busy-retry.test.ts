/**
 * Task 1870 — a `429 server_busy` upload is retried after Retry-After.
 *
 * Contract (server 1786 part A): `POST /files/upload` and `PUT /index` answer
 * `429 {"error":"server_busy","retry_after":N}` + `Retry-After: N` when the
 * process-wide buffered-upload budget stays full. A different 429,
 * `upload_rate_limited`, must NOT be retried.
 *
 * Time is faked (bun `jest.useFakeTimers`): the waits are asserted to the
 * millisecond, never slept for real.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import {
  SERVER_BUSY_MAX_RETRIES,
  SERVER_BUSY_MAX_WAIT_SECONDS,
  serverBusyWaitSeconds,
  withServerBusyRetry,
} from '../src/lib/server-busy-retry'
import { ApiError, uploadToFileRequest } from '../src/lib/api'
import { saveIndex, createEmptyIndex } from '../src/lib/search-index'

function busy(retryAfter: number | null, bodyRetryAfter: number | null = retryAfter): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (retryAfter !== null) headers['Retry-After'] = String(retryAfter)
  return new Response(
    JSON.stringify({ error: 'server_busy', message: 'busy', ...(bodyRetryAfter !== null ? { retry_after: bodyRetryAfter } : {}) }),
    { status: 429, headers },
  )
}
function rateLimited(): Response {
  return new Response(JSON.stringify({ error: 'upload_rate_limited', message: 'Too many uploads', retry_after: 2 }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'Retry-After': '2' },
  })
}
function created(): Response {
  return new Response(JSON.stringify({ id: 'f1' }), { status: 201, headers: { 'content-type': 'application/json', ETag: '"e1"' } })
}

/** Let every already-resolved promise continuation run (fake timers do not touch microtasks). */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}

/** Scripted fetch: returns the queued responses in order, records the fake-clock time of each call. */
function scripted(queue: Array<() => Response>) {
  const calls: number[] = []
  const fn = async () => {
    calls.push(Date.now())
    const next = queue.shift()
    if (!next) throw new Error('unexpected extra request')
    return next()
  }
  return { fn, calls }
}

/**
 * Run `p` to completion while pumping the fake clock, so a regression that WRONGLY
 * starts waiting shows up as an extra request (a failed assertion) rather than a hang.
 */
async function settle<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 8; i++) {
    await flush()
    jest.advanceTimersByTime(30_000)
  }
  return p
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('serverBusyWaitSeconds', () => {
  test('uses the larger of header and body, floors at 1, caps at 30', () => {
    expect(serverBusyWaitSeconds('2', 5)).toBe(5)
    expect(serverBusyWaitSeconds('7', 5)).toBe(7)
    expect(serverBusyWaitSeconds(null, 4)).toBe(4)
    expect(serverBusyWaitSeconds('0', 0)).toBe(1)
    expect(serverBusyWaitSeconds(null, undefined)).toBe(1)
    expect(serverBusyWaitSeconds('60', 60)).toBe(SERVER_BUSY_MAX_WAIT_SECONDS)
    expect(serverBusyWaitSeconds('garbage', 'nope')).toBe(1)
  })
})

describe('withServerBusyRetry', () => {
  test('(a) 429 server_busy + Retry-After: 2, then 201 -> succeeds after exactly one retry, waited >= 2 s', async () => {
    const s = scripted([() => busy(2), () => created()])
    const start = Date.now()
    const p = withServerBusyRetry(s.fn)
    await flush()
    expect(s.calls.length).toBe(1)

    jest.advanceTimersByTime(1999)
    await flush()
    expect(s.calls.length).toBe(1) // still waiting at 1.999 s

    jest.advanceTimersByTime(1)
    const res = await p
    expect(res.status).toBe(201)
    expect(s.calls.length).toBe(2)
    expect(s.calls[1] - start).toBeGreaterThanOrEqual(2000)
  })

  test('the wait is max(header, body retry_after), at least 1 s', async () => {
    const s = scripted([() => busy(1, 3), () => created()])
    const p = withServerBusyRetry(s.fn)
    await flush()
    jest.advanceTimersByTime(2999)
    await flush()
    expect(s.calls.length).toBe(1)
    jest.advanceTimersByTime(1)
    expect((await p).status).toBe(201)
    expect(s.calls.length).toBe(2)
  })

  test('a single wait is capped at 30 s', async () => {
    const s = scripted([() => busy(60), () => created()])
    const p = withServerBusyRetry(s.fn)
    await flush()
    jest.advanceTimersByTime(29_999)
    await flush()
    expect(s.calls.length).toBe(1)
    jest.advanceTimersByTime(1)
    expect((await p).status).toBe(201)
  })

  test('(b) four consecutive server_busy -> gives up after 4 attempts and returns the 429 untouched', async () => {
    const s = scripted([() => busy(1), () => busy(1), () => busy(1), () => busy(1), () => created()])
    const p = withServerBusyRetry(s.fn)
    for (let i = 0; i < SERVER_BUSY_MAX_RETRIES; i++) {
      await flush()
      jest.advanceTimersByTime(1000)
    }
    const res = await p
    expect(s.calls.length).toBe(4) // 1 + 3 retries; the queued 201 was never requested
    expect(res.status).toBe(429)
    // The caller's existing error path still gets a readable body.
    expect(((await res.json()) as { error: string }).error).toBe('server_busy')
  })

  test('(c) 429 upload_rate_limited -> returned at once, not retried', async () => {
    const s = scripted([() => rateLimited(), () => created()])
    const res = await settle(withServerBusyRetry(s.fn))
    expect(res.status).toBe(429)
    expect(s.calls.length).toBe(1)
    expect(((await res.json()) as { error: string }).error).toBe('upload_rate_limited')
  })

  test('other statuses and an unparsable 429 are not retried', async () => {
    for (const make of [
      () => new Response('{}', { status: 500 }),
      () => new Response('<html>', { status: 429, headers: { 'Retry-After': '2' } }),
      () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
    ]) {
      const s = scripted([make, () => created()])
      const res = await settle(withServerBusyRetry(s.fn))
      expect(res.ok).toBe(false)
      expect(s.calls.length).toBe(1)
    }
  })

  test('(d) abort during the wait -> rejects AbortError immediately, no further request', async () => {
    const s = scripted([() => busy(5), () => created()])
    const ac = new AbortController()
    const p = withServerBusyRetry(s.fn, ac.signal)
    p.catch(() => {}) // observed below
    await flush()
    expect(s.calls.length).toBe(1)

    jest.advanceTimersByTime(1000) // mid-wait
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })

    jest.advanceTimersByTime(60_000)
    await flush()
    expect(s.calls.length).toBe(1) // the timer was cleared; nothing was re-sent
  })

  test('an already-aborted signal does not start a wait', async () => {
    const s = scripted([() => busy(5), () => created()])
    const ac = new AbortController()
    ac.abort()
    await expect(withServerBusyRetry(s.fn, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(s.calls.length).toBe(1)
  })

  test('send is called afresh each attempt (a one-shot body can be rebuilt)', async () => {
    let built = 0
    const queue = [() => busy(1), () => created()]
    const p = withServerBusyRetry(async () => {
      built++
      return queue.shift()!()
    })
    await flush()
    jest.advanceTimersByTime(1000)
    await p
    expect(built).toBe(2)
  })
})

describe('wired call sites', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function installFetch(queue: Array<() => Response>) {
    const seen: Array<{ url: string; method?: string; body?: unknown }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method, body: init?.body })
      const next = queue.shift()
      if (!next) throw new Error('unexpected extra request')
      return next()
    }) as unknown as typeof fetch
    return seen
  }

  test('PUT /index (saveIndex) retries a server_busy and returns the ETag of the 200 (real 1 s wait)', async () => {
    // Real timers on purpose: encryptIndex is WebCrypto work that settles on real
    // macrotasks, which a faked clock cannot be pumped through deterministically.
    jest.useRealTimers()
    const seen = installFetch([() => busy(1), () => new Response(null, { status: 200, headers: { ETag: '"v2"' } })])
    const start = Date.now()
    const etag = await saveIndex(createEmptyIndex(), new Uint8Array(32).fill(1))
    expect(etag).toBe('"v2"')
    expect(seen.length).toBe(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000)
    expect(seen.every((c) => c.method === 'PUT' && c.url.endsWith('/api/v1/index'))).toBe(true)
  })

  test('uploadToFileRequest retries a server_busy with the same FormData, then succeeds', async () => {
    const ok = { file_id: 'f1', files_received: 1, total_bytes_received: 3, message: 'ok' }
    const seen = installFetch([() => busy(1), () => new Response(JSON.stringify(ok), { status: 201, headers: { 'content-type': 'application/json' } })])
    const form = new FormData()
    form.append('chunk_0', new Blob([new Uint8Array([1, 2, 3])]))
    const p = uploadToFileRequest('tok', form)
    await flush()
    expect(seen.length).toBe(1)
    jest.advanceTimersByTime(1000)
    expect((await p).file_id).toBe('f1')
    expect(seen.length).toBe(2)
    expect(seen[0].body).toBe(form)
    expect(seen[1].body).toBe(form)
  })

  test('uploadToFileRequest: four server_busy -> the existing ApiError (message, status 429)', async () => {
    const seen = installFetch([() => busy(1), () => busy(1), () => busy(1), () => busy(1)])
    const p = uploadToFileRequest('tok', new FormData())
    p.catch(() => {})
    for (let i = 0; i < 3; i++) {
      await flush()
      jest.advanceTimersByTime(1000)
    }
    await expect(p).rejects.toBeInstanceOf(ApiError)
    await expect(p).rejects.toMatchObject({ status: 429, message: 'busy' })
    expect(seen.length).toBe(4)
  })

  test('uploadToFileRequest: upload_rate_limited is not retried', async () => {
    const seen = installFetch([() => rateLimited(), () => new Response('{}', { status: 201 })])
    const p = uploadToFileRequest('tok', new FormData())
    p.catch(() => {})
    await settle(p.catch(() => {}))
    await expect(p).rejects.toMatchObject({ status: 429, message: 'Too many uploads' })
    expect(seen.length).toBe(1)
  })
})
