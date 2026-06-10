import { beforeEach, describe, expect, test } from 'bun:test'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'

// Shared mock setup (task 0753): see helpers/upload-share-mocks.ts. The capturing
// ./api + streaming ./crypto mocks live there (shared with folder-share-crypto so
// bun's global mock.module doesn't collide). This suite asserts on `cap`.
installMocks()

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
    expect(cap.savedStates).toHaveLength(1)
    expect(cap.savedStates[0]).toMatchObject({
      fileId: 'server-file-id',
      upload_session_id: 'upload-session-id',
      object_version_id: 'object-version-id',
      chunk_size_bytes: 4,
      chunk_count: 1,
      region: 'Europe',
    })
    expect(cap.removedStates).toEqual(['server-file-id'])
  })
})
