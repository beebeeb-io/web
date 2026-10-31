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
import { beforeEach } from 'bun:test'
import { mockModuleScoped } from './scoped-module-mock'
// L13: the real request primitives (api.ts createFolder / initUpload /
// completeUpload) check every answer against the id they proposed, proven on
// the wire in l13-api-echo-wire.test.ts. These mocks answer like the server
// and check like the primitive, so a suite sees what callers really get.
import { assertEchoedItemId } from '../../src/lib/item-id-echo'

// ── Shared state ─────────────────────────────────────────────────────────────
// Upload-contract captures (the contract suite asserts on these).
export const cap = {
  ownerKeys: [] as { folderId: string; keys: unknown[] }[],
  initCalls: [] as unknown[],
  uploadedChunks: [] as Array<{ fileId: string; index: number; firstByte: number; uploadSessionId: string | null | undefined }>,
  updatedFiles: [] as Array<{ fileId: string; nameEncrypted: string }>,
  savedStates: [] as Array<{ fileId: string; upload_session_id?: string | null }>,
  removedStates: [] as string[],
  encryptedMetadataKeys: [] as number[],
  addFolderKeysCalls: [] as Array<{ inviteId: string; keys: unknown[]; folderKeyId: string; format?: string }>,
  createdFolders: [] as Array<{ nameEncrypted: string; parentId?: string; folderId?: string }>,
  movedItems: [] as Array<{ id: string; parentId: string | null }>,
  abandons: [] as string[],
  /** Every id a file/folder key was derived for (`deriveFileKey`). */
  derivedKeyIds: [] as string[],
  /** Every recorded pin an encryptor was told to apply (a replace / version). */
  appliedPins: [] as number[],
  /** Every stored name a replace read its pin from (`readFileMetadata`). */
  metadataReads: [] as string[],
  /** Every row the code looked up (`getFile`). */
  rowLookups: [] as string[],
}
/**
 * L13 (contract 2275, SF-0001): by default the mocked server ECHOES the id the
 * client proposed — the only answer an uploader may write under. A test that
 * needs a substituted id sets one of these.
 */
export const echo = {
  /** 'v2' (default) or 'v1' — the protocol the mocked init answers on. */
  protocol: 'v2' as 'v1' | 'v2',
  init: null as ((requested: string) => string) | null,
  complete: null as ((requested: string) => string) | null,
  createFolder: null as ((requested: string | undefined) => string) | null,
  /** When set, every chunk PUT waits on it (a test's admission hold). */
  chunkGate: null as Promise<void> | null,
  /** The stored upload session `findByFingerprint` returns (IndexedDB), or none. */
  stored: null as (Record<string, unknown> & { fileId: string }) | null,
  /** Rows `getFile` answers (merged over a live file row); any other id is a 404. */
  rows: {} as Record<string, Record<string, unknown>>,
}
export function resetEchoes(): void {
  echo.protocol = 'v2'
  echo.init = null
  echo.complete = null
  echo.createFolder = null
  echo.chunkGate = null
  echo.stored = null
  echo.rows = {}
  setListPage(EMPTY_PAGE)
}

export function resetCaptures(): void {
  cap.ownerKeys.length = 0
  cap.initCalls.length = 0
  cap.uploadedChunks.length = 0
  cap.updatedFiles.length = 0
  cap.savedStates.length = 0
  cap.removedStates.length = 0
  cap.encryptedMetadataKeys.length = 0
  cap.addFolderKeysCalls.length = 0
  cap.createdFolders.length = 0
  cap.movedItems.length = 0
  cap.abandons.length = 0
  cap.derivedKeyIds.length = 0
  cap.appliedPins.length = 0
  cap.metadataReads.length = 0
  cap.rowLookups.length = 0
}

// Listing pager (the folder-share suite drives this).
type Child = { id: string; is_folder: boolean; name_encrypted?: string; is_trashed?: boolean; created_at?: string }
const EMPTY_PAGE = () => ({ files: [] as Child[], next_cursor: null })
/** Reset to an empty listing before every test (resetEchoes), like the echo. */
let pageImpl: (opts: { parentId?: string; cursor?: string }) => { files: Child[]; next_cursor: string | null } =
  EMPTY_PAGE
export function setListPage(fn: typeof pageImpl): void { pageImpl = fn }

const stubStream = (masterKey: Uint8Array) => ({
  // Task 1943: the upload asks the encryptor's format (recorded with the
  // session) and, on a resume, core's resume policy. A new v1 upload here.
  format: async () => 1,
  // A replace applies the listed row's pin (0 here, core's write format: v1).
  applyRecordedPin: async (pin: number) => {
    cap.appliedPins.push(pin)
    return 1
  },
  resumePolicy: async () => 'continue' as const,
  pushChunk: async () => new Uint8Array([masterKey[0]]),
  finish: async () => ({ chunk_count: 1, total_plaintext_bytes: 4, total_ciphertext_bytes: 1 }),
  dispose: async () => {},
})

export async function installMocks(): Promise<void> {
  const here = import.meta.dir

  // `cap` and `echo` live in THIS module, which bun caches once for the whole
  // process: every file that installs these mocks shares them. A substituted
  // echo one file left set (`echo.complete`, set by the v2-contract suite) made
  // the NEXT file's honest upload abort, so `bun run test:order` went red in
  // reverse order only (CI run 41034649908, 2133-folder-key-id). Every file
  // therefore starts from a clean state, and every test from the honest echo
  // (also under `--randomize`, which shuffles the tests inside a file).
  // Registered before the first await, so the hook belongs to the calling file.
  resetCaptures()
  resetEchoes()
  beforeEach(() => {
    resetEchoes()
  })

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
    // Task 2133: the folder key id and the child-key wrap, stubbed (the WASM
    // worker is not loadable under bun test). The id is the key's bytes.
    folderKeyId: async (folderKey: Uint8Array) => Uint8Array.from(folderKey),
    // Task 2237b L7: the child wrap, stubbed to spell out its binding so a
    // contract test can assert exactly which (root, item, kind) it was sealed to.
    wrapFolderChild: async (_folderKey: Uint8Array, rootId: string, itemId: string, kind: number, childKey: Uint8Array) =>
      new TextEncoder().encode(`l7|${rootId}|${itemId}|${kind}|${childKey[0]}`),
    encryptChunk: async (_k: Uint8Array, plaintext: Uint8Array) => ({
      nonce: new Uint8Array(12), ciphertext: Uint8Array.from(plaintext),
    }),
    serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
      JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
    // A fresh array per call (callers zeroize what they derive); 0xd0 marks a
    // key derived inside the code under test rather than passed in by a test.
    deriveFileKey: async (_masterKey: Uint8Array, id: string) => {
      cap.derivedKeyIds.push(id)
      return Uint8Array.of(0xd0)
    },
    // A replace (`replaceOf`) reads the listed row's pin first; every row here
    // records pin 0 (core's write format).
    // A name authenticates only under the key whose first byte its nonce
    // carries (the stub encryptFilename/serializeEncryptedBlob above).
    readNameMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
      const blob = JSON.parse(nameEncrypted) as { nonce: number[]; ciphertext: number[] }
      if (blob.nonce[0] !== fileKey[0]) throw new Error('metadata authentication failed')
      const text = new TextDecoder().decode(Uint8Array.from(blob.ciphertext))
      let name = text
      try { name = (JSON.parse(text) as { name: string }).name } catch { /* a bare name */ }
      return { name, mimeType: null, pin: 0 }
    },
    // A name containing "unreadable" does not authenticate under the key.
    readFileMetadata: async (_fileKey: Uint8Array, nameEncrypted: string) => {
      cap.metadataReads.push(nameEncrypted)
      if (nameEncrypted.includes('unreadable')) throw new Error('metadata authentication failed')
      return { name: 'listed.txt', mime_type: null, pin: 0 }
    },
  })

  // shared_folders_v1 ON: the owner-upload publish under test is a flag-on path.
  await mockModuleScoped('../../src/lib/use-feature-flag', here, {
    sharedFoldersEnabled: async () => true,
    sharedFoldersEnabledForWrite: async () => true,
  })

  // net-retry passthrough — no retry back-off inside the contract tests.
  await mockModuleScoped('../../src/lib/net-retry', here, {
    withNetworkRetry: <T>(fn: () => Promise<T>) => fn(),
  })

  // ./api — the capturing upload surface (contract) + listFilesPage driven by
  // the shared pager (folder-share). ApiError, API_URL, FILE_LIST_HARD_CAP and
  // everything else are the real exports.
  await mockModuleScoped('../../src/lib/api', here, (real) => ({
    getFile: async (id: string) => {
      cap.rowLookups.push(id)
      const row = echo.rows[id]
      if (!row) {
        const NotFound = real.ApiError as unknown as new (message: string, status: number) => Error
        throw new NotFound('Not found.', 404)
      }
      return {
        id, name_encrypted: 'row-name', mime_type: null, size_bytes: 4, chunk_count: 1, is_folder: false,
        is_trashed: false, parent_id: null, created_at: '2026-05-08T00:00:00.000Z', updated_at: '2026-05-08T00:00:00.000Z',
        ...row,
      }
    },
    listFilesPage: async (opts: { parentId?: string; cursor?: string }) => pageImpl(opts),
    initUpload: async (metadata: unknown) => {
      cap.initCalls.push(metadata)
      const requested = (metadata as { file_id: string }).file_id
      const answered = echo.init ? echo.init(requested) : requested
      assertEchoedItemId(requested, answered)
      if (echo.protocol === 'v1') return { protocol: 'v1', file_id: answered, chunk_count: 1 }
      return {
        protocol: 'v2', file_id: answered, tenant_id: 'tenant-id',
        object_version_id: 'object-version-id', upload_session_id: 'upload-session-id',
        chunk_size_bytes: 4, chunk_count: 1, storage_format_version: 2,
        storage_pool_id: 'pool-id', region: 'Europe',
      }
    },
    uploadChunk: async (fileId: string, index: number, data: Uint8Array, uploadSessionId?: string | null) => {
      if (echo.chunkGate) await echo.chunkGate
      cap.uploadedChunks.push({ fileId, index, firstByte: data[0], uploadSessionId })
      return { index, size: data.byteLength }
    },
    completeUpload: async (fileId: string) => {
      const answered = echo.complete ? echo.complete(fileId) : fileId
      assertEchoedItemId(fileId, answered, 'complete')
      return {
        id: answered, name_encrypted: cap.updatedFiles.at(-1)?.nameEncrypted ?? '',
        mime_type: null, size_bytes: 4, chunk_count: 1, is_folder: false, is_uploading: false,
        created_at: '2026-05-08T00:00:00.000Z', updated_at: '2026-05-08T00:00:00.000Z',
      }
    },
    addFolderKeys: async (inviteId: string, keys: unknown[], folderKeyId: string, format?: string) => {
      cap.addFolderKeysCalls.push({ inviteId, keys, folderKeyId, format })
    },
    publishSharedFolderKeys: async (folderId: string, keys: unknown[]) => {
      cap.ownerKeys.push({ folderId, keys })
      return { written: keys.length, skipped: 0 }
    },
    abandonUpload: async (fileId: string) => {
      cap.abandons.push(fileId)
      return { outcome: 'reverted_to_previous_version' as const }
    },
    createFolder: async (nameEncrypted: string, parentId: string | undefined, folderId: string) => {
      cap.createdFolders.push({ nameEncrypted, parentId, folderId })
      const answered = echo.createFolder ? echo.createFolder(folderId) : folderId
      assertEchoedItemId(folderId, answered)
      return {
        id: answered,
        name_encrypted: nameEncrypted, mime_type: null, size_bytes: 0, chunk_count: 0,
        is_folder: true, is_uploading: false,
        created_at: '2026-05-08T00:00:00.000Z', updated_at: '2026-05-08T00:00:00.000Z',
      }
    },
    getUploadStatus: async () => ({ uploaded_chunks: [] }),
    updateFile: async (fileId: string, updates: { name_encrypted?: string; parent_id?: string | null }) => {
      // A destination write (a move) is captured separately: L13 asserts an
      // abort puts nothing INTO an answered folder.
      if (updates.parent_id !== undefined) cap.movedItems.push({ id: fileId, parentId: updates.parent_id })
      else cap.updatedFiles.push({ fileId, nameEncrypted: updates.name_encrypted ?? '' })
      return { id: fileId }
    },
  }))

  await mockModuleScoped('../../src/lib/upload-resume', here, {
    computeFingerprint: async () => 'fingerprint',
    findByFingerprint: async () => echo.stored,
    saveUploadState: async (state: { fileId: string; upload_session_id?: string | null }) => {
      cap.savedStates.push(state)
    },
    removeUploadState: async (fileId: string) => { cap.removedStates.push(fileId) },
  })
}
