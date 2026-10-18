/**
 * Task 1943 — a replace pin belongs to ONE file id (Codex P2 on web#170,
 * "Clear the replace pin for server-generated IDs").
 *
 * A replace reads the pin from the replaced file's authenticated name. When
 * the server answers the init with ANOTHER file id, the upload is a brand-new
 * file (fresh name, no pin, core's write rule): the replaced file's pin must
 * not follow it. Before this fix the resume record still carried the old pin
 * under the NEW id, so an interrupted upload resumed with that pin applied to
 * the new file: with pin 2 it restarted the v1 session and wrote v2 content
 * under an unpinned name, which a later replace would downgrade.
 *
 * Every place the record is written after an init (the first init, the swept-
 * session re-init, the resume-rule restart) and the one place a recorded pin
 * is read back (resume) is held here, through the real `encryptedUpload` with
 * an encryptor whose format and resume policy are core's.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type * as Wasm from 'beebeeb-wasm'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { hexToBytes, loadVectors, loadWasm } from './helpers/wasm-crypto-mirror'
import { createContentOps } from '../src/lib/content-crypto'
import type { UploadState } from '../src/lib/upload-resume'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const V = loadVectors()
const V2_KEY = hexToBytes(V.metadata_v2_name.file_key_hex)
const V2_FILE_ID = V.metadata_v2_name.file_id as string
const V2_NAME = V.metadata_v2_name.name_encrypted as string
/** The id the server hands back instead of the replaced file's id. */
const NEW_ID = '1943feed-0000-4000-8000-00000000aaaa'
const NEW_KEY = new Uint8Array(32).fill(9)

const MK = new Uint8Array(32).fill(5)

const cap = {
  events: [] as string[],
  puts: [] as Array<{ fileId: string; session: string | null | undefined }>,
  inits: [] as string[],
  abandons: [] as string[],
  saved: [] as UploadState[],
}
let stored: UploadState | null = null
/** Answers each init in turn; the last answer repeats. */
let initAnswers: Array<(requested: string) => object> = []
/** Throws from the next N chunk PUTs (an interrupted upload or a swept session). */
let putFailures: Array<() => never> = []

function v2Init(fileId: string, session: string) {
  return {
    protocol: 'v2', file_id: fileId, tenant_id: 't', object_version_id: `ov-${session}`,
    upload_session_id: session, chunk_size_bytes: 4, chunk_count: 1,
    storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
  }
}

function coreBackedEncryptor(fileId: string) {
  let real: Wasm.WasmChunkEncryptor = wasm.WasmChunkEncryptor.withChunkSize(MK, 'remap-pin', 4n, 4n)
  cap.events.push(`enc:${fileId}`)
  return {
    applyRecordedPin: async (pin: 0 | 2) => {
      cap.events.push(`pin:${pin}@${fileId}`)
      real = real.withRecordedPin(pin)
      return real.format
    },
    format: async () => real.format,
    resumePolicy: async (storedFormat: number | undefined) => {
      const answer = real.resumePolicy(storedFormat ?? null) as 'continue' | 'restart'
      cap.events.push(`policy(${storedFormat ?? 'none'})=${answer}`)
      return answer
    },
    pushChunk: async () => new Uint8Array([7]),
    finish: async () => ({ chunk_count: 1, total_plaintext: 4, total_ciphertext: 32, chunk_size_bytes: 4 }),
    dispose: async () => {},
  }
}

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  CHUNK_SIZE: 4,
  planChunks: async () => ({ chunk_size_bytes: 4, chunk_count: 1 }),
  startEncryptedStream: async (_mk: Uint8Array, fileId: string) => coreBackedEncryptor(fileId),
  startEncryptedStreamWithChunkSize: async (_mk: Uint8Array, fileId: string) => coreBackedEncryptor(fileId),
  encryptFilename: async (_key: Uint8Array, plaintext: string) => ({
    nonce: new Uint8Array([1]),
    ciphertext: new TextEncoder().encode(plaintext),
  }),
  serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
    JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
  readFileMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => ops.readFileMetadata(fileKey, nameEncrypted),
})
await mockModuleScoped('../src/lib/net-retry', import.meta.dir, {
  withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  initUpload: async (metadata: { file_id: string }) => {
    cap.inits.push(metadata.file_id)
    const answer = initAnswers.length > 1 ? initAnswers.shift()! : initAnswers[0]
    const init = answer(metadata.file_id) as { file_id: string; upload_session_id: string }
    cap.events.push(`init:${metadata.file_id}->${init.file_id}`)
    return init
  },
  uploadChunk: async (fileId: string, index: number, _data: Uint8Array, session?: string | null) => {
    const fail = putFailures.shift()
    if (fail) fail()
    cap.puts.push({ fileId, session })
    cap.events.push(`put:${fileId}:${session}`)
    return { index, size: 1 }
  },
  completeUpload: async (fileId: string) => ({
    id: fileId, name_encrypted: '', mime_type: null, size_bytes: 4, chunk_count: 1,
    is_folder: false, is_uploading: false, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z',
  }),
  getUploadStatus: async () => ({ uploaded_chunks: [] }),
  updateFile: async (fileId: string) => ({ id: fileId }),
  abandonUpload: async (fileId: string) => {
    cap.abandons.push(fileId)
    cap.events.push(`abandon:${fileId}`)
    return { outcome: 'reverted_to_previous_version' }
  },
})
await mockModuleScoped('../src/lib/upload-resume', import.meta.dir, {
  computeFingerprint: async () => 'fp',
  findByFingerprint: async () => stored,
  saveUploadState: async (state: UploadState) => {
    cap.saved.push({ ...state })
  },
  removeUploadState: async () => {},
})

const { encryptedUpload } = await import('../src/lib/encrypted-upload')

beforeEach(() => {
  for (const k of Object.keys(cap) as Array<keyof typeof cap>) cap[k].length = 0
  stored = null
  initAnswers = [(id) => v2Init(id, 'fresh-session')]
  putFailures = []
})

const interrupted = (): never => {
  throw Object.assign(new TypeError('Failed to fetch'), { status: 0 })
}
const swept = (): never => {
  throw Object.assign(new Error('upload session not found'), { status: 404 })
}

function file(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'report.bin')
}

async function upload(
  fileId: string,
  fileKey: Uint8Array,
  options?: { replaceOf?: { nameEncrypted: string } },
  resumeFileId?: string,
) {
  return encryptedUpload(
    file(), fileId, fileKey, MK, undefined, undefined, resumeFileId, undefined, undefined, async () => fileKey, options,
  )
}

/** Every record saved under `id`. */
const savedFor = (id: string) => cap.saved.filter((s) => s.fileId === id)

describe('a replace answered with another file id is a new file: its pin stays with the replaced file', () => {
  test('remap + interrupt + resume: the new file records no pin, resumes its v1 session, and the old pin is never applied', async () => {
    // 1. Replace of a v2-pinned file; the server answers with NEW_ID; the
    //    first chunk PUT is interrupted.
    initAnswers = [(_requested) => v2Init(NEW_ID, 'new-session')]
    putFailures = [interrupted]
    await expect(upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })).rejects.toThrow('Failed to fetch')

    const records = savedFor(NEW_ID)
    expect(records.length).toBeGreaterThan(0)

    // 2. The resume banner resumes the NEW file from its record. (Asserted
    //    before the record itself, so the old code's red shows what the
    //    resume DID with the carried pin.)
    stored = records.at(-1)!
    cap.events.length = 0
    cap.puts.length = 0
    cap.inits.length = 0
    await upload(NEW_ID, NEW_KEY, undefined, NEW_ID)

    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
    expect(cap.events).toContain('policy(1)=continue')
    expect(cap.abandons).toEqual([])
    expect(cap.inits).toEqual([])
    expect(cap.puts).toEqual([{ fileId: NEW_ID, session: 'new-session' }])

    // The interrupted upload's record never carried the replaced file's pin.
    expect(records.map((r) => r.replace_pin)).toEqual(records.map(() => undefined))
    expect(records.at(-1)?.chunk_format).toBe(1)
    expect(savedFor(V2_FILE_ID)).toEqual([])
    expect(savedFor(NEW_ID).every((r) => r.replace_pin === undefined)).toBe(true)
  })

  test('a swept session re-inited under another id records no pin and writes without it', async () => {
    // The replace starts on its own id (pin applied), the session is swept,
    // and the re-init answers with NEW_ID.
    initAnswers = [
      (requested) => v2Init(requested, 'first-session'),
      (_requested) => v2Init(NEW_ID, 'reinit-session'),
    ]
    putFailures = [swept]
    await upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })

    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([`pin:2@${V2_FILE_ID}`])
    expect(cap.inits).toEqual([V2_FILE_ID, V2_FILE_ID])
    expect(cap.puts).toEqual([{ fileId: NEW_ID, session: 'reinit-session' }])
    const records = savedFor(NEW_ID)
    expect(records.length).toBeGreaterThan(0)
    expect(records.map((r) => r.replace_pin)).toEqual(records.map(() => undefined))
    expect(records.at(-1)?.chunk_format).toBe(1)
  })

  test('a resume-rule restart re-inited under another id records no pin and writes without it', async () => {
    // A resumed replace of the v2 file whose record says nothing about its
    // frames: core says restart, and the fresh init answers with NEW_ID.
    stored = {
      fingerprint: 'fp', fileId: V2_FILE_ID, fileName: 'report.bin', fileSize: 4, totalChunks: 1,
      upload_session_id: 'old-session', object_version_id: 'ov-old', chunk_size_bytes: 4, chunk_count: 1,
      region: 'Europe', parentId: null, createdAt: 1,
      replace_pin: 2, replace_pin_file_id: V2_FILE_ID,
    } as UploadState
    initAnswers = [(_requested) => v2Init(NEW_ID, 'restart-session')]
    await upload(V2_FILE_ID, V2_KEY, undefined, V2_FILE_ID)

    expect(cap.events).toContain('policy(none)=restart')
    expect(cap.abandons).toEqual([V2_FILE_ID])
    // the pin went to the replaced file's (refused) encryptor only
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([`pin:2@${V2_FILE_ID}`])
    expect(cap.puts).toEqual([{ fileId: NEW_ID, session: 'restart-session' }])
    const records = savedFor(NEW_ID)
    expect(records.length).toBeGreaterThan(0)
    expect(records.map((r) => r.replace_pin)).toEqual(records.map(() => undefined))
    expect(records.at(-1)?.chunk_format).toBe(1)
  })
})

describe('resume never applies a pin recorded for a different file id', () => {
  const recordFor = (over: Partial<UploadState>): UploadState => ({
    fingerprint: 'fp', fileId: NEW_ID, fileName: 'report.bin', fileSize: 4, totalChunks: 1,
    upload_session_id: 'new-session', object_version_id: 'ov-new', chunk_size_bytes: 4, chunk_count: 1,
    region: 'Europe', parentId: null, createdAt: 1, chunk_format: 1, ...over,
  })

  test('a record whose pin names another file (written before this fix) is resumed without the pin', async () => {
    stored = recordFor({ replace_pin: 2, replace_pin_file_id: V2_FILE_ID } as Partial<UploadState>)
    await upload(NEW_ID, NEW_KEY, undefined, NEW_ID)
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
    expect(cap.events).toContain('policy(1)=continue')
    expect(cap.puts).toEqual([{ fileId: NEW_ID, session: 'new-session' }])
  })

  test('a record with a pin but no owning file id (unknown origin) is resumed without the pin', async () => {
    stored = recordFor({ replace_pin: 2 })
    await upload(NEW_ID, NEW_KEY, undefined, NEW_ID)
    expect(cap.events.filter((e) => e.startsWith('pin:'))).toEqual([])
    expect(cap.events).toContain('policy(1)=continue')
  })

  test('a record whose pin names its own file still resumes with that pin (a resumed replace)', async () => {
    stored = recordFor({ fileId: V2_FILE_ID, chunk_format: 2, replace_pin: 2, replace_pin_file_id: V2_FILE_ID } as Partial<UploadState>)
    await upload(V2_FILE_ID, V2_KEY, undefined, V2_FILE_ID)
    expect(cap.events.filter((e) => e.startsWith('pin:')).every((e) => e === `pin:2@${V2_FILE_ID}`)).toBe(true)
    expect(cap.events.filter((e) => e.startsWith('pin:')).length).toBeGreaterThan(0)
  })
})
