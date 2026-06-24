/**
 * Shared bun mock.module setup for the two suites that mock `./api` + `./crypto`
 * (encrypted-upload-v2-contract + folder-share-crypto). bun's mock.module is
 * GLOBAL + module-cached: two files mocking the same module with DIFFERENT shapes
 * collide (last-registered wins, can't relink). The fix is to register ONE
 * identical superset mock from both files (via installMocks()), with shared
 * capture/control state — so whichever registration wins, both suites work.
 */
import { mock } from 'bun:test'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

// ── Shared state ─────────────────────────────────────────────────────────────
// Upload-contract captures (the contract suite asserts on these).
export const cap = {
  initCalls: [] as unknown[],
  uploadedChunks: [] as Array<{ fileId: string; index: number; firstByte: number; uploadSessionId: string | null | undefined }>,
  updatedFiles: [] as Array<{ fileId: string; nameEncrypted: string }>,
  savedStates: [] as Array<{ fileId: string; upload_session_id?: string | null }>,
  removedStates: [] as string[],
  encryptedMetadataKeys: [] as number[],
}
export function resetCaptures(): void {
  cap.initCalls.length = 0
  cap.uploadedChunks.length = 0
  cap.updatedFiles.length = 0
  cap.savedStates.length = 0
  cap.removedStates.length = 0
  cap.encryptedMetadataKeys.length = 0
}

// Listing pager (the folder-share suite drives this).
type Child = { id: string; is_folder: boolean }
let pageImpl: (opts: { parentId?: string; cursor?: string }) => { files: Child[]; next_cursor: string | null } =
  () => ({ files: [], next_cursor: null })
export function setListPage(fn: typeof pageImpl): void { pageImpl = fn }

const stubStream = (masterKey: Uint8Array) => ({
  pushChunk: async () => new Uint8Array([masterKey[0]]),
  finish: async () => ({ chunk_count: 1, total_plaintext_bytes: 4, total_ciphertext_bytes: 1 }),
  dispose: async () => {},
})

let installed = false
export function installMocks(): void {
  if (installed) return
  installed = true

  // ./crypto — superset: the streaming primitive + capturing encryptFilename the
  // upload contract needs, PLUS every name folder-share-crypto.ts imports (stubs;
  // its tested path — collectAllChildren — never calls them).
  mock.module('../../src/lib/crypto', () => ({
    CHUNK_SIZE: 4,
    planChunks: async () => ({ chunk_size_bytes: 4, chunk_count: 1 }),
    startEncryptedStream: async (masterKey: Uint8Array) => stubStream(masterKey),
    startEncryptedStreamWithChunkSize: async (masterKey: Uint8Array) => stubStream(masterKey),
    encryptFilename: async (fileKey: Uint8Array, plaintext: string) => {
      cap.encryptedMetadataKeys.push(fileKey[0])
      return { nonce: new Uint8Array([fileKey[0]]), ciphertext: new TextEncoder().encode(plaintext) }
    },
    serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
      JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
    // folder-share-crypto.ts imports (unused in collectAllChildren):
    encryptChunk: async () => new Uint8Array(),
    decryptChunk: async () => new Uint8Array(),
    deriveFileKey: async () => new Uint8Array(32),
    deriveX25519Private: async () => new Uint8Array(32),
    x25519SharedSecret: async () => new Uint8Array(32),
    deriveShareKey: async () => new Uint8Array(32),
    fromBase64: () => new Uint8Array(),
    toBase64: (bytes?: Uint8Array) => (bytes ? Buffer.from(bytes).toString('base64') : ''),
    zeroize: () => {},
    // bun's mock.module is process-global; this stub must export EVERY name any
    // co-running test imports from ./crypto. sessionIdToBytes is a pure parser
    // (transfer-crypto.test.ts imports it), so mirror its real behaviour here
    // rather than a no-op stub — keeps the superset faithful.
    sessionIdToBytes: (sessionId: string): Uint8Array => {
      const hex = sessionId.replace(/-/g, '')
      const out = new Uint8Array(16)
      for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      return out
    },
  }))

  // net-retry passthrough — avoids loading net-retry.ts (its `import { ApiError }
  // from './api'` re-export can't be linked against the ./api mock).
  mock.module('../../src/lib/net-retry', () => ({
    withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
  }))

  // ./api — superset: the capturing upload surface (contract) + listFilesPage /
  // FILE_LIST_HARD_CAP (folder-share). listFilesPage delegates to the shared pager.
  mock.module('../../src/lib/api', () => ({
    ApiError,
    FILE_LIST_HARD_CAP: 50_000,
    listFilesPage: async (opts: { parentId?: string; cursor?: string }) => pageImpl(opts),
    initUpload: async (metadata: unknown) => {
      cap.initCalls.push(metadata)
      return {
        protocol: 'v2', file_id: 'server-file-id', tenant_id: 'tenant-id',
        object_version_id: 'object-version-id', upload_session_id: 'upload-session-id',
        chunk_size_bytes: 4, chunk_count: 1, storage_format_version: 2,
        storage_pool_id: 'pool-id', region: 'Europe',
      }
    },
    uploadChunk: async (fileId: string, index: number, data: Uint8Array, uploadSessionId?: string | null) => {
      cap.uploadedChunks.push({ fileId, index, firstByte: data[0], uploadSessionId })
      return { index, size: data.byteLength }
    },
    completeUpload: async () => ({
      id: 'server-file-id', name_encrypted: cap.updatedFiles.at(-1)?.nameEncrypted ?? '',
      mime_type: null, size_bytes: 4, chunk_count: 1, is_folder: false, is_uploading: false,
      created_at: '2026-05-08T00:00:00.000Z', updated_at: '2026-05-08T00:00:00.000Z',
    }),
    getUploadStatus: async () => ({ uploaded_chunks: [] }),
    updateFile: async (fileId: string, updates: { name_encrypted?: string }) => {
      cap.updatedFiles.push({ fileId, nameEncrypted: updates.name_encrypted ?? '' })
      return { id: fileId }
    },
  }))

  mock.module('../../src/lib/upload-resume', () => ({
    computeFingerprint: async () => 'fingerprint',
    findByFingerprint: async () => null,
    saveUploadState: async (state: { fileId: string; upload_session_id?: string | null }) => {
      cap.savedStates.push(state)
    },
    removeUploadState: async (fileId: string) => { cap.removedStates.push(fileId) },
  }))
}
