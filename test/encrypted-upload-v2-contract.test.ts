import { beforeEach, describe, expect, test } from 'bun:test'
import { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } from '../src/lib/item-id-echo'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures, resetEchoes } from './helpers/upload-share-mocks'

// Shared mock setup (tasks 0753, 1590): see helpers/upload-share-mocks.ts. The
// capturing ./api + streaming ./crypto overrides live there; each mock is the
// real module plus those overrides and is restored when this file finishes.
// This suite asserts on `cap`.
await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async (parentId: string) => parentId === 'nested-folder' ? 'shared-root' : null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  // The root has a custody record, so the published wrap is L7 (L7b).
  folderWrapFormat: async () => 'l7',
})

describe('encryptedUpload v2: the client id is the id, or the write aborts (L13)', () => {
  beforeEach(() => {
    resetCaptures()
    resetEchoes()
  })

  test('an init echo of the client id writes metadata, chunks, resume state and cleanup under it', async () => {
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'fresh.txt', { type: 'text/plain' })
    const id = 'client-generated-file-id'

    const uploaded = await encryptedUpload(
      file, // file
      id,   // fileId — the id this client chose
      new Uint8Array([1]), // fileKey — metadata marker (1)
      new Uint8Array([9]), // masterKey — streaming chunk-frame marker (9)
      undefined, // parentId
      undefined, // onProgress
      undefined, // resumeFileId
      undefined, // sharedFolderContext
      undefined, // signal
    )

    expect(uploaded.id).toBe(id)
    expect(cap.encryptedMetadataKeys).toEqual([1])
    expect(cap.updatedFiles).toEqual([])
    expect(cap.uploadedChunks).toEqual([
      { fileId: id, index: 0, firstByte: 9, uploadSessionId: 'upload-session-id' },
    ])
    // Saved once after init, and again (task 1943) to record the chunk format
    // the session holds before its first PUT. Both under the client's file id.
    expect(cap.savedStates).toHaveLength(2)
    for (const state of cap.savedStates) {
      expect(state).toMatchObject({
        fileId: id,
        upload_session_id: 'upload-session-id',
        object_version_id: 'object-version-id',
        chunk_size_bytes: 4,
        chunk_count: 1,
        region: 'Europe',
      })
    }
    expect(cap.savedStates[1]).toMatchObject({ chunk_format: 1 })
    expect(cap.removedStates).toEqual([id])
  })

  test('A7: an init answering a different id aborts before anything is sealed or written', async () => {
    echo.init = () => 'proposed'
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    const err = await encryptedUpload(
      new File([new Uint8Array([1, 2, 3, 4])], 'create.txt', { type: 'text/plain' }),
      'own-id', new Uint8Array([1]), new Uint8Array([9]),
    ).then(() => null, (e: unknown) => e)

    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as ServerChangedItemIdError).code).toBe('server_changed_item_id')
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
    // No chunk PUT, no session recorded, no rename, no cleanup, no publish.
    // (The name blob is sealed before init, with the CLIENT's key.)
    expect(cap.uploadedChunks).toEqual([])
    expect(cap.savedStates).toEqual([])
    expect(cap.removedStates).toEqual([])
    expect(cap.ownerKeys).toEqual([])
    expect(cap.addFolderKeysCalls).toEqual([])
  })

  test('A7: a completion answering a different id aborts after the PUT, with no cleanup or publish', async () => {
    echo.complete = () => 'proposed'
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    await expect(
      encryptedUpload(new File(['data'], 'done.txt'), 'own-id', new Uint8Array([1]), new Uint8Array([9]),
        'nested-folder', undefined, undefined, { folderKey: new Uint8Array(32).fill(7), sharedFolderId: 'nested-folder', inviteId: 'inv-1', format: 'l7' } as never),
    ).rejects.toBeInstanceOf(ServerChangedItemIdError)

    // The chunks went under the client's id; nothing was published under the
    // echoed one and the resume record was not dropped as though it committed.
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual(['own-id'])
    expect(cap.removedStates).toEqual([])
    expect(cap.ownerKeys).toEqual([])
    expect(cap.addFolderKeysCalls).toEqual([])
  })
})

test('B owner upload publishes the actual v2 file key to the shared root without an invite', async () => {
  resetCaptures()
  const { encryptedUpload } = await import('../src/lib/encrypted-upload')
  await encryptedUpload(new File(['data'], 'late.txt'), 'proposed', new Uint8Array([1]),
    new Uint8Array([9]), 'nested-folder')
  expect(cap.ownerKeys).toHaveLength(1)
  expect(cap.ownerKeys[0].folderId).toBe('shared-root')
  // L7: bound to (shared root, the client's file id, file), sealing the real file key.
  expect(cap.ownerKeys[0].keys).toEqual([{ file_id: 'proposed', encrypted_file_key: btoa('l7|shared-root|proposed|1|1') }])
  expect(cap.addFolderKeysCalls).toHaveLength(0)
})

describe('L7b: a member upload seals its file key in the shared folder\'s format', () => {
  const upload = async (format: unknown) => {
    resetCaptures()
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    return encryptedUpload(new File(['data'], 'member.txt'), 'proposed', new Uint8Array([1]),
      new Uint8Array([9]), 'shared-root', undefined, undefined,
      { folderKey: new Uint8Array(32).fill(7), sharedFolderId: 'shared-root', inviteId: 'invite-1', format } as never,
      undefined)
  }

  test('a custody folder (also after a flag rollback, since the custody read still answers): L7 for (root, file, file)', async () => {
    await upload('l7')
    expect(cap.addFolderKeysCalls).toHaveLength(1)
    expect(cap.addFolderKeysCalls[0].keys).toEqual([{ file_id: 'proposed', encrypted_file_key: btoa('l7|shared-root|proposed|1|1') }])
    // Contract 2237 §1: an L7 member write says so.
    expect(cap.addFolderKeysCalls[0].format).toBe('l7')
    expect(cap.ownerKeys).toHaveLength(0)
  })

  test('a flag-off invite-only folder: the legacy invite seal', async () => {
    await upload('legacy_invite')
    // The stub seal is a zero nonce followed by the plaintext key.
    expect(cap.addFolderKeysCalls[0].keys).toEqual([{ file_id: 'proposed', encrypted_file_key: 'AAAAAAAAAAAAAAAAAQ==' }])
    // Contract 2237 §1: a legacy write sends no format.
    expect(cap.addFolderKeysCalls[0].format).toBeUndefined()
  })

  test('no format is a failed upload, never a legacy write', async () => {
    await expect(upload(undefined)).rejects.toThrow(/unknown folder wrap format/)
    expect(cap.addFolderKeysCalls).toHaveLength(0)
  })
})
