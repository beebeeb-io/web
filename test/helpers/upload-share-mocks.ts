/**
 * Shared mock setup for the two suites that mock `./api` + `./crypto`
 * (encrypted-upload-v2-contract + folder-share-crypto).
 *
 * Task 1590: every mock goes through mockModuleScoped(), so each one is the
 * REAL module with only the names below overridden (complete — no "Export
 * named 'X' not found" in a later file) and is restored when the calling file
 * finishes (scoped — the stubs never leak into files that did not ask for
 * them). The earlier "one identical superset registered once" design (task
 * 0753) left these stubs live for the rest of the process and was only green
 * by the luck of the file order.
 *
 * Call `await installMocks()` at the top level of the test file.
 */
import { mockModuleScoped } from './scoped-module-mock'

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

export async function installMocks(): Promise<void> {
  const here = import.meta.dir

  // ./crypto — the streaming primitive + a capturing encryptFilename for the
  // upload contract. Every other export is the real one.
  await mockModuleScoped('../../src/lib/crypto', here, {
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
  })

  // net-retry passthrough — no retry back-off inside the contract tests.
  await mockModuleScoped('../../src/lib/net-retry', here, {
    withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
  })

  // ./api — the capturing upload surface (contract) + listFilesPage driven by
  // the shared pager (folder-share). ApiError, API_URL, FILE_LIST_HARD_CAP and
  // everything else are the real exports.
  await mockModuleScoped('../../src/lib/api', here, {
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
  })

  await mockModuleScoped('../../src/lib/upload-resume', here, {
    computeFingerprint: async () => 'fingerprint',
    findByFingerprint: async () => null,
    saveUploadState: async (state: { fileId: string; upload_session_id?: string | null }) => {
      cap.savedStates.push(state)
    },
    removeUploadState: async (fileId: string) => { cap.removedStates.push(fileId) },
  })
}
