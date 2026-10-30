/**
 * LD-0001 PR-C — honest whole-file progress on web.
 *
 * Drives web's real download code (`src/lib/encrypted-download.ts`) against
 * real core crypto (the committed WASM build through the same ops the crypto
 * worker runs; see test/helpers/wasm-crypto-mirror.ts). `fetch` is a stub that
 * serves the ciphertext as a `ReadableStream` in small pieces, so a test can
 * see what the caller observes while bytes are still arriving.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installWasmCryptoMirror, toHex } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const mirror = await installWasmCryptoMirror()
const { wasm, ops } = mirror

await mockModuleScoped('../src/lib/decrypt-events', import.meta.dir, {
  dispatchDecrypted: () => {},
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getToken: () => null,
  getApiUrl: () => 'http://api.test',
})

const dl = await import('../src/lib/encrypted-download')
type TransferProgress = import('../src/lib/encrypted-download').TransferProgress

// ── Fixture: a 3-chunk v1 file written by the current web upload path ────────

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

function buildFixture(): Fixture {
  const masterKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
  const fileId = '1d0001c0-0000-4000-8000-0000000000c1'
  const fileKey = wasm.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
  const chunkSize = 64
  const plain = new Uint8Array(150).map((_, i) => (i * 31 + 11) & 0xff)
  // Exactly what encrypted-upload.ts does for a NEW file: no pin applied (v1).
  const enc = wasm.WasmChunkEncryptor.withChunkSize(masterKey, fileId, BigInt(plain.length), BigInt(chunkSize))
  const wireParts: Uint8Array[] = []
  for (let off = 0; off < plain.length; off += chunkSize) {
    wireParts.push(enc.pushChunk(plain.slice(off, off + chunkSize)) as Uint8Array)
  }
  enc.finish()
  const meta = wasm.encrypt_metadata(fileKey, JSON.stringify({ name: 'progress.bin', mime_type: null })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  const name = JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from(meta.nonce),
    ciphertext: Array.from(meta.ciphertext),
  })
  return { fileId, fileKey, name, wire: concat(wireParts), chunkCount: wireParts.length, chunkSize, plain }
}

// ── Stub server: ciphertext in small pieces, Content-Length present ──────────

interface Served {
  body: Uint8Array
  chunkCount: number
  chunkSize: number
  piece: number
  contentLength: number | null
}
let served: Served | null = null
const realFetch = globalThis.fetch

beforeEach(() => {
  served = null
  globalThis.fetch = (async () => {
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
        for (let off = 0; off < body.length; off += piece) {
          c.enqueue(body.slice(off, off + piece))
        }
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

function serve(f: Fixture, opts: { body?: Uint8Array; piece?: number; contentLength?: number | null } = {}) {
  served = {
    body: opts.body ?? f.wire,
    chunkCount: f.chunkCount,
    chunkSize: f.chunkSize,
    piece: opts.piece ?? 7,
    contentLength: opts.contentLength === undefined ? (opts.body ?? f.wire).length : opts.contentLength,
  }
}

function allZero(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b !== 0) return false
  return true
}

// ── T1 ───────────────────────────────────────────────────────────────────────

describe('whole-file progress', () => {
  test('whole_file_progress_reports_download_and_decrypt_separately', async () => {
    const f = buildFixture()
    serve(f)
    const events: TransferProgress[] = []
    const { plaintext } = await dl.decryptToBlob(
      f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length,
      { onProgress: (p) => events.push({ ...p }) },
    )
    expect(toHex(new Uint8Array(await plaintext.arrayBuffer()))).toBe(toHex(f.plain))
    expect(events.length).toBeGreaterThan(0)

    for (let i = 1; i < events.length; i++) {
      expect(events[i].decryptedChunks).toBeGreaterThanOrEqual(events[i - 1].decryptedChunks)
      expect(events[i].receivedBytes).toBeGreaterThanOrEqual(events[i - 1].receivedBytes)
    }

    const last = events[events.length - 1]
    expect(last).toEqual({
      phase: 'done',
      receivedBytes: f.wire.length,
      totalBytes: f.wire.length,
      decryptedChunks: 3,
      totalChunks: 3,
    })
  })

  // ── T2 ─────────────────────────────────────────────────────────────────────

  test('never_decrypting_while_bytes_are_still_arriving', async () => {
    const f = buildFixture()
    serve(f)
    const events: TransferProgress[] = []
    await dl.decryptToBlob(
      f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length,
      { onProgress: (p) => events.push({ ...p }) },
    )
    expect(events.filter((e) => e.phase === 'decrypting').length).toBeGreaterThan(0)
    for (const event of events) {
      if (event.phase !== 'decrypting') continue
      expect(event.receivedBytes).toBe(event.totalBytes)
    }
  })

  // ── T4 ─────────────────────────────────────────────────────────────────────

  test('whole_file_parts_are_wiped_on_success_and_failure', async () => {
    const f = buildFixture()
    const captured: Uint8Array[] = []
    const originalPush = ops.decryptorPushFrame
    ops.decryptorPushFrame = async (handle: number, frame: Uint8Array) => {
      const out = await originalPush(handle, frame)
      captured.push(out)
      return out
    }
    try {
      // Success: every plaintext part handed back is zeroed after the copy.
      captured.length = 0
      serve(f)
      const events: TransferProgress[] = []
      await dl.decryptToBlob(
        f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length,
        { onProgress: (p) => events.push({ ...p }) },
      )
      // Only the pipelined path reports progress; this test is about that path.
      expect(events.length).toBeGreaterThan(0)
      expect(captured.length).toBe(3)
      for (const part of captured) expect(allZero(part)).toBe(true)

      // Failure at chunk 2 (a flipped tag byte): parts 0 and 1 are still wiped.
      captured.length = 0
      const bad = f.wire.slice()
      bad[bad.length - 1] ^= 0xff
      serve(f, { body: bad })
      await expect(
        dl.decryptToBlob(
          f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length,
          { onProgress: () => {} },
        ),
      ).rejects.toThrow()
      expect(captured.length).toBe(2)
      for (const part of captured) expect(allZero(part)).toBe(true)
    } finally {
      ops.decryptorPushFrame = originalPush
    }
  })
})
