import { afterEach, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { hexToBytes, installWasmCryptoMirror, loadVectors, toHex } from './helpers/wasm-crypto-mirror'

const mirror = await installWasmCryptoMirror()
const { wasm } = mirror
const vector = loadVectors().chunk_v2_single_frame
const name = loadVectors().metadata_v2_name.name_encrypted as string
const pair = { host: 's3.storage.test', bucket: 'bb-01' }
let initFailure = false
await mockModuleScoped('../src/lib/direct/session', import.meta.dir, {
  getDirectSession: async () => {
    if (initFailure) throw new Error('Direct transport initialization failed')
    const controller = new AbortController()
    return { wasm, controller, apiBase: 'http://api.test', current: () => true,
      cache: new wasm.WasmDirectDiscoveryCache(), health: new wasm.WasmDirectHealth() }
  },
})
await mockModuleScoped('../src/lib/direct/allowlist', import.meta.dir, { configuredPairs: () => [pair] })
await mockModuleScoped('../src/lib/api', import.meta.dir, { getToken: () => null, getApiUrl: () => 'http://api.test' })
await mockModuleScoped('../src/lib/decrypt-events', import.meta.dir, { dispatchDecrypted: () => {} })
const { decryptToBlob } = await import('../src/lib/encrypted-download')
const original = globalThis.fetch
let calls: string[] = []
afterEach(() => { globalThis.fetch = original; initFailure = false; calls = [] })

for (const mode of ['recover', 'init', 'truncated'] as const) {
  const fallback = mode === 'init'
  test(`${mode}: direct reader authenticates content and checks completion`, async () => {
    initFailure = fallback
    const healthy = hexToBytes(mode === 'truncated' ? loadVectors().chunk_v2_stream.frames[0].frame_hex : vector.wire_hex)
    const bad = healthy.slice(); bad[bad.length - 1] ^= 1
    const size = healthy.length - 28
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('capabilities')) return Response.json({ download: ['object-download-v1'], storage_hosts: [pair.host], storage_buckets: [pair] })
      if (url.endsWith('download-grants')) return Response.json({ transport: 'object-download-v1', file_id: vector.file_id,
        object_version_id: '22222222-2222-4222-8222-222222222222', chunk_count: 1, chunk_size: size,
        original_size: size, encrypted_size: healthy.length, next_index: null,
        grants: [{ index: 0, method: 'GET', length: healthy.length, expires_at: new Date(Date.now() + 300000).toISOString(), url: 'https://s3.storage.test/bb-01/frame' }] })
      const bytes = url.startsWith('https://s3.') ? bad : healthy
      return new Response(bytes.slice(), { headers: { 'Content-Length': String(bytes.length), 'X-Chunk-Count': '1', 'X-Chunk-Size': String(size) } })
    }) as typeof fetch
    const download = decryptToBlob(vector.file_id, hexToBytes(vector.file_key_hex), name, null, 1, size)
    if (mode === 'truncated') {
      await expect(download).rejects.toThrow()
      expect(calls.filter(url => url.includes('/chunks/0?object_version_id=')).length).toBe(1)
      return
    }
    const result = await download
    expect(toHex(new Uint8Array(await result.plaintext.arrayBuffer()))).toBe(vector.plaintext_hex)
    expect(calls.filter(url => url.endsWith('/download')).length).toBe(fallback ? 1 : 0)
    expect(calls.filter(url => url.includes('/chunks/0?object_version_id=')).length).toBe(fallback ? 0 : 1)
  })
}
