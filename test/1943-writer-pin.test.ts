/**
 * Task 1943 — the new-file pin rule and the replace pin (core 1908 checklist
 * item 4, lead ruling 2026-10-17).
 *
 * - A NEW file id never applies a recorded pin: the plain encryptor writes
 *   core's WRITE_FORMAT (v1 in the read-only phase). Passing 2 for a new file
 *   would create a v2 file before the gated switch, which clients not yet on
 *   this core cannot read. Core cannot tell new from replace; this test is the
 *   web client's proof (core asks every client to ship one).
 * - A REPLACE (a new version of an existing file id) reads the pin from that
 *   file's authenticated metadata with core's FILE reader and applies it to the
 *   encryptor before the first chunk. The server keeps the file's
 *   `name_encrypted` on replace, so a v2-pinned file replaced with the default
 *   writer would complete and never open. If the pin cannot be read, nothing is
 *   uploaded.
 *
 * Drives web's real `encryptedUpload` (src/lib/encrypted-upload.ts) with a
 * capturing encryptor and a stub server; the metadata reader is the real core
 * reader (WASM). The second block runs the worker's registry helper over real
 * core encryptors.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { hexToBytes, inProcessPort, loadVectors, loadWasm, toHex } from './helpers/wasm-crypto-mirror'
import { applyRecordedPinInRegistry, createContentOps } from '../src/lib/content-crypto'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const V = loadVectors()

const V2_KEY = hexToBytes(V.metadata_v2_name.file_key_hex)
const V2_FILE_ID = V.metadata_v2_name.file_id as string
const V2_NAME = V.metadata_v2_name.name_encrypted as string

const cap = {
  events: [] as string[],
  initCalls: [] as Array<{ file_id: string }>,
  metadataReads: [] as string[],
}
let serverFileId: ((requested: string) => string) = (requested) => requested

function capturingEncryptor() {
  let format = 1
  return {
    applyRecordedPin: async (pin: number) => {
      cap.events.push(`pin:${pin}`)
      format = pin === 2 ? 2 : 1
      return format
    },
    format: async () => format,
    resumePolicy: async () => 'restart' as const,
    pushChunk: async () => {
      cap.events.push('push')
      return new Uint8Array([7])
    },
    finish: async () => {
      cap.events.push('finish')
      return { chunk_count: 1, total_plaintext: 4, total_ciphertext: 32, chunk_size_bytes: 4 }
    },
    dispose: async () => {
      cap.events.push('dispose')
    },
  }
}

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  CHUNK_SIZE: 4,
  planChunks: async () => ({ chunk_size_bytes: 4, chunk_count: 1 }),
  startEncryptedStream: async () => capturingEncryptor(),
  startEncryptedStreamWithChunkSize: async () => capturingEncryptor(),
  encryptFilename: async (_key: Uint8Array, plaintext: string) => ({
    nonce: new Uint8Array([1]),
    ciphertext: new TextEncoder().encode(plaintext),
  }),
  serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
    JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
  readFileMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
    cap.metadataReads.push(nameEncrypted)
    return ops.readFileMetadata(fileKey, nameEncrypted)
  },
})
await mockModuleScoped('../src/lib/net-retry', import.meta.dir, {
  withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  initUpload: async (metadata: { file_id: string }) => {
    cap.initCalls.push(metadata)
    return {
      protocol: 'v2', file_id: serverFileId(metadata.file_id), tenant_id: 't',
      object_version_id: 'ov', upload_session_id: 'us', chunk_size_bytes: 4, chunk_count: 1,
      storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
    }
  },
  uploadChunk: async (_fileId: string, index: number) => {
    cap.events.push(`put:${index}`)
    return { index, size: 1 }
  },
  completeUpload: async (fileId: string) => ({
    id: fileId, name_encrypted: '', mime_type: null, size_bytes: 4, chunk_count: 1,
    is_folder: false, is_uploading: false, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z',
  }),
  getUploadStatus: async () => ({ uploaded_chunks: [] }),
  updateFile: async (fileId: string) => ({ id: fileId }),
})
await mockModuleScoped('../src/lib/upload-resume', import.meta.dir, {
  computeFingerprint: async () => 'fp',
  findByFingerprint: async () => null,
  saveUploadState: async () => {},
  removeUploadState: async () => {},
})

const { encryptedUpload } = await import('../src/lib/encrypted-upload')

beforeEach(() => {
  cap.events.length = 0
  cap.initCalls.length = 0
  cap.metadataReads.length = 0
  serverFileId = (requested) => requested
})

function textFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'report.txt', { type: 'text/plain' })
}

function v1Name(fileKey: Uint8Array, name: string): string {
  const b = wasm.encrypt_metadata(fileKey, JSON.stringify({ name, mime_type: null })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: Array.from(b.nonce), ciphertext: Array.from(b.ciphertext) })
}

async function upload(fileId: string, fileKey: Uint8Array, options?: { replaceOf?: { nameEncrypted: string } }) {
  return encryptedUpload(
    textFile(), fileId, fileKey, new Uint8Array(32).fill(1), undefined, undefined, undefined, undefined,
    undefined, async () => fileKey, options,
  )
}

describe('new-file pin rule: a brand-new file id never applies a pin', () => {
  test('a new upload builds the plain encryptor: no pin call, no metadata read', async () => {
    await upload('1943cafe-0000-4000-8000-000000000001', V2_KEY)
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
    expect(cap.metadataReads).toEqual([])
    expect(cap.events).toEqual(['push', 'put:0', 'finish'])
  })

  test('even when the id is a v2 file’s id, without replaceOf it is treated as new (the caller decides)', async () => {
    await upload(V2_FILE_ID, V2_KEY)
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
  })
})

describe('replace: the pin is read from the existing file’s authenticated metadata', () => {
  test('a v2-pinned file: pin 2 is applied before the first chunk', async () => {
    await upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })
    expect(cap.metadataReads).toEqual([V2_NAME])
    expect(cap.events).toEqual(['pin:2', 'push', 'put:0', 'finish'])
  })

  test('a file with no recorded pin (every file today): pin 0, which keeps core’s write format', async () => {
    const key = new Uint8Array(32).fill(4)
    await upload('1943cafe-0000-4000-8000-000000000002', key, { replaceOf: { nameEncrypted: v1Name(key, 'a.txt') } })
    expect(cap.events).toEqual(['pin:0', 'push', 'put:0', 'finish'])
  })

  test('unreadable metadata (a plaintext name): refused before anything reaches the server', async () => {
    await expect(
      upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: 'vector-v2.pdf' } }),
    ).rejects.toThrow()
    expect(cap.initCalls).toEqual([])
    expect(cap.events).toEqual([])
  })

  test('metadata sealed under another key: refused before anything reaches the server', async () => {
    await expect(
      upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: v1Name(new Uint8Array(32).fill(8), 'x') } }),
    ).rejects.toThrow()
    expect(cap.initCalls).toEqual([])
  })

  test('if the server answers with ANOTHER file id, that is a new file: no pin is applied', async () => {
    serverFileId = () => '1943cafe-0000-4000-8000-0000000000ff'
    await upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
  })
})

describe('the worker’s pin helper over real core encryptors', () => {
  const mk = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff)
  const fileId = '1943d00d-0000-4000-8000-000000000003'

  function freshRegistry(size = 10) {
    const registry = new Map<number, InstanceType<typeof wasm.WasmChunkEncryptor>>()
    registry.set(1, wasm.WasmChunkEncryptor.withChunkSize(mk, fileId, BigInt(size), 4n))
    return registry
  }

  test('pin 2 makes the encryptor write v2, and web’s reader opens those frames under pin 2', async () => {
    const registry = freshRegistry()
    expect(registry.get(1)!.format).toBe(1)
    expect(applyRecordedPinInRegistry(registry, 1, 2)).toBe(2)
    const enc = registry.get(1)!
    const plain = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    const frames = [enc.pushChunk(plain.slice(0, 4)), enc.pushChunk(plain.slice(4, 8)), enc.pushChunk(plain.slice(8))] as Uint8Array[]
    enc.finish()

    const fileKey = wasm.derive_file_key(mk, new TextEncoder().encode(fileId)) as Uint8Array
    const { StreamingDecryptor } = await import('../src/lib/crypto')
    const dec = new StreamingDecryptor(ops.createDecryptor(fileKey, fileId, 2), inProcessPort(ops))
    const out: number[] = []
    for (const f of frames) out.push(...(await dec.pushFrame(f)))
    expect((await dec.finish()).format).toBe(2)
    expect(toHex(new Uint8Array(out))).toBe(toHex(plain))
  })

  test('pin 0 keeps the write format (v1 in the read-only phase)', () => {
    const registry = freshRegistry()
    expect(applyRecordedPinInRegistry(registry, 1, 0)).toBe(1)
  })

  test('an unknown pin code is refused and leaves the encryptor in place', () => {
    const registry = freshRegistry()
    expect(() => applyRecordedPinInRegistry(registry, 1, 1 as 0)).toThrow()
    expect(registry.get(1)!.format).toBe(1)
  })

  test('applying a pin after the first chunk fails in core, and the consumed encryptor leaves the registry', () => {
    const registry = freshRegistry()
    registry.get(1)!.pushChunk(new Uint8Array([1, 2, 3, 4]))
    expect(() => applyRecordedPinInRegistry(registry, 1, 2)).toThrow()
    expect(registry.has(1)).toBe(false)
  })
})
