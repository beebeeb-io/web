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
import { createContentOps } from '../src/lib/content-crypto'

// shared_folders_v1 ON for this file (the paths under test are flag-on ones).
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, { sharedFoldersEnabled: async () => true, sharedFoldersEnabledForWrite: async () => true })


const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const NEW_FOLDER = '22222222-2222-4222-8222-222222222222'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

let custodyOn = true
/** The next N folder creates fail as a dropped connection (ApiError status 0). */
let dropNextCreates = 0
/**
 * R4-3: after the drops, the next create answers 500. POST /files/folder is a
 * plain INSERT, so a retry whose first attempt committed hits the primary key.
 */
let conflictAfterDrops = false
/** What GET /files/{NEW_FOLDER} answers: the folder that landed, or nothing. */
let landedNewFolder: Record<string, unknown> | null = null
const rowLookups: string[] = []
const created: Array<{ parentId?: string; folderId?: string }> = []
const published: Array<{ folderId: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  // Core's name reader, in process (the worker hop skipped).
  readNameMetadata: async (fileKey: Uint8Array, nameEncrypted: string) =>
    createContentOps(wasm).readNameMetadata(fileKey, nameEncrypted),
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
  getFile: async (id: string) => {
    rowLookups.push(id)
    if (id === NEW_FOLDER) {
      if (!landedNewFolder) {
        const NotFound = r.ApiError as unknown as new (message: string, status: number) => Error
        throw new NotFound('Not found.', 404)
      }
      return landedNewFolder
    }
    return { id, parent_id: null }
  },
  getSentInvites: async () => [],
  createFolder: async (_name: string, parentId?: string, folderId?: string) => {
    created.push({ parentId, folderId })
    const Failed = r.ApiError as unknown as new (message: string, status: number) => Error
    if (dropNextCreates > 0) {
      dropNextCreates--
      throw new Failed('Could not reach the server. Check your connection and try again.', 0)
    }
    if (conflictAfterDrops) {
      conflictAfterDrops = false
      throw new Failed('Internal server error', 500)
    }
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
  dropNextCreates = 0
  conflictAfterDrops = false
  landedNewFolder = null
  rowLookups.length = 0
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

// SF-0001 round 3, R3-3: a dropped connection is retried under the SAME id
// (it was minted for this folder, so no other client holds it). Real
// withNetworkRetry here: its first back-off is about a second.
describe('createOwnerFolder retries a transient create failure under the same folder id', () => {
  test('status 0, then the answer: one folder, both attempts under its id', async () => {
    dropNextCreates = 1
    const folder = await createOwnerFolder({ nameEncrypted: '{}', folderId: NEW_FOLDER })
    expect(folder.id).toBe(NEW_FOLDER)
    expect(created).toEqual([{ parentId: undefined, folderId: NEW_FOLDER }, { parentId: undefined, folderId: NEW_FOLDER }])
  })
})

// SF-0001 round 4, R4-3: the retry after a dropped connection may meet the
// folder its first attempt already created (a 500 on the primary key). The
// row is then looked up: one that exists and whose name authenticates under
// this user's key IS the folder, and the create goes on (wrap included).
describe('createOwnerFolder after a dropped connection: the folder may already be there', () => {
  /** A folder name sealed by core under `key` (the shape encryptFileMetadata produces). */
  function sealedName(key: Uint8Array, name: string): string {
    const b = wasm.encrypt_metadata(key, JSON.stringify({ name, mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    return JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: Array.from(b.nonce), ciphertext: Array.from(b.ciphertext) })
  }
  const folderRow = (name_encrypted: string, over: Record<string, unknown> = {}) => ({
    id: NEW_FOLDER, name_encrypted, is_folder: true, is_trashed: false, parent_id: ROOT, mime_type: null,
    size_bytes: 0, chunk_count: 0, created_at: '2026-10-31T00:00:00Z', updated_at: '2026-10-31T00:00:00Z',
    ...over,
  })
  /** The name this client sealed and sent (core seals with a random nonce, so one string). */
  let sent = ''
  const createArgs = () => {
    sent = sealedName(nameKey(), 'Taxes')
    return { nameEncrypted: sent, parentId: ROOT, folderId: NEW_FOLDER, nameKey: nameKey(), masterKey: MASTER }
  }

  test('dropped, then 500; the row is there with exactly the name sent: created, and the wrap is published', async () => {
    dropNextCreates = 1
    conflictAfterDrops = true
    const args = createArgs()
    landedNewFolder = folderRow(sent)
    const folder = await createOwnerFolder(args)
    expect(folder.id).toBe(NEW_FOLDER)
    expect(rowLookups).toContain(NEW_FOLDER)
    // The parent is a shared (custody) folder: its name-key wrap still goes out.
    expect(published).toHaveLength(1)
    expect(published[0].keys.map((k) => k.file_id)).toEqual([NEW_FOLDER])
  })

  test('dropped, then 500; no such row: the error surfaces, nothing is published', async () => {
    dropNextCreates = 1
    conflictAfterDrops = true
    await expect(createOwnerFolder(createArgs())).rejects.toMatchObject({ status: 500 })
    expect(rowLookups).toContain(NEW_FOLDER)
    expect(published).toEqual([])
  })

  test('dropped, then 500; a row whose name does not authenticate under this key: the error surfaces', async () => {
    dropNextCreates = 1
    conflictAfterDrops = true
    landedNewFolder = folderRow(sealedName(new Uint8Array(32).fill(9), 'Taxes'))
    await expect(createOwnerFolder(createArgs())).rejects.toMatchObject({ status: 500 })
    expect(rowLookups).toContain(NEW_FOLDER)
    expect(published).toEqual([])
  })

  // Round 5 (F2): the check runs on ANY create failure for a client-minted id,
  // not only after a drop within this call (the import's next call meets the
  // primary key of the folder an earlier call committed). These replace R4-3's
  // "a lone 500 is just an error: no lookup" control, removed in 51e233f.
  test('F2: a lone 500 (no dropped connection in this call) with exactly the folder sent: adopted', async () => {
    conflictAfterDrops = true
    const args = createArgs()
    landedNewFolder = folderRow(sent)
    const folder = await createOwnerFolder(args)
    expect(folder.id).toBe(NEW_FOLDER)
    expect(rowLookups).toContain(NEW_FOLDER)
    expect(published).toHaveLength(1)
  })

  test('F2: a lone 500 and no such row: the 500 surfaces', async () => {
    conflictAfterDrops = true
    await expect(createOwnerFolder(createArgs())).rejects.toMatchObject({ status: 500 })
    expect(rowLookups).toContain(NEW_FOLDER)
    expect(published).toEqual([])
  })

  // Round 5 (F1, F3): only the folder THIS client sent is adopted: exactly
  // the sealed name it sent, a live folder, under the parent it asked for.
  for (const [why, row] of [
    ['a plaintext legacy name', () => folderRow('Taxes')],
    ['a different sealed name (even one that authenticates under this key)', () => folderRow(sealedName(nameKey(), 'Taxes'))],
    ['under another parent', () => folderRow(sent, { parent_id: '33333333-3333-4333-8333-333333333333' })],
    ['at the root instead of under the parent', () => folderRow(sent, { parent_id: null })],
    ['not a folder', () => folderRow(sent, { is_folder: false })],
    ['in the trash', () => folderRow(sent, { is_trashed: true })],
  ] as const) {
    test(`F1/F3: a landed row with ${why} is not adopted; the 500 surfaces and no wrap is published`, async () => {
      dropNextCreates = 1
      conflictAfterDrops = true
      const args = createArgs()
      landedNewFolder = row()
      await expect(createOwnerFolder(args)).rejects.toMatchObject({ status: 500 })
      expect(rowLookups).toContain(NEW_FOLDER)
      expect(published).toEqual([])
    })
  }

  test('F4: a caller with no name key (the folder suggestion: no parent) still adopts the folder it sent', async () => {
    dropNextCreates = 1
    conflictAfterDrops = true
    sent = sealedName(nameKey(), 'Photos')
    landedNewFolder = folderRow(sent, { parent_id: null })
    const folder = await createOwnerFolder({ nameEncrypted: sent, folderId: NEW_FOLDER })
    expect(folder.id).toBe(NEW_FOLDER)
    expect(published).toEqual([])
  })
})
