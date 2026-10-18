/**
 * Task 1943 — resuming an interrupted upload obeys core's resume rule (core
 * 1908 checklist item 7; Codex P1 on web#170).
 *
 * A v2 upload binds every frame to ONE version id (its frame 0 nonce). A
 * resumed upload builds a NEW encryptor with a NEW version id, and the server
 * keeps the frames the session already holds, so continuing an old session
 * with a v2 writer stores two version ids side by side: a file that completes
 * and never opens. Core decides (`resume_policy(stored, writing)`): continue
 * ONLY a v1 session resumed by a v1 writer, and only when the resume record
 * says the session holds v1 frames; everything else, including a record that
 * does not say (written before this change), restarts: abandon the old
 * session, init a fresh one for the same file id, upload from chunk 0, and
 * never PUT into the old session again.
 *
 * Web's side, driven through the real `encryptedUpload`:
 *   - the resume record carries the format of the frames the session holds
 *     (`chunk_format`, recorded before the first PUT) and the pin a replace
 *     applied (`replace_pin`), so a resumed replace writes the same format;
 *   - the decision is core's: the stub encryptor here wraps a REAL core
 *     `WasmChunkEncryptor` for `format`, `withRecordedPin` and `resumePolicy`.
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

const MK = new Uint8Array(32).fill(5)

const cap = {
  events: [] as string[],
  puts: [] as Array<{ index: number; session: string | null | undefined }>,
  inits: [] as string[],
  abandons: [] as string[],
  saved: [] as UploadState[],
  removed: [] as string[],
}
let stored: UploadState | null = null
let initAnswer: (fileId: string) => object = (fileId) => v2Init(fileId, 'fresh-session')

function v2Init(fileId: string, session: string) {
  return {
    protocol: 'v2', file_id: fileId, tenant_id: 't', object_version_id: `ov-${session}`,
    upload_session_id: session, chunk_size_bytes: 4, chunk_count: 1,
    storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
  }
}

/** The worker-side encryptor's surface, with core deciding format and resume policy. */
function coreBackedEncryptor() {
  let real: Wasm.WasmChunkEncryptor = wasm.WasmChunkEncryptor.withChunkSize(MK, 'resume-rule', 4n, 4n)
  return {
    applyRecordedPin: async (pin: 0 | 2) => {
      cap.events.push(`pin:${pin}`)
      real = real.withRecordedPin(pin)
      return real.format
    },
    format: async () => real.format,
    resumePolicy: async (storedFormat: number | undefined) => {
      const answer = real.resumePolicy(storedFormat ?? null) as 'continue' | 'restart'
      cap.events.push(`policy(${storedFormat ?? 'none'})=${answer}`)
      return answer
    },
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
  startEncryptedStream: async () => coreBackedEncryptor(),
  startEncryptedStreamWithChunkSize: async () => coreBackedEncryptor(),
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
    cap.events.push('init')
    return initAnswer(metadata.file_id)
  },
  uploadChunk: async (_fileId: string, index: number, _data: Uint8Array, session?: string | null) => {
    cap.puts.push({ index, session })
    cap.events.push(`put:${session}`)
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
    cap.events.push('abandon')
    return { outcome: 'reverted_to_previous_version' }
  },
})
await mockModuleScoped('../src/lib/upload-resume', import.meta.dir, {
  computeFingerprint: async () => 'fp',
  findByFingerprint: async () => stored,
  saveUploadState: async (state: UploadState) => {
    cap.saved.push({ ...state })
  },
  removeUploadState: async (fileId: string) => {
    cap.removed.push(fileId)
  },
})

const { encryptedUpload } = await import('../src/lib/encrypted-upload')

beforeEach(() => {
  for (const k of Object.keys(cap) as Array<keyof typeof cap>) cap[k].length = 0
  stored = null
  initAnswer = (fileId) => v2Init(fileId, 'fresh-session')
})

function file(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'report.bin')
}

function record(over: Partial<UploadState>): UploadState {
  return {
    fingerprint: 'fp', fileId: V2_FILE_ID, fileName: 'report.bin', fileSize: 4, totalChunks: 1,
    upload_session_id: 'old-session', object_version_id: 'ov-old', chunk_size_bytes: 4, chunk_count: 1,
    region: 'Europe', parentId: null, createdAt: 1, ...over,
  }
}

async function upload(fileId: string, fileKey: Uint8Array, options?: { replaceOf?: { nameEncrypted: string } }, resumeFileId?: string) {
  return encryptedUpload(
    file(), fileId, fileKey, MK, undefined, undefined, resumeFileId, undefined, undefined, async () => fileKey, options,
  )
}

describe('the resume record says which frames the session holds', () => {
  test('a new upload records chunk_format 1 (the encryptor’s format) before its first PUT', async () => {
    await upload('1943feed-0000-4000-8000-000000000001', new Uint8Array(32).fill(1))
    const withFormat = cap.saved.filter((s) => s.chunk_format !== undefined)
    expect(withFormat.at(-1)?.chunk_format).toBe(1)
    expect(withFormat.at(-1)?.replace_pin).toBeUndefined()
    // recorded before the first chunk went out
    const firstPut = cap.events.indexOf('put:fresh-session')
    expect(firstPut).toBeGreaterThan(-1)
    expect(cap.saved.findIndex((s) => s.chunk_format === 1)).toBeGreaterThan(-1)
  })

  test('a replace of a v2-pinned file records chunk_format 2 and the pin it applied', async () => {
    await upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })
    const last = cap.saved.filter((s) => s.chunk_format !== undefined).at(-1)
    expect(last?.chunk_format).toBe(2)
    expect(last?.replace_pin).toBe(2)
  })
})

describe('resuming obeys core’s resume rule', () => {
  test('a v1 session (recorded chunk_format 1) resumed by a v1 writer continues the SAME session', async () => {
    stored = record({ fileId: '1943feed-0000-4000-8000-000000000002', chunk_format: 1 })
    await upload('1943feed-0000-4000-8000-000000000002', new Uint8Array(32).fill(2))
    expect(cap.events).toContain('policy(1)=continue')
    expect(cap.abandons).toEqual([])
    expect(cap.inits).toEqual([])
    expect(cap.puts.map((p) => p.session)).toEqual(['old-session'])
  })

  test('a record from before this change (no chunk_format) RESTARTS: abandon, fresh init, chunk 0, never the old session', async () => {
    const id = '1943feed-0000-4000-8000-000000000003'
    stored = record({ fileId: id, chunk_format: undefined })
    await upload(id, new Uint8Array(32).fill(3))
    expect(cap.events).toContain('policy(none)=restart')
    expect(cap.abandons).toEqual([id])
    expect(cap.inits).toEqual([id])
    expect(cap.puts.map((p) => p.session)).toEqual(['fresh-session'])
    expect(cap.removed).toContain(id)
  })

  test('a v2 session (a pinned replace) resumes as a restart, and the restarted writer applies the recorded pin', async () => {
    stored = record({ chunk_format: 2, replace_pin: 2 })
    await upload(V2_FILE_ID, V2_KEY, undefined, V2_FILE_ID)
    expect(cap.events.filter((e) => e.startsWith('policy'))).toEqual(['policy(2)=restart'])
    expect(cap.abandons).toEqual([V2_FILE_ID])
    expect(cap.puts.map((p) => p.session)).toEqual(['fresh-session'])
    // both encryptors (the refused one and the restarted one) wrote with pin 2
    expect(cap.events.filter((e) => e === 'pin:2')).toHaveLength(2)
    const last = cap.saved.filter((s) => s.chunk_format !== undefined).at(-1)
    expect(last?.chunk_format).toBe(2)
  })

  test('a recorded v1 session resumed by a v2 writer (pinned replace) restarts', async () => {
    stored = record({ chunk_format: 1 })
    await upload(V2_FILE_ID, V2_KEY, { replaceOf: { nameEncrypted: V2_NAME } })
    expect(cap.events).toContain('policy(1)=restart')
    expect(cap.puts.map((p) => p.session)).toEqual(['fresh-session'])
  })

  test('if the fresh init is refused (the old lease is still live), the upload fails and never PUTs to the old session', async () => {
    stored = record({ fileId: '1943feed-0000-4000-8000-000000000004', chunk_format: undefined })
    initAnswer = () => {
      throw Object.assign(new Error('upload is already in progress for this file'), { status: 409 })
    }
    await expect(upload('1943feed-0000-4000-8000-000000000004', new Uint8Array(32).fill(4))).rejects.toThrow()
    expect(cap.puts).toEqual([])
  })
})
