/**
 * LD-0001 PR-C round 3 (web #205): the review fixes for honest progress and
 * the over-cap Download. Real core crypto through the committed WASM build
 * (test/helpers/wasm-crypto-mirror.ts); `fetch` is a stub that counts calls.
 * One section per review row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { installWasmCryptoMirror } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const mirror = await installWasmCryptoMirror()
const { wasm } = mirror

await mockModuleScoped('../src/lib/decrypt-events', import.meta.dir, {
  dispatchDecrypted: () => {},
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getToken: () => null,
  getApiUrl: () => 'http://api.test',
})

const dl = await import('../src/lib/encrypted-download')
const policy = await import('../src/lib/preview-load-policy')
const { createTransferThrottle } = await import('../src/lib/progress-throttle')
type TransferProgress = import('../src/lib/encrypted-download').TransferProgress

const GiB = 1024 ** 3

// ── Fixtures (as in ld0001-c-r2.test.ts) ─────────────────────────────────────

interface Fixture {
  fileId: string
  fileKey: Uint8Array
  name: string
  wire: Uint8Array
  chunkCount: number
  chunkSize: number
  plain: Uint8Array
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function buildFixture(opts: { name?: string; mime?: string | null } = {}): Fixture {
  const masterKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
  const fileId = '1d0001c0-0000-4000-8000-0000000000c3'
  const fileKey = wasm.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
  const chunkSize = 64
  const plain = new Uint8Array(150).map((_, i) => (i * 31 + 11) & 0xff)
  const enc = wasm.WasmChunkEncryptor.withChunkSize(masterKey, fileId, BigInt(plain.length), BigInt(chunkSize))
  const wireParts: Uint8Array[] = []
  for (let off = 0; off < plain.length; off += chunkSize) {
    wireParts.push(enc.pushChunk(plain.slice(off, off + chunkSize)) as Uint8Array)
  }
  enc.finish()
  const meta = wasm.encrypt_metadata(
    fileKey,
    JSON.stringify({ name: opts.name ?? 'progress.bin', mime_type: opts.mime ?? null }),
  ) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const name = JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from(meta.nonce),
    ciphertext: Array.from(meta.ciphertext),
  })
  return { fileId, fileKey, name, wire: concat(wireParts), chunkCount: wireParts.length, chunkSize, plain }
}

interface Served {
  body: Uint8Array
  chunkCount: number
  chunkSize: number
  piece: number
  contentLength: number | null
}
let served: Served | null = null
let fetchCalls = 0
let fetchUrls: string[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
  served = null
  fetchCalls = 0
  fetchUrls = []
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    fetchCalls++
    fetchUrls.push(String(url))
    if (!served) return new Response('not found', { status: 404 })
    const headers: Record<string, string> = {
      'X-Chunk-Count': String(served.chunkCount),
      'X-Chunk-Size': String(served.chunkSize),
    }
    if (served.contentLength !== null) headers['Content-Length'] = String(served.contentLength)
    const body = served.body
    const piece = served.piece
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let off = 0; off < body.length; off += piece) c.enqueue(body.slice(off, off + piece))
        c.close()
      },
    })
    return new Response(stream, { status: 200, headers })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

function serve(f: Fixture, opts: { piece?: number; contentLength?: number | null } = {}) {
  served = {
    body: f.wire,
    chunkCount: f.chunkCount,
    chunkSize: f.chunkSize,
    piece: opts.piece ?? 7,
    contentLength: opts.contentLength === undefined ? f.wire.length : opts.contentLength,
  }
}

function allZero(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b !== 0) return false
  return true
}

async function expectRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error('expected a rejection')
}

const overCapArgs = (over: Partial<import('../src/lib/encrypted-download').OverCapDownloadArgs> = {}) => ({
  fileId: 'f-1',
  fileKey: new Uint8Array(32),
  nameEncrypted: 'enc',
  mimeType: 'video/mp4',
  versionId: null,
  chunkCount: 768,
  sizeBytes: 3 * GiB,
  ...over,
})

describe('LD-0001 r3 C1: an over-cap past version never buffers', () => {
  test('a_3GiB_past_version_on_the_card_streams_to_disk', () => {
    const action = policy.chooseDownloadAction({
      hasOriginalBlob: false,
      overCap: true,
      selectedVersionId: 'v-old',
      file: { chunk_count: 1, size_bytes: 10 },
      version: { id: 'v-old', chunk_count: 768, size_bytes: 3 * GiB },
    })
    expect(action).toEqual({ kind: 'stream-to-disk', versionId: 'v-old', chunkCount: 768, sizeBytes: 3 * GiB })
  })

  test('the_stream_carries_the_version_id_to_the_download', async () => {
    const calls: unknown[][] = []
    await dl.streamOverCapDownload(overCapArgs({ versionId: 'v-old' }), {}, (async (...args: unknown[]) => {
      calls.push(args)
    }) as typeof dl.encryptedDownload)
    expect(calls.length).toBe(1)
    expect(calls[0].slice(4, 6)).toEqual([768, 3 * GiB])
    expect((calls[0][6] as Record<string, unknown> | undefined)?.versionId).toBe('v-old')
  })

  test('a_version_download_reads_the_version_endpoint', () => {
    expect(dl.downloadUrlFor('f-1', 'v-old')).toBe('http://api.test/api/v1/files/f-1/versions/v-old/download')
    expect(dl.downloadUrlFor('f-1', null)).toBe('http://api.test/api/v1/files/f-1/download')
  })
})

describe('LD-0001 r3 C2: the over-cap path refuses instead of buffering', () => {
  test('no_service_worker_means_an_honest_refusal_and_no_fetch', async () => {
    const f = buildFixture({ name: 'big.mp4', mime: 'video/mp4' })
    serve(f)
    // bun has no navigator.serviceWorker: the streaming save is unavailable.
    const err = await expectRejection(
      dl.encryptedDownload(f.fileId, f.fileKey, f.name, null, f.chunkCount, 3 * GiB, { neverBuffer: true }),
    )
    expect((err as Error).message).toBe(
      'This file is too large to download in this browser window. Reload the page and try again.',
    )
    expect(fetchCalls).toBe(0)
  })

  test('the_over_cap_stream_asks_never_to_buffer', async () => {
    const calls: unknown[][] = []
    await dl.streamOverCapDownload(overCapArgs(), {}, (async (...args: unknown[]) => {
      calls.push(args)
    }) as typeof dl.encryptedDownload)
    expect((calls[0][6] as Record<string, unknown> | undefined)?.neverBuffer).toBe(true)
  })

  test('the_card_routing_follows_downloadRoute', () => {
    for (const hasOriginalBlob of [true, false]) {
      for (const overCap of [true, false]) {
        for (const selectedVersionId of [null, 'v1']) {
          const action = policy.chooseDownloadAction({
            hasOriginalBlob,
            overCap,
            selectedVersionId,
            file: { chunk_count: 1, size_bytes: 10 },
            version: selectedVersionId ? { id: 'v1', chunk_count: 1, size_bytes: 10 } : null,
          })
          const route = policy.downloadRoute(hasOriginalBlob, overCap)
          if (route === 'stream') expect(action.kind).toBe('stream-to-disk')
          else expect(action.kind).not.toBe('stream-to-disk')
        }
      }
    }
  })
})
