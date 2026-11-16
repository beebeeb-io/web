import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as wasm from 'beebeeb-wasm'
import { directChunks } from '../src/lib/direct/download'
import { storageGet } from '../src/lib/direct/storage-fetch'
import { setClientInfo, setApiUrl, getAuthStamp, setAuthIdentity, isCurrentAuthStamp } from '@beebeeb/shared'
import { scrubText } from '../packages/shared/src/telemetry/scrub'
import v from './fixtures/direct_transfer.json'
import { createContentOps } from '../src/lib/content-crypto'

wasm.initSync({ module: readFileSync('packages/beebeeb-wasm/beebeeb_wasm_bg.wasm') })
const original = globalThis.fetch
const originalStorage = globalThis.localStorage
const t0 = Date.now
const pair = { host: 's3.storage.test', bucket: 'bb-01' }
const disc = { download: ['object-download-v1'], storage_hosts: [pair.host], storage_buckets: [pair] }
const file = v.file_id
const version = '22222222-2222-4222-8222-222222222222'
const signature = 'https://s3.storage.test/bb-01/t/v/0.bin?X-Amz-Signature=TEST'
function session(core = wasm) {
  const stamp = getAuthStamp()
  const controller = new AbortController()
  return { wasm: core, apiBase: 'https://api.beebeeb.test', cache: new core.WasmDirectDiscoveryCache(), health: new core.WasmDirectHealth(), controller, current: () => !controller.signal.aborted && isCurrentAuthStamp(stamp) }
}
function windowBody(start = 0, count = 1, size = 0) {
  return { transport: 'object-download-v1', file_id: file, object_version_id: version,
    chunk_count: count, chunk_size: size || 1000, original_size: size * count, encrypted_size: (size + 28) * count,
    grants: Array.from({ length: count - start }, (_, n) => ({ index: n + start, method: 'GET', url: signature.replace('/0.bin', `/${n + start}.bin`), length: size + 28, expires_at: new Date(Date.now() + 300000).toISOString() })), next_index: null }
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function data(len = 28) { return new Response(new Uint8Array(len), { headers: { 'Content-Length': String(len) } }) }
function install(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = (async (url, init) => handler(String(url), init ?? {})) as typeof fetch
  setClientInfo('web', '1.1.0'); setApiUrl('https://api.beebeeb.test')
}
async function collect(source: AsyncIterable<Uint8Array>) { const frames = []; for await (const frame of source) frames.push(frame); return frames }
afterEach(() => { globalThis.fetch = original; Date.now = t0; globalThis.localStorage = originalStorage; setApiUrl('http://localhost:3001'); setAuthIdentity(null) })

test('capability only on grants; every API call has web and version; storage has no ambient credentials', async () => {
  const seen: string[] = []
  install((url, init) => {
    const headers = new Headers(init.headers)
    if (url.startsWith('https://api.')) {
      expect(headers.get('X-Beebeeb-Client')).toBe('web'); expect(headers.get('X-Beebeeb-Client-Version')).toBe('1.1.0')
      seen.push(url)
      expect(headers.get('X-Beebeeb-Capabilities')).toBe(url.endsWith('download-grants') ? 'object-download-v1' : null)
      if (url.endsWith('capabilities')) return json(disc)
      if (url.endsWith('download-grants')) return json(windowBody())
      return data()
    }
    expect(init.credentials).toBe('omit'); expect(init.referrerPolicy).toBe('no-referrer')
    expect(init.cache).toBe('no-store'); expect(init.redirect).toBe('error'); expect(init.headers).toBeUndefined()
    throw new TypeError(signature)
  })
  // Advancing the wall clock skips planner backoffs; health uses the monotonic clock.
  let clock = t0(); Date.now = () => clock += 10000
  const source = await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: session(), pairs: [pair] })
  expect((await collect(source!)).map(f => f.length)).toEqual([28])
  expect(seen.filter(u => u.includes('/chunks/')).length).toBe(1)
})

test('storage breaker bounds requests and puts the next file on API for ten minutes', async () => {
  let gets = 0, pinned = 0
  const s = session()
  install(url => {
    if (url.endsWith('capabilities')) return json(disc)
    if (url.endsWith('download-grants')) return json(windowBody())
    if (url.includes('/chunks/')) { pinned++; return data() }
    gets++; throw new TypeError('CORS rejected ' + signature)
  })
  let clock = t0(); Date.now = () => clock += 10000
  const first = await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: s, pairs: [pair] })
  await collect(first!)
  expect(gets).toBeGreaterThan(0); expect(gets).toBeLessThanOrEqual(16); expect(pinned).toBe(1)
  expect(s.health.mayStart('download', performance.now())).toBe(false)
  expect(await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: s, pairs: [pair] })).toBeNull()
})

test('missing allowlist pair and support switch cause zero grants or storage requests', async () => {
  let calls = 0
  install(url => { calls++; expect(url.endsWith('capabilities')).toBe(true); return json(disc) })
  const s = session()
  expect(await directChunks(file, { versionId: null, chunkFormat: 0 }, new AbortController().signal, { session: s, pairs: [] })).toBeNull()
  expect(calls).toBe(1)
  globalThis.localStorage = { getItem: () => 'api' } as Storage
  expect(await directChunks(file, { versionId: null, chunkFormat: 0 }, new AbortController().signal, { session: s, pairs: [pair] })).toBeNull()
  expect(calls).toBe(1)
})

test('storage rejects mismatched, truncated and oversized ciphertext lengths and non-200', async () => {
  for (const res of [new Response(new Uint8Array(27), { headers: { 'Content-Length': '28' } }), data(29), new Response('', { status: 302 }), new Response(new Uint8Array(29), { headers: { 'Content-Length': '28' } })]) {
    install(() => res)
    const link = { raw: () => signature } as wasm.WasmSignedUrl
    expect(await storageGet(link, 28, new AbortController().signal, wasm)).toEqual({ status: 0 })
  }
})

test('idle storage read aborts using the core thirty-second bound', async () => {
  expect(wasm.directTransferConstants().storage_get_idle_ms).toBe(30000)
  let aborted = false
  install((_url, init) => new Response(new ReadableStream({ start(c) {
    init.signal!.addEventListener('abort', () => { aborted = true; c.error(new TypeError(signature)) })
  } }), { headers: { 'Content-Length': '28' } }))
  const fast = { ...wasm, directTransferConstants: () => ({ ...wasm.directTransferConstants(), storage_get_idle_ms: 5 }) }
  expect(await storageGet({ raw: () => signature } as wasm.WasmSignedUrl, 28, new AbortController().signal, fast)).toEqual({ status: 0 })
  expect(aborted).toBe(true)
})

test('replaced version and authorization failures end negotiation without API fallback', async () => {
  for (const status of [401, 403, 404, 409]) {
    install(url => url.endsWith('capabilities') ? json(disc) : json({ error: status === 409 ? 'version_unavailable' : 'not found' }, status))
    await expect(directChunks(file, { versionId: version, chunkFormat: 2 }, new AbortController().signal, { session: session(), pairs: [pair] })).rejects.toThrow()
  }
})

test('one pinned version across windows; replacement fails after a prefix without a completion', async () => {
  let grants = 0
  install(url => {
    if (url.endsWith('capabilities')) return json(disc)
    if (url.endsWith('download-grants')) { grants++; const w = windowBody(0, 10, 1000); w.grants = w.grants.slice(0, 8); w.next_index = 8; if (grants > 1) w.object_version_id = '33333333-3333-4333-8333-333333333333'; return json(w) }
    return data(1028)
  })
  const source = await directChunks(file, { versionId: version, chunkFormat: 2 }, new AbortController().signal, { session: session(), pairs: [pair] })
  await expect(collect(source!)).rejects.toThrow()
  expect(grants).toBe(2)
})

test('account switch prevents any subsequent storage or API requests', async () => {
  let calls = 0
  install(url => { calls++; return url.endsWith('capabilities') ? json(disc) : json(windowBody()) })
  const source = await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: session(), pairs: [pair] })
  setAuthIdentity('another-account')
  await expect(collect(source!)).rejects.toThrow('Session changed')
  expect(calls).toBe(2)
})

test('our storage rejection never logs a signed URL; reports use the shared scrubber', async () => {
  const lines: string[] = []
  const log = console.error, warn = console.warn, info = console.log
  console.error = console.warn = console.log = (...args) => { lines.push(args.join(' ')) }
  try {
    install(() => { throw new TypeError(signature) })
    expect(await storageGet({ raw: () => signature } as wasm.WasmSignedUrl, 28, new AbortController().signal, wasm)).toEqual({ status: 0 })
    expect(lines.filter(l => l.includes('X-Amz-Signature')).length).toBe(0)
    expect(scrubText('download failed ' + signature)).not.toContain('X-Amz-Signature')
  } finally { console.error = log; console.warn = warn; console.log = info }
})

test('the driver caps a 256 MiB reorder window to one held chunk', async () => {
  const abort = new AbortController()
  let gets = 0, cap = 0
  class Planner extends wasm.WasmDownloadPlanner {
    setMaxInFlightBytes(n: number) { cap = n; super.setMaxInFlightBytes(n) }
  }
  install(url => {
    if (url.endsWith('capabilities')) return json(disc)
    if (url.endsWith('download-grants')) return json(windowBody(0, 3, 256 * 1024 * 1024))
    gets++; queueMicrotask(() => abort.abort()); throw new TypeError('network down')
  })
  const source = await directChunks(file, { versionId: version, chunkFormat: 0 }, abort.signal, { session: session({ ...wasm, WasmDownloadPlanner: Planner }), pairs: [pair] })
  await expect(collect(source!)).rejects.toThrow()
  expect(cap).toBe(64 * 1024 * 1024); expect(gets).toBe(1)
})

test('a tab asleep past link expiry renews before fetching without a failed fetch', async () => {
  let grants = 0, gets = 0, failures = 0
  class Planner extends wasm.WasmDownloadPlanner {
    fetchFailed(i: number, now: number) { failures++; super.fetchFailed(i, now) }
  }
  install(url => {
    if (url.endsWith('capabilities')) return json(disc)
    if (url.endsWith('download-grants')) { grants++; return json(windowBody()) }
    gets++; return data()
  })
  const source = await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: session({ ...wasm, WasmDownloadPlanner: Planner }), pairs: [pair] })
  Date.now = () => t0() + 301000
  expect((await collect(source!)).length).toBe(1)
  expect([grants, gets, failures]).toEqual([2, 1, 0])
})


test('a zero-byte direct file authenticates to empty plaintext through the existing core reader', async () => {
  const key = new Uint8Array(32).fill(7)
  const sealed = wasm.encrypt_chunk(key, new Uint8Array()) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const wire = new Uint8Array([...sealed.nonce, ...sealed.ciphertext])
  expect(wire.length).toBe(28)
  install(url => url.endsWith('capabilities') ? json(disc) : url.endsWith('download-grants') ? json(windowBody()) : new Response(wire, { headers: { 'Content-Length': '28' } }))
  const source = await directChunks(file, { versionId: version, chunkFormat: 0 }, new AbortController().signal, { session: session(), pairs: [pair] })
  const ops = createContentOps(wasm)
  const handle = ops.createDecryptor(key, file, 0)
  let opened = 0
  for await (const frame of source!) opened += ops.decryptorPushFrame(handle, frame).length
  expect(opened).toBe(0)
  expect(ops.decryptorFinish(handle).chunk_count).toBe(1)
})
