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

describe('LD-0001 r3 C3: one plaintext copy at peak, and progress on the buffered path', () => {
  async function withBlobSpy<T>(run: (captured: Uint8Array[]) => Promise<T>): Promise<T> {
    const captured: Uint8Array[] = []
    const RealBlob = globalThis.Blob
    class SpyBlob extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options)
        for (const part of parts ?? []) if (part instanceof Uint8Array) captured.push(part)
      }
    }
    globalThis.Blob = SpyBlob as typeof Blob
    try {
      return await run(captured)
    } finally {
      globalThis.Blob = RealBlob
    }
  }

  test('the_plaintext_is_zeroed_after_the_blob_copy', async () => {
    const f = buildFixture()
    for (const kind of ['live', 'version'] as const) {
      serve(f)
      await withBlobSpy(async (captured) => {
        const blob =
          kind === 'live'
            ? (await dl.decryptToBlob(f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length)).plaintext
            : await dl.decryptVersionToBlob(f.fileId, 'v1', f.fileKey, f.name, null, f.chunkCount, f.plain.length)
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(f.plain)
        expect(captured.length).toBe(1)
        expect(captured[0].length).toBe(f.plain.length)
        expect(allZero(captured[0])).toBe(true)
      })
    }
  })

  test('the_buffered_path_reports_byte_progress_from_the_real_body', async () => {
    const f = buildFixture()
    serve(f, { contentLength: null, piece: 7 })
    const events: TransferProgress[] = []
    const res = await dl.decryptToBlob(f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length, {
      onProgress: (p) => events.push({ ...p }),
    })
    expect(new Uint8Array(await res.plaintext.arrayBuffer())).toEqual(f.plain)
    const downloading = events.filter((e) => e.phase === 'downloading')
    expect(downloading.length).toBeGreaterThan(0)
    expect(downloading.every((e) => e.totalBytes === null)).toBe(true)
    expect(downloading.some((e) => e.receivedBytes > 0 && e.receivedBytes < f.wire.length)).toBe(true)
    expect(events.at(-1)).toMatchObject({
      phase: 'done',
      receivedBytes: f.wire.length,
      totalBytes: f.wire.length,
      decryptedChunks: f.chunkCount,
    })
  })
})

describe('LD-0001 r3 C4: the over-cap Download is cancellable and reports progress', () => {
  test('the_over_cap_download_passes_signal_and_on_progress', async () => {
    const calls: unknown[][] = []
    const abort = new AbortController()
    const onProgress = () => {}
    await dl.streamOverCapDownload(overCapArgs(), { signal: abort.signal, onProgress }, (async (...args: unknown[]) => {
      calls.push(args)
    }) as typeof dl.encryptedDownload)
    const opts = calls[0][6] as Record<string, unknown> | undefined
    expect(opts?.signal).toBe(abort.signal)
    expect(opts?.onProgress).toBe(onProgress)
  })
})

describe('LD-0001 r3 C5: the cap and the renderer agree on what is media', () => {
  test('the_row_mime_counts_first_like_the_renderer', async () => {
    const cap = policy.WHOLE_FILE_MEDIA_CAP_BYTES
    // The authenticated metadata names no media type; the row says video.
    const f = buildFixture({ name: 'clip.bin', mime: null })
    serve(f)
    const err = await expectRejection(
      dl.decryptToBlob(f.fileId, f.fileKey, f.name, 'video/mp4', f.chunkCount, cap + 1, {
        mediaCapBytes: cap,
        rowMimeType: 'video/mp4',
      }),
    )
    expect(err).toBeInstanceOf(policy.TooLargeToPreviewError)
    expect(fetchCalls).toBe(0)
  })

  test('without_a_row_mime_the_authenticated_metadata_decides', async () => {
    const cap = policy.WHOLE_FILE_MEDIA_CAP_BYTES
    const f = buildFixture({ name: 'holiday.mp4', mime: 'video/mp4' })
    const err = await expectRejection(
      dl.decryptVersionToBlob(f.fileId, 'v1', f.fileKey, f.name, null, f.chunkCount, cap + 1, {
        mediaCapBytes: cap,
        rowMimeType: null,
      }),
    )
    expect(err).toBeInstanceOf(policy.TooLargeToPreviewError)
    expect(fetchCalls).toBe(0)
  })
})

describe('LD-0001 r3 C6: the load effect does not restart when the name resolves', () => {
  // Source-level guard: FilePreview is not rendered under bun (it needs the
  // key context, the API and every renderer). The effect's dependency list is
  // what decides a restart, so the list itself is asserted.
  test('the_load_effect_is_keyed_on_file_id_and_version_not_on_name_or_mime', () => {
    const path = fileURLToPath(new URL('../src/components/preview/file-preview.tsx', import.meta.url))
    const src = readFileSync(path, 'utf8')
    const start = src.indexOf('// Load + decrypt content for the current selection')
    expect(start).toBeGreaterThan(0)
    const marker = src.indexOf('// `versions` is intentionally NOT a dependency', start)
    expect(marker).toBeGreaterThan(start)
    const depsLine = src.slice(marker).split('\n').find((line) => /^\s*\}, \[/.test(line))
    expect(depsLine).toBeDefined()
    const match = /\}, \[(.*)\]\)/.exec(depsLine!)
    expect(match).not.toBeNull()
    const deps = match![1].split(',').map((d) => d.trim())
    expect(deps).toContain('file.id')
    expect(deps).toContain('selectedVersionId')
    for (const banned of ['name', 'effectiveMime', 'file', 'file.mime_type', 'file.name_encrypted']) {
      expect(deps).not.toContain(banned)
    }
  })
})

describe('LD-0001 r3 C7: the progress throttle starts fresh per attempt', () => {
  const event = (over: Partial<TransferProgress>): TransferProgress => ({
    phase: 'downloading', receivedBytes: 0, totalBytes: 100, decryptedChunks: 0, totalChunks: 1, ...over,
  })

  test('reset_lets_the_next_attempt_emit_at_once', () => {
    const updates: TransferProgress[] = []
    let clock = 0
    const cancelled: number[] = []
    let nextTimer = 1
    const t = createTransferThrottle(
      (p) => updates.push(p),
      () => clock,
      () => nextTimer++ as never,
      (id) => { cancelled.push(id as unknown as number) },
    )
    t.push(event({ receivedBytes: 10 }))
    clock = 20
    t.push(event({ receivedBytes: 20 })) // deferred behind the 150 ms window
    t.reset()
    expect(cancelled).toEqual([1]) // the deferred timer is dropped
    clock = 40
    t.push(event({ receivedBytes: 1 })) // the next attempt's first event
    expect(updates.map((u) => u.receivedBytes)).toEqual([10, 1])
  })
})
