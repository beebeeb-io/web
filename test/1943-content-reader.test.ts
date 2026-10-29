/**
 * Task 1943 (web part of the 1908 core adoption) — every file-content read in
 * web goes through core's pin-aware reader, with the pin from core's FILE
 * metadata reader, and still reads every v1 file.
 *
 * These drive web's real download code (`src/lib/encrypted-download.ts`: the
 * buffered path, the streaming path, versions, the share-link entry point)
 * against real core crypto (the committed WASM build, through the same ops the
 * crypto worker runs; see test/helpers/wasm-crypto-mirror.ts) and the fixtures
 * core publishes in test-vectors/vectors.json v5:
 *   - `chunk_v2_stream` / `chunk_v2_single_frame`: v2 content (fixed nonces);
 *   - `metadata_v2_name`: the same file's v2 name, which records pin 2;
 *   - `chunk_encrypt_decrypt`: a v1 frame (no AAD, raw file key).
 * The server is a stubbed `fetch` that serves exactly those bytes, so each test
 * can also play the hostile server (truncate, reorder, downgrade, swap names).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  hexToBytes,
  installWasmCryptoMirror,
  loadVectors,
  toHex,
} from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const mirror = await installWasmCryptoMirror()
const { wasm, ops } = mirror

const decryptedSignals: string[] = []
await mockModuleScoped('../src/lib/decrypt-events', import.meta.dir, {
  dispatchDecrypted: (fileId: string) => {
    decryptedSignals.push(fileId)
  },
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getToken: () => null,
  getApiUrl: () => 'http://api.test',
})

const dl = await import('../src/lib/encrypted-download')

const V = loadVectors()
const v2 = V.chunk_v2_stream
const v2single = V.chunk_v2_single_frame
const v2name = V.metadata_v2_name
const v1chunk = V.chunk_encrypt_decrypt

const V2_KEY = hexToBytes(v2.file_key_hex)
const V2_FILE_ID = v2.file_id as string
const V2_NAME = v2name.name_encrypted as string
const V2_WIRE = hexToBytes(v2.wire_hex)
const V2_PLAIN = v2.plaintext_hex as string
const V2_PLAIN_LEN = V2_PLAIN.length / 2

// ── The stub server ──────────────────────────────────────────────────────────

interface Served {
  body: Uint8Array
  chunkCount: number
  chunkSize: number
}
let served: Served | null = null
const fetched: string[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
  served = null
  fetched.length = 0
  decryptedSignals.length = 0
  mirror.decryptStreams.length = 0
  mirror.fileMetadataReads.length = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    fetched.push(url)
    if (!served) return new Response('not found', { status: 404 })
    return new Response(served.body.slice(), {
      status: 200,
      headers: {
        'X-Chunk-Count': String(served.chunkCount),
        'X-Chunk-Size': String(served.chunkSize),
        'Content-Length': String(served.body.length),
      },
    })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

function frames(vector: typeof v2): Uint8Array[] {
  return (vector.frames as Array<{ frame_hex: string }>).map((f) => hexToBytes(f.frame_hex))
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
async function blobHex(b: Blob): Promise<string> {
  return toHex(new Uint8Array(await b.arrayBuffer()))
}

/** A v1 name envelope exactly as web (and every pre-1908 client) seals one: raw file key, no pin. */
function v1NameEnvelope(fileKey: Uint8Array, name: string, mime: string | null): string {
  const blob = wasm.encrypt_metadata(fileKey, JSON.stringify({ name, mime_type: mime })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from(blob.nonce),
    ciphertext: Array.from(blob.ciphertext),
  })
}

// ── v2 content opens, through every entry point ──────────────────────────────

describe('v2 content (core vectors) opens through web download code', () => {
  test('decryptToBlob: the 3-frame v2 fixture decrypts byte-exact, name and MIME from the v2 name, pin 2 from core', async () => {
    served = { body: V2_WIRE, chunkCount: v2.chunk_count, chunkSize: v2.chunk_size }
    const { plaintext, filename } = await dl.decryptToBlob(
      V2_FILE_ID, V2_KEY, V2_NAME, null, v2.chunk_count, V2_PLAIN_LEN,
    )
    expect(await blobHex(plaintext)).toBe(V2_PLAIN)
    expect(filename).toBe(v2name.expected_name)
    expect(plaintext.type).toBe(v2name.expected_mime_type)
    // The pin and the file id reached the reader; the pin came from the
    // authenticated name, not from any server field.
    expect(mirror.fileMetadataReads).toEqual([V2_NAME])
    expect(mirror.decryptStreams).toEqual([{ fileId: V2_FILE_ID, pin: 2 }])
    expect(decryptedSignals).toEqual([V2_FILE_ID])
    expect(ops.liveDecryptorCount()).toBe(0)
  })

  test('decryptToBlob: the single-frame v2 fixture decrypts', async () => {
    served = { body: hexToBytes(v2single.wire_hex), chunkCount: 1, chunkSize: v2single.chunk_size }
    const { plaintext } = await dl.decryptToBlob(
      V2_FILE_ID, V2_KEY, V2_NAME, null, 1, v2single.plaintext_hex.length / 2,
    )
    expect(await blobHex(plaintext)).toBe(v2single.plaintext_hex)
  })

  test('decryptVersionToBlob: a version is read with the FILE’s pin (versions share the file metadata)', async () => {
    served = { body: V2_WIRE, chunkCount: v2.chunk_count, chunkSize: v2.chunk_size }
    const plaintext = await dl.decryptVersionToBlob(
      V2_FILE_ID, 'version-1', V2_KEY, V2_NAME, null, v2.chunk_count, V2_PLAIN_LEN,
    )
    expect(await blobHex(plaintext)).toBe(V2_PLAIN)
    expect(fetched[0]).toBe(`http://api.test/api/v1/files/${V2_FILE_ID}/versions/version-1/download`)
    expect(mirror.decryptStreams).toEqual([{ fileId: V2_FILE_ID, pin: 2 }])
  })

  test('decryptEncryptedBytes (the share-link entry point) decrypts the v2 fixture with {fileId, pin}', async () => {
    const out = await dl.decryptEncryptedBytes(
      V2_KEY, { fileId: V2_FILE_ID, pin: 2 }, V2_WIRE, v2.chunk_count, V2_PLAIN_LEN, v2.chunk_size,
    )
    expect(toHex(out)).toBe(V2_PLAIN)
  })

  test('pipeDecryptedChunks (the streaming path) decrypts the v2 fixture from odd-sized network reads', async () => {
    const pieces = [V2_WIRE.slice(0, 5), V2_WIRE.slice(5, 70), V2_WIRE.slice(70, 71), V2_WIRE.slice(71)]
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of pieces) c.enqueue(p)
        c.close()
      },
    })
    const out: Uint8Array[] = []
    const progress: number[] = []
    await dl.pipeDecryptedChunks(
      body, V2_KEY, { fileId: V2_FILE_ID, pin: 2 }, v2.chunk_count, V2_PLAIN_LEN, v2.chunk_size,
      undefined, async (chunk) => { out.push(chunk) }, (n) => progress.push(n),
    )
    expect(toHex(concat(out))).toBe(V2_PLAIN)
    expect(progress).toEqual([32, 64, V2_PLAIN_LEN])
    expect(ops.liveDecryptorCount()).toBe(0)
  })
})

// ── v1 files keep opening ────────────────────────────────────────────────────

describe('v1 files (every file that exists today) keep opening', () => {
  test('the core v1 vectors (a v1 frame and a v1 legacy name, same file key) open as a file, pin 0', async () => {
    // chunk_encrypt_decrypt + metadata_encrypt_decrypt share one file key: a
    // pre-1908 file exactly as stored (raw-key name envelope, no-AAD frame).
    const v1name = V.metadata_encrypt_decrypt
    expect(v1name.file_key_hex).toBe(v1chunk.file_key_hex)
    const key = hexToBytes(v1chunk.file_key_hex)
    const fileId = '00000000-0000-4000-8000-0000000001a1'
    const name = JSON.stringify({
      cipher_suite: 'V1Aes256Gcm',
      nonce: Array.from(hexToBytes(v1name.nonce_hex)),
      ciphertext: Array.from(hexToBytes(v1name.ciphertext_hex)),
    })
    const wire = hexToBytes(v1chunk.nonce_hex + v1chunk.ciphertext_hex)
    const plainLen = v1chunk.plaintext_hex.length / 2
    served = { body: wire, chunkCount: 1, chunkSize: 4 * 1024 * 1024 }
    const { plaintext, filename } = await dl.decryptToBlob(fileId, key, name, null, 1, plainLen)
    expect(await blobHex(plaintext)).toBe(v1chunk.plaintext_hex)
    expect(filename).toBe(v1name.metadata)
    expect(mirror.decryptStreams).toEqual([{ fileId, pin: 0 }])
  })

  test('a multi-chunk v1 file written by the current web upload path (core encryptor, default format) opens, buffered and streamed', async () => {
    const masterKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
    const fileId = '1943aaaa-0000-4000-8000-00000000c0de'
    const fileKey = wasm.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
    const chunkSize = 64
    const plain = new Uint8Array(150).map((_, i) => (i * 31 + 11) & 0xff)
    // Exactly what encrypted-upload.ts does for a NEW file: no pin applied.
    const enc = wasm.WasmChunkEncryptor.withChunkSize(masterKey, fileId, BigInt(plain.length), BigInt(chunkSize))
    expect(enc.format).toBe(1)
    const wireParts: Uint8Array[] = []
    for (let off = 0; off < plain.length; off += chunkSize) {
      wireParts.push(enc.pushChunk(plain.slice(off, off + chunkSize)) as Uint8Array)
    }
    enc.finish()
    const wire = concat(wireParts)
    const name = v1NameEnvelope(fileKey, 'notes.bin', null)

    served = { body: wire, chunkCount: wireParts.length, chunkSize }
    const { plaintext } = await dl.decryptToBlob(fileId, fileKey, name, null, wireParts.length, plain.length)
    expect(await blobHex(plaintext)).toBe(toHex(plain))

    const streamed: Uint8Array[] = []
    await dl.pipeDecryptedChunks(
      new ReadableStream<Uint8Array>({ start(c) { c.enqueue(wire.slice()); c.close() } }),
      fileKey, { fileId, pin: 0 }, wireParts.length, plain.length, chunkSize,
      undefined, async (chunk) => { streamed.push(chunk) }, undefined,
    )
    expect(toHex(concat(streamed))).toBe(toHex(plain))
    expect(ops.liveDecryptorCount()).toBe(0)
  })
})

// ── A hostile server cannot make web accept altered content ─────────────────

describe('a server that alters v2 content is refused, and nothing is signalled or leaked', () => {
  async function expectRefused(body: Uint8Array, chunkCount: number, sizeBytes: number) {
    served = { body, chunkCount, chunkSize: v2.chunk_size }
    await expect(
      dl.decryptToBlob(V2_FILE_ID, V2_KEY, V2_NAME, null, chunkCount, sizeBytes),
    ).rejects.toThrow()
    expect(decryptedSignals).toEqual([])
    expect(ops.liveDecryptorCount()).toBe(0)
  }

  test('truncation: the server drops the last frame and, consistently, says 2 chunks of 64 bytes', async () => {
    // Every frame that IS served opens and the framing adds up; only the v2
    // last-chunk flag can tell that the file was cut short.
    const [f0, f1] = frames(v2)
    await expectRefused(concat([f0, f1]), 2, 64)
  })

  test('reorder: frames 0 and 1 swapped', async () => {
    const [f0, f1, f2] = frames(v2)
    await expectRefused(concat([f1, f0, f2]), 3, V2_PLAIN_LEN)
  })

  test('downgrade: a v1 frame (raw key, no AAD) served for a file whose metadata pins v2', async () => {
    const v1Frame = wasm.encrypt_chunk(V2_KEY, hexToBytes(V2_PLAIN)) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const body = concat([v1Frame.nonce, v1Frame.ciphertext])
    served = { body, chunkCount: 1, chunkSize: 4 * 1024 * 1024 }
    await expect(
      dl.decryptToBlob(V2_FILE_ID, V2_KEY, V2_NAME, null, 1, V2_PLAIN_LEN),
    ).rejects.toThrow()
    expect(decryptedSignals).toEqual([])
    expect(ops.liveDecryptorCount()).toBe(0)
  })

  test('another file’s id: the v2 frames bind their file id', async () => {
    served = { body: V2_WIRE, chunkCount: 3, chunkSize: v2.chunk_size }
    await expect(
      dl.decryptToBlob('1908f00d-0000-4000-8000-00000000beef', V2_KEY, V2_NAME, null, 3, V2_PLAIN_LEN),
    ).rejects.toThrow()
    expect(ops.liveDecryptorCount()).toBe(0)
  })

  test('a plaintext name for a file is refused BEFORE any content is fetched (no pin, no read)', async () => {
    served = { body: V2_WIRE, chunkCount: 3, chunkSize: v2.chunk_size }
    await expect(
      dl.decryptToBlob(V2_FILE_ID, V2_KEY, 'vector-v2.pdf', null, 3, V2_PLAIN_LEN),
    ).rejects.toBeInstanceOf(dl.UnverifiedFileMetadataError)
    expect(fetched).toEqual([])
    expect(mirror.decryptStreams).toEqual([])
  })

  test('a name that does not open under this file’s key is refused before any content is fetched', async () => {
    served = { body: V2_WIRE, chunkCount: 3, chunkSize: v2.chunk_size }
    const otherKey = new Uint8Array(32).fill(9)
    await expect(
      dl.decryptToBlob(V2_FILE_ID, V2_KEY, v1NameEnvelope(otherKey, 'x', null), null, 3, V2_PLAIN_LEN),
    ).rejects.toBeInstanceOf(dl.UnverifiedFileMetadataError)
    expect(fetched).toEqual([])
  })

  test('streaming path: a truncated v2 stream rejects after the last frame it has, and frees the decryptor', async () => {
    const [f0, f1] = frames(v2)
    const out: Uint8Array[] = []
    await expect(
      dl.pipeDecryptedChunks(
        new ReadableStream<Uint8Array>({ start(c) { c.enqueue(concat([f0, f1])); c.close() } }),
        V2_KEY, { fileId: V2_FILE_ID, pin: 2 }, 2, 64, v2.chunk_size,
        undefined, async (chunk) => { out.push(chunk) }, undefined,
      ),
    ).rejects.toThrow()
    expect(ops.liveDecryptorCount()).toBe(0)
  })
})
