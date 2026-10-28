/**
 * Task 2237b — an owner-created subfolder inside a shared folder publishes its
 * name-key wrap.
 *
 * A folder's name is sealed under its own key (derived from the owner's master
 * key), so a guest or member reads it only through the wrap the owner
 * publishes under the shared folder's key. Files got theirs on upload; a
 * folder the owner created after sharing got none, and its name was
 * unreadable to everyone but the owner. These tests pin:
 *   1. createOwnerFolder publishes an L7 wrap bound to (root, the new folder,
 *      folder) that opens to the folder's own name key, inside a custody folder;
 *   2. nothing is published outside a shared folder, or without a name key;
 *   3. every owner folder-create in src/ goes through createOwnerFolder (the
 *      one root-level exception names why).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

// shared_folders_v1 ON for this file (the paths under test are flag-on ones).
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, { sharedFoldersEnabled: async () => true, sharedFoldersEnabledForWrite: async () => true })


const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const NEW_FOLDER = '22222222-2222-4222-8222-222222222222'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

let custodyOn = true
const created: Array<{ parentId?: string; folderId?: string }> = []
const published: Array<{ folderId: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
}))

await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  getSharedFolder: async (folderId: string) => {
    if (!custodyOn) {
      const ErrorClass = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new ErrorClass('not found', 404)
    }
    return {
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: real.toBase64(wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => ({ id, parent_id: null }),
  getSentInvites: async () => [],
  createFolder: async (_name: string, parentId?: string, folderId?: string) => {
    created.push({ parentId, folderId })
    return { id: folderId, parent_id: parentId ?? null, is_folder: true }
  },
  publishSharedFolderKeys: async (folderId: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    published.push({ folderId, keys })
    return { written: keys.length, skipped: 0 }
  },
}))

const { createOwnerFolder } = await import('../src/lib/owner-upload-key')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')

beforeEach(() => {
  resetCustodyMemoryForTests()
  custodyOn = true
  created.length = 0
  published.length = 0
  clearSharedFolderLookups()
})

function nameKey(): Uint8Array {
  return wasm.derive_file_key(MASTER, encoder.encode(NEW_FOLDER)) as Uint8Array
}

describe('createOwnerFolder', () => {
  test('inside a custody folder: the new folder name-key wrap is published, L7 as a folder', async () => {
    await createOwnerFolder({ nameEncrypted: '{}', parentId: ROOT, folderId: NEW_FOLDER, nameKey: nameKey(), masterKey: MASTER })
    expect(created).toEqual([{ parentId: ROOT, folderId: NEW_FOLDER }])
    expect(published).toHaveLength(1)
    expect(published[0].folderId).toBe(ROOT)
    const [entry] = published[0].keys
    expect(entry.file_id).toBe(NEW_FOLDER)
    const wrap = real.fromBase64(entry.encrypted_file_key) as Uint8Array
    expect(Array.from(wasm.unwrapFolderChild(FOLDER_KEY, ROOT, NEW_FOLDER, 2, wrap) as Uint8Array)).toEqual(Array.from(nameKey()))
    // Bound to its kind: it does not open as a file.
    expect(() => wasm.unwrapFolderChild(FOLDER_KEY, ROOT, NEW_FOLDER, 1, wrap)).toThrow(/decryption failed/)
  })

  test('outside a shared folder, or with no name key (locked vault), nothing is published', async () => {
    custodyOn = false
    await createOwnerFolder({ nameEncrypted: '{}', parentId: ROOT, folderId: NEW_FOLDER, nameKey: nameKey(), masterKey: MASTER })
    custodyOn = true
    clearSharedFolderLookups()
    await createOwnerFolder({ nameEncrypted: 'plain name', parentId: ROOT, folderId: NEW_FOLDER })
    await createOwnerFolder({ nameEncrypted: '{}', folderId: NEW_FOLDER, nameKey: nameKey(), masterKey: MASTER })
    expect(created).toHaveLength(3)
    expect(published).toHaveLength(0)
  })
})

describe('every owner folder-create goes through createOwnerFolder', () => {
  // `createFolder(` may be CALLED only here; anything else would create a
  // subfolder whose name guests and members cannot read.
  const ALLOWED: Record<string, string> = {
    'src/lib/owner-upload-key.ts': 'createOwnerFolder itself',
    'src/lib/api.ts': 'the definition',
  }

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  test('no other module calls createFolder( directly', () => {
    const root = join(import.meta.dir, '..')
    const offenders: string[] = []
    for (const file of sources(join(root, 'src'))) {
      const relative = file.slice(root.length + 1)
      if (relative in ALLOWED) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/(^|[^\w.])createFolder\(/.test(line) && !/import /.test(line)) offenders.push(`${relative}:${index + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
