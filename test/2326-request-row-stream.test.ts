/**
 * 2326 review P2-1: a request row's media streams through the REAL resolver.
 *
 * A request row has no content key to hand to the stream session; it has a
 * decrypt-only `RequestContentSource`. The session must carry that source to
 * the worker and open EVERY frame (head, tail, a seek) through the core
 * reader's `openFrame` — never ask for raw bytes.
 *
 * This file drives the PRODUCTION resolver (`createRequestRowResolver`, the
 * worker engine) over a fake worker port: only the crypto worker's own calls
 * (resolve/decryptor/openFrame/free) are served in-process by the committed
 * wasm build, exactly as the worker would. Before the P2-1 fix the engine's
 * `startStream()` returned no `handle`, so the session's `createChunkReader`
 * asked for `decryptor(undefined)` and the player showed its error card.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { FakeChunkSource, FakeClock } from './helpers/media-stream-fixtures'
import { createContentOps } from '../src/lib/content-crypto'
import { openFileMetadata } from '../src/lib/encrypted-download'
import { resolveRequestRowWith } from '../src/lib/request-row'
import { toBase64 } from '../src/lib/crypto/helpers'
import type { FileRequest } from '../src/lib/api'
import type { StreamRow, WorkerReaderDeps } from '../src/lib/media-stream/session'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const FILE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const EMPTY = new Uint8Array()
const CHUNK_SIZE = 32
const PLAINTEXT = new Uint8Array(96)
for (let i = 0; i < PLAINTEXT.length; i++) PLAINTEXT[i] = i + 1

const rPub = wasm.derive_x25519_public(RPRIV) as Uint8Array
const wrappedPriv = wasm.wrap_request_private(MASTER, EMPTY, RPRIV) as {
  wrapped: Uint8Array
  nonce: Uint8Array
}

function envelope(key: Uint8Array, name: string, mimeType: string): string {
  const enc = wasm.encrypt_metadata(key, JSON.stringify({ name, mime_type: mimeType })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return wasm.encodeMetadataEnvelope(enc.nonce, enc.ciphertext)
}

/** One v1 wire frame (`nonce || ciphertext || tag`) sealed under C. */
function v1Frame(plaintext: Uint8Array): Uint8Array {
  const enc = wasm.encrypt_chunk(CONTENT, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const frame = new Uint8Array(enc.nonce.length + enc.ciphertext.length)
  frame.set(enc.nonce, 0)
  frame.set(enc.ciphertext, enc.nonce.length)
  return frame
}

const sealed = wasm.seal_to_request(rPub, EMPTY, CONTENT) as {
  e_pub: Uint8Array
  wrapped_key: Uint8Array
}
const NAME = envelope(CONTENT, 'clip.mp4', 'video/mp4')

/** The listed row the resolver is asked to read. */
const FILE_ROW = {
  id: FILE_ID,
  name_encrypted: NAME,
  file_request_id: REQUEST_ID,
  sender_ephemeral_pubkey: toBase64(sealed.e_pub),
  wrapped_content_key: toBase64(sealed.wrapped_key),
}

/** The owner's `GET /file-requests` row for this request. */
const REQUEST_ROW = {
  id: REQUEST_ID,
  wrapped_private_key: toBase64(wrappedPriv.wrapped),
  wrap_nonce: toBase64(wrappedPriv.nonce),
} as FileRequest

// ── The fake worker port ────────────────────────────────────────────────────
// Every frame the core reader opens, in order (the seek assertions below).
const opened: Array<{ index: number; isLast: boolean; format: number }> = []

// `requestReaderDecryptor` over the in-process reader: exactly what the worker
// would do with the handle `resolveRequestRow` returned.
const realResolve = (args: Parameters<typeof resolveRequestRowWith>[1]) =>
  resolveRequestRowWith(wasm as never, args)

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  listFileRequests: async () => ({ file_requests: [REQUEST_ROW] }),
})
await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  async resolveRequestRowWorker(args: Parameters<typeof realResolve>[0]) {
    const row = realResolve(args)
    // Register the row's decrypt-only reader, recording each authenticated
    // frame open — the worker keeps the reader behind a handle.
    const spy = {
      get fileId() {
        return row.content.fileId
      },
      get chunkFormat() {
        return row.content.chunkFormat
      },
      decryptor: () => row.content.decryptor(),
      openFrame: (
        versionId: Uint8Array,
        index: number,
        isLast: boolean,
        format: number,
        frame: Uint8Array,
      ) => {
        opened.push({ index, isLast, format })
        return row.content.openFrame(versionId, index, isLast, format, frame)
      },
      free: () => row.content.free(),
    }
    const handle = ops.registerRequestReader(spy as never)
    return {
      handle,
      fileId: row.content.fileId,
      chunkFormat: row.chunkFormat,
      nameOrigin: row.nameOrigin,
      name: row.name,
      mimeType: row.mimeType,
      seal: row.seal,
      renameTarget: row.renameTarget,
    }
  },
  requestReaderDecryptor: async (readerHandle: number) => ops.requestReaderDecryptor(readerHandle),
  decryptorPushFrame: async (handle: number, frame: Uint8Array) => ops.decryptorPushFrame(handle, frame),
  decryptorFinish: async (handle: number) => ops.decryptorFinish(handle),
  decryptorDispose: async (handle: number) => ops.decryptorDispose(handle),
  requestReaderOpenFrame: async (
    readerHandle: number,
    versionId: Uint8Array,
    index: number,
    isLast: boolean,
    format: number,
    frame: Uint8Array,
  ) => ops.requestReaderOpenFrame(readerHandle, versionId, index, isLast, format, frame),
  requestReaderFree: async (readerHandle: number) => ops.requestReaderFree(readerHandle),
})

// Imported AFTER the port is installed: the resolver's `./crypto` imports are
// the slotted namespace, so its `startStream`/`openFrame` land in the fake
// worker above.
const { createRequestRowResolver } = await import('../src/lib/request-row-resolver')
const { startDecryptStream } = await import('../src/lib/crypto')
const { createWorkerReaderFactory, openStreamSession } = await import('../src/lib/media-stream/session')

function rowFor(frames: Uint8Array[]): StreamRow {
  return {
    chunk_count: frames.length,
    size_bytes: PLAINTEXT.length,
    download_version: {
      object_version_id: 'ov-request',
      version_number: 1,
      chunk_count: frames.length,
      chunk_size_bytes: CHUNK_SIZE,
      plaintext_size_bytes: PLAINTEXT.length,
      ciphertext_size_bytes: frames.reduce((n, f) => n + f.length, 0),
      chunks: frames.map((f, index) => ({ index, size_bytes: f.length })),
    },
  }
}

describe('2326 P2-1: the real request-row source streams through the worker port', () => {
  test('startStream returns a live handle; the head, tail and a seek open through it', async () => {
    const resolver = createRequestRowResolver()
    const resolved = await resolver.resolveRow(FILE_ROW, MASTER)
    expect(resolved.name).toBe('clip.mp4')
    expect(resolved.mimeType).toBe('video/mp4')

    // The worker decryptor must carry the handle `createChunkReader` needs; a
    // stream object without one is the production failure P2-1 fixed.
    const probe = await resolved.content.startStream()
    expect(typeof probe.handle).toBe('number')
    expect(probe.handle).toBeGreaterThanOrEqual(0)
    await probe.dispose()

    // The metadata read accepts the source directly and reports its pin.
    const meta = await openFileMetadata(FILE_ID, resolved.content, 'clip.mp4')
    expect(meta.content).toEqual({ fileId: FILE_ID, pin: 0 })
    expect(meta.name).toBe('clip.mp4')

    const frames = [
      v1Frame(PLAINTEXT.slice(0, CHUNK_SIZE)),
      v1Frame(PLAINTEXT.slice(CHUNK_SIZE, 2 * CHUNK_SIZE)),
      v1Frame(PLAINTEXT.slice(2 * CHUNK_SIZE)),
    ]
    const chunkSource = new FakeChunkSource(frames)
    let sawSource: unknown = null
    const deps: WorkerReaderDeps = {
      async startDecryptStream(fileKey) {
        // The session hands the SOURCE over, not bytes.
        sawSource = fileKey
        return startDecryptStream(fileKey, FILE_ID, 0)
      },
      async createChunkReader(decryptor) {
        // The worker-side random-access reader, over the handle the source
        // actually provides (no handle → "No live decryptor for handle
        // undefined" here, the player's error card in production).
        const handle = ops.createChunkReader(decryptor.handle)
        return {
          openAt: async (index, isLast, frame) => ops.openChunkAt(handle, index, isLast, frame),
          close: async () => {
            ops.closeChunkReader(handle)
          },
        }
      },
    }

    const session = await openStreamSession({
      fileId: FILE_ID,
      fileKey: resolved.content,
      content: meta.content,
      row: rowFor(frames),
      source: chunkSource,
      clock: new FakeClock(),
      readerFactory: createWorkerReaderFactory(deps),
    })

    expect(sawSource).toBe(resolved.content)
    expect(session.chunkCount).toBe(3)
    expect(session.totalSize).toBe(PLAINTEXT.length)
    // Setup opened the head and the tail; the tail went through openFrame.
    expect(opened).toContainEqual({ index: 2, isLast: true, format: 1 })

    // A seek into chunk 1 opens exactly that frame through openFrame.
    const bytes = await session.read('req-1', CHUNK_SIZE + 8, 10)
    expect(Array.from(bytes)).toEqual(Array.from(PLAINTEXT.slice(CHUNK_SIZE + 8, CHUNK_SIZE + 18)))
    expect(opened).toContainEqual({ index: 1, isLast: false, format: 1 })

    await session.close()
    resolver.clear()
  })

  test('the preview resolves the source itself: no contentKeyBytes on the stream key', () => {
    const path = fileURLToPath(new URL('../src/components/preview/file-preview.tsx', import.meta.url))
    const src = readFileSync(path, 'utf8')
    const start = src.indexOf('const resolveStreamKey')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 400)
    expect(body).toContain('resolveFileKey')
    expect(body).toContain('.key')
    expect(body).not.toContain('contentKeyBytes')
  })
})
