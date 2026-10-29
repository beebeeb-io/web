import { describe, test, expect } from 'bun:test'
import {
  parseOfficeManifest,
  assertSameOrigin,
  fetchOfficeManifest,
  loadOfficeBundle,
  createCancellableOfficeLoad,
  OfficeLoaderError,
  type OfficeManifest,
} from '../src/lib/office/loader'

const ORIGIN = 'https://app.beebeeb.io'

function manifestFixture(): OfficeManifest {
  return {
    version: 'a1b2c3d4',
    generated: '2026-09-26T00:00:00.000Z',
    assets: [
      { path: 'soffice.js', bytes: 6, integrity: 'sha256-js', contentType: 'application/javascript' },
      { path: 'soffice.wasm', bytes: 10, integrity: 'sha256-wasm', contentType: 'application/wasm' },
    ],
  }
}

/** Builds a fake `fetch` over an in-memory file map, recording every call. */
function makeFakeFetch(files: Record<string, Uint8Array | string>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    calls.push({ url: href, init })
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const path = new URL(href).pathname
    const entry = Object.entries(files).find(([k]) => path.endsWith(k))
    if (!entry) {
      return new Response('not found', { status: 404 })
    }
    const [, content] = entry
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('parseOfficeManifest', () => {
  test('accepts a well-formed manifest', () => {
    const m = parseOfficeManifest(manifestFixture())
    expect(m.version).toBe('a1b2c3d4')
    expect(m.assets).toHaveLength(2)
  })

  test('rejects a non-object', () => {
    expect(() => parseOfficeManifest(null)).toThrow(OfficeLoaderError)
    expect(() => parseOfficeManifest('nope')).toThrow(OfficeLoaderError)
  })

  test('rejects a missing version', () => {
    const bad = { ...manifestFixture(), version: '' }
    expect(() => parseOfficeManifest(bad)).toThrow(/version/)
  })

  test('rejects an empty assets array', () => {
    const bad = { ...manifestFixture(), assets: [] }
    expect(() => parseOfficeManifest(bad)).toThrow(/assets/)
  })

  test('rejects a malformed asset entry (missing integrity)', () => {
    const bad = manifestFixture()
    // @ts-expect-error — deliberately malformed for the test
    delete bad.assets[0].integrity
    expect(() => parseOfficeManifest(bad)).toThrow(/malformed/)
  })

  test('error carries the manifest-invalid code', () => {
    try {
      parseOfficeManifest(null)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('manifest-invalid')
    }
  })
})

describe('assertSameOrigin', () => {
  test('accepts a relative path on the given origin', () => {
    const url = assertSameOrigin('/office/manifest.json', ORIGIN)
    expect(url).toBe(`${ORIGIN}/office/manifest.json`)
  })

  test('accepts an absolute same-origin URL', () => {
    const url = assertSameOrigin(`${ORIGIN}/office/a1b2/soffice.wasm`, ORIGIN)
    expect(url).toContain('/office/a1b2/soffice.wasm')
  })

  test('REJECTS a cross-origin absolute URL — this is the zero-egress guarantee', () => {
    expect(() => assertSameOrigin('https://evil.example/soffice.wasm', ORIGIN)).toThrow(OfficeLoaderError)
    try {
      assertSameOrigin('https://evil.example/soffice.wasm', ORIGIN)
    } catch (err) {
      expect((err as OfficeLoaderError).code).toBe('cross-origin-rejected')
    }
  })

  test('rejects a protocol-relative URL pointing off-origin', () => {
    expect(() => assertSameOrigin('//evil.example/x', ORIGIN)).toThrow(OfficeLoaderError)
  })
})

describe('fetchOfficeManifest', () => {
  test('parses a valid manifest response', async () => {
    const { fetchImpl } = makeFakeFetch({ 'manifest.json': JSON.stringify(manifestFixture()) })
    const manifest = await fetchOfficeManifest({ origin: ORIGIN, fetchImpl })
    expect(manifest.version).toBe('a1b2c3d4')
  })

  test('never requests a URL off the given origin', async () => {
    const { fetchImpl, calls } = makeFakeFetch({ 'manifest.json': JSON.stringify(manifestFixture()) })
    await fetchOfficeManifest({ origin: ORIGIN, fetchImpl })
    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith(ORIGIN)).toBe(true)
  })

  test('a non-2xx status becomes manifest-fetch-failed', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch
    await expect(fetchOfficeManifest({ origin: ORIGIN, fetchImpl })).rejects.toThrow(OfficeLoaderError)
    try {
      await fetchOfficeManifest({ origin: ORIGIN, fetchImpl })
    } catch (err) {
      expect((err as OfficeLoaderError).code).toBe('manifest-fetch-failed')
    }
  })

  test('a network throw becomes manifest-fetch-failed (not an unhandled rejection)', async () => {
    const fetchImpl = (async () => { throw new TypeError('network down') }) as typeof fetch
    try {
      await fetchOfficeManifest({ origin: ORIGIN, fetchImpl })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('manifest-fetch-failed')
    }
  })

  test('invalid JSON becomes manifest-invalid, not a raw SyntaxError', async () => {
    const fetchImpl = (async () => new Response('{not json', { status: 200 })) as typeof fetch
    try {
      await fetchOfficeManifest({ origin: ORIGIN, fetchImpl })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('manifest-invalid')
    }
  })

  test('an already-aborted signal surfaces as cancelled, not a generic failure', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Response(JSON.stringify(manifestFixture()))
    }) as typeof fetch
    const controller = new AbortController()
    controller.abort()
    try {
      await fetchOfficeManifest({ origin: ORIGIN, fetchImpl, signal: controller.signal })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('cancelled')
    }
  })

  test('with no origin available and none injected, fails with unsupported-environment', async () => {
    // bun:test has no `location` global — this exercises the real "no browser" path.
    await expect(fetchOfficeManifest({})).rejects.toMatchObject({ code: 'unsupported-environment' })
  })
})

describe('loadOfficeBundle', () => {
  test('loads every manifest asset and returns their bytes', async () => {
    const { fetchImpl } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    const bundle = await loadOfficeBundle({ origin: ORIGIN, fetchImpl })
    expect(bundle.version).toBe('a1b2c3d4')
    expect(bundle.assets.size).toBe(2)
    expect(bundle.assets.get('soffice.js')!.bytes.byteLength).toBe(6)
    expect(bundle.assets.get('soffice.wasm')!.bytes.byteLength).toBe(10)
  })

  test('every asset request is same-origin AND under the manifest version directory', async () => {
    const { fetchImpl, calls } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    await loadOfficeBundle({ origin: ORIGIN, fetchImpl })
    const assetCalls = calls.filter((c) => !c.url.endsWith('manifest.json'))
    expect(assetCalls).toHaveLength(2)
    for (const c of assetCalls) {
      expect(c.url.startsWith(`${ORIGIN}/office/a1b2c3d4/`)).toBe(true)
    }
  })

  test('every asset fetch carries the manifest integrity value', async () => {
    const { fetchImpl, calls } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    await loadOfficeBundle({ origin: ORIGIN, fetchImpl })
    const wasmCall = calls.find((c) => c.url.endsWith('soffice.wasm'))!
    expect(wasmCall.init?.integrity).toBe('sha256-wasm')
  })

  test('progress reaches the manifest total exactly once complete', async () => {
    const { fetchImpl } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    let lastOverall = { loaded: -1, total: -1 }
    await loadOfficeBundle({
      origin: ORIGIN,
      fetchImpl,
      onProgress: (p) => {
        lastOverall = { loaded: p.overallLoadedBytes, total: p.overallTotalBytes }
      },
    })
    // 6 (soffice.js) + 10 (soffice.wasm) = 16 total bytes in the fixture.
    expect(lastOverall.total).toBe(16)
    expect(lastOverall.loaded).toBe(16)
  })

  test('a throwing onProgress callback does not abort the load', async () => {
    const { fetchImpl } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    const bundle = await loadOfficeBundle({
      origin: ORIGIN,
      fetchImpl,
      onProgress: () => { throw new Error('boom') },
    })
    expect(bundle.assets.size).toBe(2)
  })

  test('an already-aborted signal cancels before any asset is fetched', async () => {
    const { fetchImpl, calls } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    const controller = new AbortController()
    controller.abort()
    try {
      await loadOfficeBundle({ origin: ORIGIN, fetchImpl, signal: controller.signal })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('cancelled')
    }
    // The manifest fetch is attempted (and aborted) but no asset download starts.
    expect(calls.filter((c) => !c.url.endsWith('manifest.json'))).toHaveLength(0)
  })

  test('a fetch failure on the SECOND asset reports asset-fetch-failed and does not silently drop it', async () => {
    const fetchImpl = (async (url: string | URL) => {
      const path = new URL(String(url)).pathname
      if (path.endsWith('manifest.json')) return new Response(JSON.stringify(manifestFixture()))
      if (path.endsWith('soffice.js')) return new Response('abcdef')
      return new Response('server error', { status: 503 })
    }) as typeof fetch
    try {
      await loadOfficeBundle({ origin: ORIGIN, fetchImpl })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('asset-fetch-failed')
      expect((err as OfficeLoaderError).message).toContain('soffice.wasm')
    }
  })
})

describe('createCancellableOfficeLoad', () => {
  test('cancel() aborts the underlying load', async () => {
    const { fetchImpl } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    const { promise, cancel } = createCancellableOfficeLoad({ origin: ORIGIN, fetchImpl })
    cancel()
    try {
      await promise
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeLoaderError)
      expect((err as OfficeLoaderError).code).toBe('cancelled')
    }
  })

  test('without cancel(), the load completes normally', async () => {
    const { fetchImpl } = makeFakeFetch({
      'manifest.json': JSON.stringify(manifestFixture()),
      'soffice.js': 'abcdef',
      'soffice.wasm': '0123456789',
    })
    const { promise } = createCancellableOfficeLoad({ origin: ORIGIN, fetchImpl })
    const bundle = await promise
    expect(bundle.assets.size).toBe(2)
  })
})
