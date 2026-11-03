/**
 * Review F9 (P2) — every create mints its id in core.
 *
 * L13: "creates mint their id with `NewItemId` and propose it; the tag makes
 * an interrupted session resumable and a substituted id unsealable." A site
 * that calls `crypto.randomUUID()` mints an id core never tagged, so nothing
 * can prove the create was not substituted. The four sites below (New folder,
 * the import tree, the import's file create, an editor's "Keep Both", and an
 * upload restarting under a fresh id) all mint through the owned-item port.
 *
 * The port is mocked with a recognisable id: a JS v4 fallback could never
 * produce it, so each assertion fails on the pre-fix code even though a v4 is
 * also 36 characters.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const CORE_IDS = ['core-minted-folder-id', 'core-minted-second-id', 'core-minted-file-id']
let minted = 0
const mintedIds: string[] = []
const createdFolders: Array<{ folderId: string; parentId?: string }> = []
const uploadedFileIds: string[] = []

await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (real) => ({
  ...real,
  ownedItem: {
    ...(real.ownedItem as Record<string, unknown>),
    mint: async (_masterKey: Uint8Array, idClass: string) => {
      const idText = CORE_IDS[minted++] ?? `core-minted-${minted}`
      mintedIds.push(idText)
      return { idText, tag: new Uint8Array(32).fill(0x0e), idClass }
    },
  },
}))

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  // The envelope writer, the name sealer and the derivation cross to the
  // worker; the ids under test do not depend on them.
  serializeEncryptedBlob: async (nonce: Uint8Array, ciphertext: Uint8Array) =>
    JSON.stringify({ nonce: Array.from(nonce), ciphertext: Array.from(ciphertext) }),
  encryptFilename: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([1, 2, 3]) }),
  deriveFileKey: async () => new Uint8Array(32).fill(5),
  zeroize: () => {},
})

await mockModuleScoped('../src/lib/owner-upload-key', import.meta.dir, {
  createOwnerFolder: async (args: { folderId: string; parentId?: string }) => {
    createdFolders.push({ folderId: args.folderId, parentId: args.parentId })
    return { id: args.folderId }
  },
})

await mockModuleScoped('../src/lib/encrypted-upload', import.meta.dir, {
  encryptedUpload: async (_file: File, fileId: string) => {
    uploadedFileIds.push(fileId)
    return { id: fileId }
  },
})

const MK = new Uint8Array(32).fill(7)
const SEALED = { nonce: new Uint8Array(12), ciphertext: new Uint8Array([1, 2, 3]) }

/** The modules read after the mocks are in place. */
const { createNamedOwnerFolder } = await import('../src/lib/new-folder')
const { createImportFolderTree, importFileInto } = await import('../src/lib/import-folders')
const { saveTargetFor } = await import('../src/lib/owner-save-target')

function source(path: string): string {
  return readFileSync(join(import.meta.dir, '..', path), 'utf8')
}

describe('F9: a create mints through core (NewItemId)', () => {
  test('New folder proposes the id core minted, never a JS v4', async () => {
    const before = minted
    const created = await createNamedOwnerFolder({
      name: 'Taxes',
      vaultReady: true,
      getFileKey: async () => new Uint8Array(32).fill(5),
      getMasterKey: () => MK,
      seal: async () => SEALED,
    })
    expect(minted).toBe(before + 1)
    expect(createdFolders.at(-1)?.folderId).toBe(mintedIds.at(-1)!)
    expect(created.id).toBe(mintedIds.at(-1)!)
  })

  test('the import tree mints every folder id through core', async () => {
    const folders = createImportFolderTree(MK)
    const first = await folders.ensure('/Photos/2024')
    const second = await folders.ensure('/Photos/2025')
    expect(first).toBe(mintedIds.at(-2)!)
    expect(second).toBe(mintedIds.at(-1)!)
    expect(createdFolders.slice(-2).map((f) => f.folderId)).toEqual([first, second])
  })

  test("an import's file create mints its id through core", async () => {
    const folders = createImportFolderTree(MK)
    await importFileInto({
      folders,
      parentPath: '/Photos',
      name: 'photo.jpg',
      masterKey: MK,
      download: async () => new Blob([new Uint8Array([1, 2, 3, 4])]),
      signal: new AbortController().signal,
      onStatus: () => {},
      onBytes: () => {},
    })
    expect(uploadedFileIds.at(-1)).toBe(mintedIds.at(-1)!)
  })

  test('an editor "Keep Both" mints through core and carries the tag', async () => {
    const target = await saveTargetFor({
      file: { id: 'row-id', name_encrypted: 'NAME' } as never,
      targetFileId: undefined,
      masterKey: MK,
    })
    expect(target.uploadFileId).toBe(mintedIds.at(-1)!)
    expect(target.newItemId?.idText).toBe(target.uploadFileId)
    expect(target.newItemId?.tag.length).toBe(32)
    expect(target.isNewItem).toBe(true)
  })

  test('the uploader and the paused-resume banner mint through core, not crypto.randomUUID()', () => {
    // The two upload paths take an id per upload: a create that restarts under
    // a fresh id. Both call the owned-item port.
    const upload = source('src/lib/encrypted-upload.ts')
    expect(upload).toContain("ownedItem.mint(masterKey, 'owner')")
    expect(upload).not.toContain('crypto.randomUUID()')
    const banner = source('src/pages/drive/use-drive-uploads.ts')
    expect(banner).toContain("ownedItem.mint(getMasterKey(), 'owner')")
  })
})
