/**
 * LD-0001 PR-B: the service-worker range responder (contract §2.1, §4 rows
 * 6-7, §6 M4, §9 A8, A10, A21, A23, A24, A27).
 *
 * Everything here is the dependency-free `public/media-stream-logic.js` that
 * `public/sw.js` loads with `importScripts`. No browser, no real service
 * worker: requests are plain objects, the clock is injected, and `caches` is a
 * spy. T20's mutation (a `cache.put` on the stream route) is why the route is
 * handed a `cacheStore` it must never touch.
 */
import { describe, expect, test } from 'bun:test'
import { FakeClock } from './helpers/media-stream-fixtures'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logic = require('../public/media-stream-logic.js')

interface FakeRequest {
  url: string
  mode: string
  destination: string
  headers: { get(name: string): string | null }
}

function request(overrides: Partial<FakeRequest> & { range?: string | null } = {}): FakeRequest {
  const { range = null, ...rest } = overrides
  return {
    url: 'https://app.test/sw-stream/stream-1',
    mode: 'no-cors',
    destination: 'video',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'range' ? range : null),
    },
    ...rest,
  }
}

interface FakeEntry {
  id: string
  mime: string
  size: number
  clientId: string
  port: unknown
  requests: Map<string, unknown>
}

function entry(overrides: Partial<FakeEntry> = {}): FakeEntry {
  return {
    id: 'stream-1',
    mime: 'video/mp4',
    size: 100,
    clientId: 'client-1',
    port: {},
    requests: new Map(),
    ...overrides,
  }
}

function fakeRegistry(initial: FakeEntry | null = null) {
  const map = new Map<string, FakeEntry>()
  if (initial) map.set(initial.id, initial)
  const calls = { get: 0, register: 0 }
  return {
    calls,
    register(e: FakeEntry) {
      calls.register++
      map.set(e.id, e)
    },
    get(id: string) {
      calls.get++
      return map.get(id) ?? null
    },
    remove(id: string) {
      map.delete(id)
    },
    has(id: string) {
      return map.has(id)
    },
  }
}

function fakeCaches() {
  const calls = { open: 0, put: 0, match: 0 }
  return {
    calls,
    open() {
      calls.open++
      return Promise.resolve({
        put() {
          calls.put++
          return Promise.resolve()
        },
        match() {
          calls.match++
          return Promise.resolve(undefined)
        },
      })
    },
    put() {
      calls.put++
      return Promise.resolve()
    },
    match() {
      calls.match++
      return Promise.resolve(undefined)
    },
  }
}

interface RouteDeps {
  registry?: ReturnType<typeof fakeRegistry>
  cacheStore?: ReturnType<typeof fakeCaches>
  claim?: (hash: string, clientId: string) => Promise<FakeEntry | null>
  createBody?: (e: FakeEntry, start: number, end: number) => unknown
  clock?: FakeClock
}

function routeWith(deps: RouteDeps = {}) {
  const registry = deps.registry ?? fakeRegistry(entry())
  const cacheStore = deps.cacheStore ?? fakeCaches()
  const claims: Array<{ hash: string; clientId: string }> = []
  const route = logic.createStreamRoute({
    registry,
    cacheStore,
    clock: deps.clock ?? new FakeClock(),
    claim:
      deps.claim ??
      (async (hash: string, clientId: string) => {
        claims.push({ hash, clientId })
        return null
      }),
    createBody: deps.createBody ?? (() => null),
  })
  return { route, registry, cacheStore, claims }
}

async function respond(
  result: null | { response: Promise<Response> },
): Promise<Response> {
  if (!result) throw new Error('the stream route did not intercept the request')
  return await result.response
}

describe('T19 range_header_parse_and_416 (A8)', () => {
  test('bytes=a-b, bytes=a-, bytes=-n and a clamped end', () => {
    expect(logic.parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(logic.parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(logic.parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(logic.parseRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 })
    expect(logic.parseRange('bytes=5-5', 100)).toEqual({ start: 5, end: 5 })
  })

  test('a multi-range header is served as its first range', () => {
    expect(logic.parseRange('bytes=0-1,5-6', 100)).toEqual({ start: 0, end: 1 })
    expect(logic.parseRange('bytes=10-19, 30-39', 100)).toEqual({ start: 10, end: 19 })
  })

  test('malformed or unsatisfiable ranges are refused', () => {
    expect(logic.parseRange('bytes=-0', 100)).toBeNull()
    expect(logic.parseRange('bytes=5-2', 100)).toBeNull()
    expect(logic.parseRange('bytes=100-', 100)).toBeNull()
    expect(logic.parseRange('bytes=100-109', 100)).toBeNull()
    expect(logic.parseRange('bytes=abc', 100)).toBeNull()
    expect(logic.parseRange('items=0-9', 100)).toBeNull()
    expect(logic.parseRange('bytes=0-9', 0)).toBeNull()
  })

  test('a refused range is a 416 with Content-Range: bytes */total', async () => {
    const { route, cacheStore } = routeWith()
    const res = await respond(route(request({ range: 'bytes=-0' }), 'client-1'))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */100')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(cacheStore.calls.put).toBe(0)
  })
})

describe('T20 stream_response_headers and no cache storage (M4)', () => {
  test('a 206 carries the exact M4 headers and the requested range', async () => {
    const { route } = routeWith()
    const res = await respond(route(request({ range: 'bytes=10-19' }), 'client-1'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100')
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    )
  })

  test('a request without Range is a 200 with the whole length', async () => {
    const { route } = routeWith()
    const res = await respond(route(request(), 'client-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.headers.get('content-range')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    )
  })

  test('stream_route_never_touches_cache_storage', async () => {
    const cacheStore = fakeCaches()
    const { route } = routeWith({ cacheStore })
    await respond(route(request({ range: 'bytes=0-9' }), 'client-1'))
    await respond(route(request(), 'client-1'))
    expect(cacheStore.calls.open).toBe(0)
    expect(cacheStore.calls.put).toBe(0)
    expect(cacheStore.calls.match).toBe(0)
  })
})

describe('T21 mime_outside_video_audio_served_as_octet_stream (A24)', () => {
  test('only ^(video|audio)/[a-z0-9.+-]+$ is echoed', () => {
    expect(logic.contentTypeFor('video/mp4')).toBe('video/mp4')
    expect(logic.contentTypeFor('audio/mpeg')).toBe('audio/mpeg')
    expect(logic.contentTypeFor('video/x-matroska')).toBe('video/x-matroska')
    expect(logic.contentTypeFor('text/html')).toBe('application/octet-stream')
    expect(logic.contentTypeFor('image/svg+xml')).toBe('application/octet-stream')
    expect(logic.contentTypeFor('video/mp4; charset=utf-8')).toBe('application/octet-stream')
    expect(logic.contentTypeFor('VIDEO/MP4')).toBe('application/octet-stream')
    expect(logic.contentTypeFor('')).toBe('application/octet-stream')
    expect(logic.contentTypeFor(null)).toBe('application/octet-stream')
  })

  test('a hostile registered MIME is served as octet-stream behind the sandbox CSP', async () => {
    const { route } = routeWith({ registry: fakeRegistry(entry({ mime: 'text/html' })) })
    const res = await respond(route(request({ range: 'bytes=0-9' }), 'client-1'))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    )
  })
})

describe('T22 the stream route never answers a navigation (A21, A23)', () => {
  test('navigation_to_sw_stream_is_never_answered_by_the_stream_route', async () => {
    const live = entry()
    const { route, registry } = routeWith({ registry: fakeRegistry(live) })
    expect(registry.has('stream-1')).toBe(true)
    const result = route(
      request({ mode: 'navigate', destination: 'document' }),
      'client-1',
    )
    expect(result).toBeNull()
    // No registry lookup happened: the navigation check runs first.
    expect(registry.calls.get).toBe(0)
  })

  test('non_media_destination_404s', async () => {
    const { route } = routeWith()
    const res = await respond(
      route(request({ destination: 'document', mode: 'cors' }), 'client-1'),
    )
    expect(res.status).toBe(404)
  })

  test('client_id_mismatch_404s', async () => {
    const { route } = routeWith()
    const res = await respond(route(request(), 'some-other-client'), )
    expect(res.status).toBe(404)
    const ok = await respond(route(request({ range: 'bytes=0-9' }), 'client-1'))
    expect(ok.status).toBe(206)
  })

  test('a non-empty clientId is required to match the registrant', () => {
    expect(logic.shouldHandleStreamRequest(request(), '', entry())).toBe(true)
    expect(logic.shouldHandleStreamRequest(request(), 'client-1', entry())).toBe(true)
    expect(logic.shouldHandleStreamRequest(request(), 'client-2', entry())).toBe(false)
    expect(
      logic.shouldHandleStreamRequest(request({ destination: 'image' }), 'client-1', entry()),
    ).toBe(false)
    expect(
      logic.shouldHandleStreamRequest(request({ mode: 'navigate' }), 'client-1', entry()),
    ).toBe(false)
  })
})

describe('T23 registry_miss_claim_hash_and_source_checked (A9, A27)', () => {
  test('a registry miss asks for a claim with sha256(id) and the client id', async () => {
    const claimed = entry()
    const { route, registry, claims } = routeWith({
      registry: fakeRegistry(null),
      claim: async (hash, clientId) => {
        claims.push({ hash, clientId })
        return claimed
      },
    })
    const res = await respond(route(request({ range: 'bytes=0-9' }), 'client-1'))
    expect(res.status).toBe(206)
    expect(claims).toEqual([{ hash: logic.sha256Hex('stream-1'), clientId: 'client-1' }])
    expect(registry.has('stream-1')).toBe(true)
  })

  test('a claim whose id hash does not match is refused', async () => {
    const { route } = routeWith({
      registry: fakeRegistry(null),
      claim: async () => entry({ id: 'a-different-stream' }),
    })
    const res = await respond(route(request(), 'client-1'))
    expect(res.status).toBe(404)
  })

  test('a claim answered by another tab is refused when source.id differs', async () => {
    const { route } = routeWith({
      registry: fakeRegistry(null),
      claim: async () => entry({ clientId: 'another-tab' }),
    })
    const res = await respond(route(request(), 'client-1'))
    expect(res.status).toBe(404)
  })

  test('no owner answers -> 404', async () => {
    const { route } = routeWith({ registry: fakeRegistry(null) })
    const res = await respond(route(request(), 'client-1'))
    expect(res.status).toBe(404)
  })

  test('the claim hash is a real sha256', () => {
    expect(logic.sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(logic.sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(logic.claimAccepted(entry(), { hash: logic.sha256Hex('stream-1'), clientId: '' })).toBe(true)
    expect(logic.claimAccepted(entry(), { hash: logic.sha256Hex('stream-1'), clientId: 'x' })).toBe(false)
    expect(logic.claimAccepted(entry(), { hash: logic.sha256Hex('other'), clientId: '' })).toBe(false)
  })
})

describe('T24 silence_errors_after_30s_progress_keeps_alive (A10)', () => {
  test('30 s of silence fires once; a touch restarts the window', () => {
    const clock = new FakeClock()
    let fires = 0
    const timer = logic.createSilenceTimer(clock, () => {
      fires++
    }, 30000)
    clock.advance(20000)
    timer.touch()
    clock.advance(20000)
    expect(fires).toBe(0)
    clock.advance(10000)
    expect(fires).toBe(1)
    // Fired is terminal: a late touch never re-arms.
    clock.advance(60000)
    expect(fires).toBe(1)
    timer.stop()
  })

  test('a progress every 10 s keeps the response alive past 60 s', () => {
    const clock = new FakeClock()
    let fires = 0
    const timer = logic.createSilenceTimer(clock, () => {
      fires++
    }, 30000)
    for (let i = 0; i < 6; i++) {
      clock.advance(10000)
      timer.touch()
    }
    expect(fires).toBe(0)
    timer.stop()
    clock.advance(60000)
    expect(fires).toBe(0)
  })

  test('data continuity is checked against the response offset', () => {
    expect(logic.continuityOk(0, 0, 10)).toBe(true)
    expect(logic.continuityOk(10, 10, 1)).toBe(true)
    expect(logic.continuityOk(10, 11, 1)).toBe(false)
    expect(logic.continuityOk(10, 10, 0)).toBe(false)
  })
})
