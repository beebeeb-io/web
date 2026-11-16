/**
 * SF-0001 L13 round 2 — E6/E7: creating a folder never sends a plaintext name.
 *
 * Both sites (drive's "New folder" and the move modal's) go through one helper.
 * With the vault locked — or crypto not ready — it refuses in the client with
 * honest copy and sends NOTHING. The old code fell back to `nameEncrypted =
 * name` and put the plaintext name on the wire.
 *
 * E7: the move modal reports a create failure with the same honest copy the
 * other create paths show, instead of only console.error.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures, resetEchoes } from './helpers/upload-share-mocks'

await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { createSealedFolder, FOLDER_VAULT_LOCKED_COPY, VaultLockedFolderCreateError } = await import(
  '../src/lib/folder-create'
)
const { userFriendlyError } = await import('../src/lib/user-friendly-error')
const { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } = await import('../src/lib/item-id-echo')

const MK = new Uint8Array([9])
const FOLDER_KEY = async () => new Uint8Array([5])

beforeEach(() => {
  resetCaptures()
  resetEchoes()
})

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (e: unknown) => e)
}

describe('E6: a locked vault refuses the folder create and sends nothing', () => {
  test('drive.tsx New folder: locked → no request', async () => {
    const err = await caught(() =>
      createSealedFolder({ name: 'Plans', isUnlocked: false, folderKey: FOLDER_KEY, masterKey: MK }),
    )
    expect(err).toBeInstanceOf(VaultLockedFolderCreateError)
    expect((err as Error).message).toBe(FOLDER_VAULT_LOCKED_COPY)
    expect(cap.createdFolders).toEqual([])
  })

  test('move-modal.tsx New folder: locked → no request', async () => {
    const err = await caught(() =>
      createSealedFolder({ name: 'Plans', parentId: 'dest-1', isUnlocked: false, folderKey: FOLDER_KEY }),
    )
    expect(err).toBeInstanceOf(VaultLockedFolderCreateError)
    expect(cap.createdFolders).toEqual([])
  })

  test('drive.tsx New folder: crypto not ready → no request', async () => {
    const err = await caught(() =>
      createSealedFolder({ name: 'Plans', isUnlocked: true, cryptoReady: false, folderKey: FOLDER_KEY, masterKey: MK }),
    )
    expect(err).toBeInstanceOf(VaultLockedFolderCreateError)
    expect(cap.createdFolders).toEqual([])
  })

  test('unlocked: the name is sealed under the client-chosen id, never sent plain', async () => {
    const created = await createSealedFolder({
      name: 'Plans',
      parentId: 'parent-1',
      isUnlocked: true,
      cryptoReady: true,
      folderKey: FOLDER_KEY,
      masterKey: MK,
    })
    expect(created.id).toBe(cap.createdFolders[0].folderId!)
    expect(cap.createdFolders[0].nameEncrypted).not.toBe('Plans')
    expect(cap.createdFolders[0].nameEncrypted).toContain('ciphertext')
  })
})

describe('E7: the move modal surfaces the changed-id abort like the other paths', () => {
  test('userFriendlyError keeps the plain changed-id sentence', () => {
    expect(userFriendlyError(new ServerChangedItemIdError())).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
  })

  test('a create answered with another id reaches the caller as the typed error', async () => {
    echo.createFolder = () => 'server-chosen-folder-id'
    const err = await caught(() =>
      createSealedFolder({
        name: 'Plans', parentId: 'dest-1', isUnlocked: true, cryptoReady: true, folderKey: FOLDER_KEY,
      }),
    )
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect(userFriendlyError(err)).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
  })
})
