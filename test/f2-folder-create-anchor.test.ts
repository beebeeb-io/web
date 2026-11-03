/**
 * Review F2 — a folder created inside a shared folder publishes its name-key
 * wrap only from an anchored call site, exactly like an upload (L15 (b)3).
 *
 * createOwnerFolder used to publish unconditionally, so an import into a
 * folder the server's parent walk places under R sealed the new folder's name
 * under R with no proof this client ever saw R. It now goes through the same
 * publish-or-defer path as an owner upload: only this tab's own click trail
 * may publish; anything else is deferred.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L15 (b): the root is the proof's root, never a separate parent walk;
 *            (b)3: R itself in this tab's in-tab click trail.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const NEW_FOLDER = '44444444-4444-4444-8444-444444444444'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const NAME_KEY = new Uint8Array(32).fill(0x33)
const SEALED_NAME = 'sealed-folder-name'

const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => true,
  sharedFoldersEnabledForWrite: async () => true,
}))
await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
}))
await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  createFolder: async (nameEncrypted: string, parentId: string | undefined, folderId: string) => ({
    id: folderId,
    parent_id: parentId ?? null,
    name_encrypted: nameEncrypted,
    is_folder: true,
  }),
  getFile: async (id: string) => ({ id, parent_id: null, is_folder: true, name_encrypted: SEALED_NAME, uploaded_by: 'owner' }),
  getSharedFolder: async (folderId: string) => {
    if (folderId !== ROOT) throw Object.assign(new Error('not found'), { status: 404 })
    return {
      folder_id: ROOT,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: (await import('../src/lib/crypto')).toBase64(
        wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array,
      ),
      wrapped_folder_key: null,
    }
  },
  getSentInvites: async () => [],
  listFilesPage: async () => ({ files: [], next_cursor: null }),
  publishSharedFolderKeys: async (root: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    published.push({ root, keys })
    return { written: keys.length, skipped: 0 }
  },
}))

const { createOwnerFolder } = await import('../src/lib/owner-upload-key')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')
const { noteFolderClick, resetAnchorsForTests } = await import('../src/lib/publish-anchor')

beforeEach(() => {
  published.length = 0
  clearSharedFolderLookups()
  resetAnchorsForTests()
})

describe('F2: a created folder publishes its name-key wrap only from an anchored site', () => {
  test('an import into a server-walked R publishes no folder name key', async () => {
    await createOwnerFolder({
      nameEncrypted: SEALED_NAME,
      parentId: ROOT,
      folderId: NEW_FOLDER,
      nameKey: NAME_KEY,
      masterKey: MASTER,
    })
    expect(published).toEqual([])
  })

  test('the same create after the tab clicked into R publishes the folder wrap', async () => {
    noteFolderClick(ROOT)
    await createOwnerFolder({
      nameEncrypted: SEALED_NAME,
      parentId: ROOT,
      folderId: NEW_FOLDER,
      nameKey: NAME_KEY,
      masterKey: MASTER,
    })
    const keys = published.flatMap((p) => p.keys)
    expect(keys.map((k) => k.file_id)).toEqual([NEW_FOLDER])
    const opened = wasm.unwrapFolderChild(
      FOLDER_KEY,
      ROOT,
      NEW_FOLDER,
      2,
      (await import('../src/lib/crypto')).fromBase64(keys[0].encrypted_file_key) as Uint8Array,
    ) as Uint8Array
    expect(Array.from(opened)).toEqual(Array.from(NAME_KEY))
  })
})
