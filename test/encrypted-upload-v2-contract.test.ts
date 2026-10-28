import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'

// Shared mock setup (tasks 0753, 1590): see helpers/upload-share-mocks.ts. The
// capturing ./api + streaming ./crypto overrides live there; each mock is the
// real module plus those overrides and is restored when this file finishes.
// This suite asserts on `cap`.
await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async (parentId: string) => parentId === 'nested-folder' ? 'shared-root' : null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
})

describe('encryptedUpload v2 server file id contract', () => {
  beforeEach(() => { resetCaptures() })

  test('uses the v2 server-generated file id for metadata, chunks, resume state, and cleanup', async () => {
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'fresh.txt', { type: 'text/plain' })

    const uploaded = await encryptedUpload(
      file,                       // file
      'client-generated-file-id', // fileId (client-proposed)
      new Uint8Array([1]),        // fileKey — metadata marker (1)
      new Uint8Array([9]),        // masterKey — streaming chunk-frame marker (9)
      undefined,                  // parentId
      undefined,                  // onProgress
      undefined,                  // resumeFileId
      undefined,                  // sharedFolderContext
      undefined,                  // signal
      async (fileId) => {         // deriveFileKeyForId — runs after the v2 server id
        expect(fileId).toBe('server-file-id')
        return new Uint8Array([9])
      },
    )

    expect(uploaded.id).toBe('server-file-id')
    expect(cap.encryptedMetadataKeys).toEqual([1, 9])
    expect(cap.updatedFiles).toHaveLength(1)
    expect(cap.updatedFiles[0].fileId).toBe('server-file-id')
    expect(cap.uploadedChunks).toEqual([
      { fileId: 'server-file-id', index: 0, firstByte: 9, uploadSessionId: 'upload-session-id' },
    ])
    // Saved once after init, and again (task 1943) to record the chunk format
    // the session holds before its first PUT. Both under the server's file id.
    expect(cap.savedStates).toHaveLength(2)
    for (const state of cap.savedStates) {
      expect(state).toMatchObject({
        fileId: 'server-file-id',
        upload_session_id: 'upload-session-id',
        object_version_id: 'object-version-id',
        chunk_size_bytes: 4,
        chunk_count: 1,
        region: 'Europe',
      })
    }
    expect(cap.savedStates[1]).toMatchObject({ chunk_format: 1 })
    expect(cap.removedStates).toEqual(['server-file-id'])
  })
})

test('B owner upload publishes the actual v2 file key to the shared root without an invite', async () => {
  resetCaptures()
  const { encryptedUpload } = await import('../src/lib/encrypted-upload')
  await encryptedUpload(new File(['data'], 'late.txt'), 'proposed', new Uint8Array([1]),
    new Uint8Array([9]), 'nested-folder', undefined, undefined, undefined, undefined,
    async () => new Uint8Array([9]))
  expect(cap.ownerKeys).toHaveLength(1)
  expect(cap.ownerKeys[0].folderId).toBe('shared-root')
  expect(cap.ownerKeys[0].keys).toEqual([{ file_id: 'server-file-id', encrypted_file_key: 'AAAAAAAAAAAAAAAACQ==' }])
  expect(cap.addFolderKeysCalls).toHaveLength(0)
})
