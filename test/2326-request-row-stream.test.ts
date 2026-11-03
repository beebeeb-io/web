/**
 * 2326 review P2-1: a request row's media streams.
 *
 * A request row has no content key to hand to the stream session; it has a
 * decrypt-only `RequestContentSource`. The session must carry that source to
 * the worker and open EVERY frame (head, tail, a seek) through the core
 * reader's `openFrame` — never ask for raw bytes. Before the fix, the preview
 * called `contentKeyBytes` on the source and showed the stream error card.
 *
 * The fixture is a real core request row (same shapes as
 * test/2326-request-row-reader.test.ts) with three v1 frames; the reader is
 * wrapped so every `openFrame` call is recorded.
 */
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { FakeChunkSource, FakeClock } from './helpers/media-stream-fixtures'
import { createContentOps } from '../src/lib/content-crypto'
import { openFileMetadata } from '../src/lib/encrypted-download'
import {
  createRequestContentSource,
  isRequestContentSource,
  resolveRequestRowWith,
  type RequestDecryptor,
  type RequestRowResolution,
} from '../src/lib/request-row'
import {
  createWorkerReaderFactory,
  openStreamSession,
  type StreamRow,
  type WorkerReaderDeps,
} from '../src/lib/media-stream/session'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const FILE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
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

function resolveRequestRow(): RequestRowResolution {
  const sealed = wasm.seal_to_request(rPub, EMPTY, CONTENT) as {
    e_pub: Uint8Array
    wrapped_key: Uint8Array
  }
  return resolveRequestRowWith(wasm, {
    masterKey: MASTER,
    itemId: FILE_ID,
    requestWrapContext: EMPTY,
    wrappedRequestPrivate: wrappedPriv.wrapped,
    wrapNonce: wrappedPriv.nonce,
    senderEphemeralPubkey: sealed.e_pub,
    wrappedContentKey: sealed.wrapped_key,
    nameEncrypted: envelope(CONTENT, 'clip.mp4', 'video/mp4'),
  })
}

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

describe('2326 P2-1: a request row streams through its reader, never a raw key', () => {
  test('a seek reads chunk 1 through openFrame and setup opened the tail', async () => {
    const row = resolveRequestRow()
    expect(row.name).toBe('clip.mp4')
    expect(row.mimeType).toBe('video/mp4')

    // Record every frame the core reader opens.
    const opened: Array<{ index: number; isLast: boolean; format: number }> = []
    const spyReader = {
      free: () => row.content.free(),
      decryptor: () => row.content.decryptor(),
      openFrame: (versionId: Uint8Array, index: number, isLast: boolean, format: number, frame: Uint8Array) => {
        opened.push({ index, isLast, format })
        return row.content.openFrame(versionId, index, isLast, format, frame)
      },
      get chunkFormat() {
        return row.content.chunkFormat
      },
      get fileId() {
        return row.content.fileId
      },
    }
    const readerHandle = ops.registerRequestReader(spyReader as never)

    // The source the page hands to the stream is a RequestContentSource: no key.
    const source = createRequestContentSource({
      fileId: row.content.fileId,
      chunkFormat: row.content.chunkFormat,
      name: row.name,
      mimeType: row.mimeType,
      async startStream() {
        const handle = ops.requestReaderDecryptor(readerHandle)
        const decryptor: RequestDecryptor & { handle: number } = {
          handle,
          pushFrame: async (frame) => ops.decryptorPushFrame(handle, frame),
          finish: async () => ops.decryptorFinish(handle) as never,
          dispose: async () => ops.decryptorDispose(handle),
        }
        return decryptor
      },
      openFrame: async (versionId, index, isLast, format, frame) =>
        ops.requestReaderOpenFrame(readerHandle, versionId, index, isLast, format, frame),
      close: async () => ops.requestReaderFree(readerHandle),
    })
    expect(isRequestContentSource(source)).toBe(true)

    // The metadata read accepts the source directly and reports its pin.
    const meta = await openFileMetadata(FILE_ID, source, 'clip.mp4')
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
        return (await source.startStream()) as never
      },
      async createChunkReader(decryptor) {
        const handle = ops.createChunkReader(decryptor.handle)
        return {
          openAt: async (index, isLast, frame) => ops.openChunkAt(handle, index, isLast, frame),
          close: async () => ops.closeChunkReader(handle),
        }
      },
    }

    const session = await openStreamSession({
      fileId: FILE_ID,
      fileKey: source,
      content: meta.content,
      row: rowFor(frames),
      source: chunkSource,
      clock: new FakeClock(),
      readerFactory: createWorkerReaderFactory(deps),
    })

    expect(sawSource).toBe(source)
    expect(session.chunkCount).toBe(3)
    expect(session.totalSize).toBe(PLAINTEXT.length)
    // Setup opened the head and the tail; the tail went through openFrame.
    expect(opened).toContainEqual({ index: 2, isLast: true, format: 1 })

    // A seek into chunk 1 opens exactly that frame through openFrame.
    const bytes = await session.read('req-1', CHUNK_SIZE + 8, 10)
    expect(Array.from(bytes)).toEqual(Array.from(PLAINTEXT.slice(CHUNK_SIZE + 8, CHUNK_SIZE + 18)))
    expect(opened).toContainEqual({ index: 1, isLast: false, format: 1 })

    await session.close()
    await source.close()
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
