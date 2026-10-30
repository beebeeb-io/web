/**
 * Task 1943 — a resume-rule restart never calls the file-wide abandon, and
 * keeps the old resume record until a fresh session exists (Codex P1 + P2 on
 * web#170, round 4).
 *
 * The server's only abandon is `POST /files/{id}/upload/abandon`: it takes no
 * session id and reverts (or, for a never-completed first upload, deletes)
 * whatever upload the file holds NOW (server routes/files.rs `abandon_upload`
 * → upload_abandon.rs `abandon_in_progress_upload`). A stale resume record
 * names an old session; by the time it is opened another tab or device may be
 * uploading the same file under a live lease. Abandoning by file id would kill
 * THAT upload, and the following init would then succeed over it.
 *
 * The init decides instead (server routes/uploads.rs `init_upload`, task
 * 1589): an expired lease is taken over inside the init, a live one answers
 * 409. The fake server below models exactly that, plus the file-wide abandon,
 * and an IndexedDB model keyed by file id (as `upload-resume.ts` is).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type * as Wasm from 'beebeeb-wasm'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import type { UploadState } from '../src/lib/upload-resume'
import { ServerChangedItemIdError } from '../src/lib/item-id-echo'

const wasm = loadWasm()
const MK = new Uint8Array(32).fill(5)
const FILE_ID = '1943abed-0000-4000-8000-000000000001'
const NEW_ID = '1943abed-0000-4000-8000-0000000000ff'

interface ServerUpload {
  session: string
  live: boolean
}

/** The file's in-flight upload on the fake server (null: none). */
let current: ServerUpload | null = null
/** What the next init does instead of the modelled answer, if set. */
let initFault: (() => never) | null = null
/** Answer the fresh init under another file id. */
let remapTo: string | null = null
/** IndexedDB model: the resume store, keyed by file id. */
const idb = new Map<string, UploadState>()

const cap = {
  abandons: [] as string[],
  inits: [] as string[],
  puts: [] as string[],
  /** The resume store as it stood at each PUT. */
  idbAtPut: [] as Array<Record<string, string | null | undefined>>,
  events: [] as string[],
}

function snapshot(): Record<string, string | null | undefined> {
  return Object.fromEntries([...idb.entries()].map(([k, v]) => [k, v.upload_session_id]))
}

function coreBackedEncryptor() {
  let real: Wasm.WasmChunkEncryptor = wasm.WasmChunkEncryptor.withChunkSize(MK, 'restart-abandon', 4n, 4n)
  return {
    applyRecordedPin: async (pin: 0 | 2) => {
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
  startEncryptedStream: async () => coreBackedEncryptor(),
  startEncryptedStreamWithChunkSize: async () => coreBackedEncryptor(),
  encryptFilename: async (_key: Uint8Array, plaintext: string) => ({
    nonce: new Uint8Array([1]),
    ciphertext: new TextEncoder().encode(plaintext),
  }),
  serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
    JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
  readFileMetadata: async () => ({ name: 'report.bin', mime_type: null, pin: 0 }),
})
await mockModuleScoped('../src/lib/net-retry', import.meta.dir, {
  withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  initUpload: async (metadata: { file_id: string }) => {
    cap.inits.push(metadata.file_id)
    cap.events.push('init')
    if (initFault) initFault()
    // routes/uploads.rs init_upload: a live lease answers 409; an expired one
    // is taken over inside the init.
    if (current?.live) {
      throw Object.assign(new Error('upload is already in progress for this file'), { status: 409 })
    }
    current = { session: 'fresh-session', live: true }
    const fileId = remapTo ?? metadata.file_id
    return {
      protocol: 'v2', file_id: fileId, tenant_id: 't', object_version_id: 'ov-fresh',
      upload_session_id: 'fresh-session', chunk_size_bytes: 4, chunk_count: 1,
      storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
    }
  },
  uploadChunk: async (_fileId: string, _index: number, _data: Uint8Array, session?: string | null) => {
    cap.puts.push(String(session))
    cap.idbAtPut.push(snapshot())
    cap.events.push(`put:${session}`)
    return { index: _index, size: 1 }
  },
  completeUpload: async (fileId: string) => {
    current = null
    return {
      id: fileId, name_encrypted: '', mime_type: null, size_bytes: 4, chunk_count: 1,
      is_folder: false, is_uploading: false, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z',
    }
  },
  getUploadStatus: async () => ({ uploaded_chunks: [] }),
  updateFile: async (fileId: string) => ({ id: fileId }),
  // routes/files.rs abandon_upload: file-wide, no session id. Reverts whatever
  // the file holds now, live or not.
  abandonUpload: async (fileId: string) => {
    cap.abandons.push(fileId)
    cap.events.push('abandon')
    current = null
    return { id: fileId, status: 'reverted', deleted: false }
  },
})
await mockModuleScoped('../src/lib/upload-resume', import.meta.dir, {
  computeFingerprint: async () => 'fp',
  findByFingerprint: async () => [...idb.values()].find((s) => s.fingerprint === 'fp') ?? null,
  saveUploadState: async (state: UploadState) => {
    idb.set(state.fileId, { ...state })
  },
  removeUploadState: async (fileId: string) => {
    idb.delete(fileId)
  },
})

const { encryptedUpload } = await import('../src/lib/encrypted-upload')

/** A stale record from before 1943 (no chunk_format): core says restart. */
function staleRecord(): UploadState {
  return {
    fingerprint: 'fp', fileId: FILE_ID, fileName: 'report.bin', fileSize: 4, totalChunks: 1,
    upload_session_id: 'old-session', object_version_id: 'ov-old', chunk_size_bytes: 4, chunk_count: 1,
    region: 'Europe', parentId: null, createdAt: 1,
  }
}

beforeEach(() => {
  for (const k of Object.keys(cap) as Array<keyof typeof cap>) cap[k].length = 0
  idb.clear()
  idb.set(FILE_ID, staleRecord())
  current = null
  initFault = null
  remapTo = null
})

function upload(fileKey = new Uint8Array(32).fill(3)) {
  return encryptedUpload(
    new File([new Uint8Array([1, 2, 3, 4])], 'report.bin'),
    FILE_ID, fileKey, MK, undefined, undefined, FILE_ID, undefined, undefined,
  )
}

describe('a restart never abandons by file id (Codex P1)', () => {
  test('another device is uploading the same file under a live lease: its upload is untouched and ours fails with the init 409', async () => {
    current = { session: 'other-device-session', live: true }
    await expect(upload()).rejects.toMatchObject({ status: 409 })
    expect(cap.events).toContain('policy(none)=restart')
    expect(cap.abandons).toEqual([])
    expect(current).toEqual({ session: 'other-device-session', live: true })
    expect(cap.puts).toEqual([])
  })

  test('the old session’s lease expired: the init takes it over, no client abandon, chunk 0 into the fresh session', async () => {
    current = { session: 'old-session', live: false }
    await upload()
    expect(cap.abandons).toEqual([])
    expect(cap.inits).toEqual([FILE_ID])
    expect(cap.puts).toEqual(['fresh-session'])
  })

  test('nothing in flight on the server: no abandon either, the fresh init proceeds', async () => {
    await upload()
    expect(cap.abandons).toEqual([])
    expect(cap.puts).toEqual(['fresh-session'])
  })
})

describe('the old resume record is kept until a fresh session exists (Codex P2)', () => {
  test('the fresh init fails offline: the paused upload’s record survives unchanged', async () => {
    initFault = () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(upload()).rejects.toThrow('Failed to fetch')
    expect(idb.get(FILE_ID)).toEqual(staleRecord())
  })

  test('the fresh init answers 409 (a live lease): the record survives for a later retry', async () => {
    current = { session: 'other-device-session', live: true }
    await expect(upload()).rejects.toMatchObject({ status: 409 })
    expect(idb.get(FILE_ID)).toEqual(staleRecord())
  })

  test('a successful restart replaces the record with the fresh session’s before the first PUT', async () => {
    await upload()
    expect(cap.idbAtPut).toEqual([{ [FILE_ID]: 'fresh-session' }])
    // completed: the record is gone
    expect(idb.size).toBe(0)
  })

  test('L13: a fresh init answered under another id aborts; the old record survives untouched', async () => {
    remapTo = NEW_ID
    await expect(upload()).rejects.toBeInstanceOf(ServerChangedItemIdError)
    expect(cap.idbAtPut).toEqual([])
    expect(idb.get(FILE_ID)).toEqual(staleRecord())
    expect(cap.puts).toEqual([])
  })
})
