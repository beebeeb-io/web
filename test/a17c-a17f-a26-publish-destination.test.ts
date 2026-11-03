/**
 * Contract 2275 L15: the destination must be one the client can PROVE, and the
 * write must be anchored to a click in this tab. Three adversarial rows:
 *
 * - A17c: a folder the owner moved out of the shared root R. The server keeps
 *   the folder's child wrap under R and shows the folder outside R; neither the
 *   kept wrap nor the row itself may make an upload into it publish.
 * - A17f: every removed trigger, each separately — reload, deep link, pinned,
 *   Recent, Quick Access, search, the command palette, a navigation in flight,
 *   a sidebar or pinned drop target and a foreign drag payload. None anchors, so
 *   nothing is published; the create is deferred instead.
 * - A26: a plaintext-named O folder as the destination is never proven for
 *   L15(b) until it is renamed under its derived key, so an upload into it is
 *   deferred, not published.
 *
 * The control in each group proves the mocks CAN publish (so a green test is
 * not vacuous).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

preserveGlobals('fetch', 'localStorage')
setGlobal('fetch', (async (input: RequestInfo | URL) => {
  throw new Error(`unit test tried the network: ${String(input)}`)
}) as typeof fetch)

/** Only the store shape publish-anchor needs. */
class MemoryStore {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  clear(): void {
    this.map.clear()
  }
}

const store = new MemoryStore()
setGlobal('localStorage', store)

const wasm = loadWasm()
const enc = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

const ROOT = '11111111-1111-4111-8111-111111111111'
const DEST = '22222222-2222-4222-8222-222222222222'
const OUTSIDE = '33333333-3333-4333-8333-333333333333'
const PLAIN_DEST = '55555555-5555-4555-8555-555555555555'

type Row = { id: string; parent_id: string | null; name_encrypted: string; is_folder: boolean }
let rows: Record<string, Row> = {}
/** The wrap rows R's inventory keeps, even for a folder moved out of R (A17c). */
let rootInventory: Array<{ file_id: string; encrypted_file_key: string }> = []

const published: Array<{ folderId: string; keys: Array<{ file_id: string; encrypted_file_key: string }> }> = []
let inventoryReads = 0

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (masterKey: Uint8Array, id: string) => wasm.derive_file_key(masterKey, enc.encode(id)),
}))

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, {
  sharedFoldersEnabled: async () => true,
  sharedFoldersEnabledForWrite: async () => true,
})

await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  getFile: async (id: string) => {
    const row = rows[id]
    if (!row) {
      const NotFound = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new NotFound('Not found.', 404)
    }
    return {
      ...row,
      mime_type: row.is_folder ? null : 'text/plain',
      size_bytes: 4,
      chunk_count: 1,
      is_trashed: false,
      created_at: '2026-05-08T00:00:00.000Z',
      updated_at: '2026-05-08T00:00:00.000Z',
    }
  },
  getSharedFolder: async (folderId: string) => {
    if (folderId !== ROOT) {
      const NotFound = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new NotFound('Not found.', 404)
    }
    return {
      folder_id: ROOT,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: Buffer.from(wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array).toString('base64'),
      wrapped_folder_key: null,
    }
  },
  listSharedFolderKeys: async () => {
    inventoryReads += 1
    return { keys: rootInventory, next_cursor: null }
  },
  publishSharedFolderKeys: async (folderId: string, keys: Array<{ file_id: string; encrypted_file_key: string }>) => {
    published.push({ folderId, keys })
    return { published: keys.length }
  },
}))

const { publishOrDeferOwnerUpload } = await import('../src/lib/owner-upload-key')
const { noteFolderClick, noteUrlFolder, resetAnchorsForTests, readDeferredPublishes, PUBLISH_QUEUE_KEY } =
  await import('../src/lib/publish-anchor')
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')
const adoption = await import('../src/lib/owner-adoption')

/** A sealed (encrypted) folder name. Its bytes never need to open here. */
const SEALED = JSON.stringify({ nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAA' })

function baseRows(): Record<string, Row> {
  return {
    [ROOT]: { id: ROOT, parent_id: null, name_encrypted: SEALED, is_folder: true },
    [DEST]: { id: DEST, parent_id: ROOT, name_encrypted: SEALED, is_folder: true },
    [OUTSIDE]: { id: OUTSIDE, parent_id: null, name_encrypted: SEALED, is_folder: true },
    [PLAIN_DEST]: { id: PLAIN_DEST, parent_id: ROOT, name_encrypted: 'My plain folder', is_folder: true },
  }
}

function reset(): void {
  rows = baseRows()
  rootInventory = []
  inventoryReads = 0
  published.length = 0
  store.clear()
  resetAnchorsForTests()
  resetCustodyMemoryForTests()
  adoption.clearSharedFolderLookups()
}

async function create(parentId: string, fileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  return publishOrDeferOwnerUpload({
    masterKey: MASTER,
    parentId,
    fileId,
    fileKey: new Uint8Array(32).fill(9),
  })
}

beforeEach(reset)

describe('A17c: a folder moved out of the shared root (the server keeps its wrap)', () => {
  test('an upload into it publishes nothing, and the kept wrap is never read as proof', async () => {
    // The owner moved DEST out of ROOT on another device. The server still
    // lists DEST's child wrap under ROOT and shows DEST at a private path.
    rows[DEST] = { ...rows[DEST], parent_id: OUTSIDE }
    rootInventory = [{ file_id: DEST, encrypted_file_key: 'bA==' }]
    // The user even clicked into it in this tab: the anchor is not the issue.
    noteFolderClick(DEST)
    noteUrlFolder(DEST)

    expect(await create(DEST)).toBe('not_published')
    expect(published).toEqual([])
    expect(inventoryReads).toBe(0)
    expect(readDeferredPublishes(store)).toEqual([])
  })
})

describe('A17f: no removed trigger anchors a publish', () => {
  // Each trigger name is applied separately, then the create is attempted into
  // DEST (a proven folder inside R). None of them may publish.
  const triggers: Array<[string, () => void]> = [
    ['reload', () => {}],
    ['deep link', () => noteUrlFolder(DEST)],
    ['pinned folder', () => noteUrlFolder(DEST)],
    ['Recent', () => noteUrlFolder(DEST)],
    ['Quick Access', () => noteUrlFolder(DEST)],
    ['search', () => noteUrlFolder(DEST)],
    ['the command palette', () => noteUrlFolder(DEST)],
    ['navigation in flight', () => { noteFolderClick(DEST); noteUrlFolder(OUTSIDE) }],
    ['a sidebar drop target', () => noteUrlFolder(DEST)],
    ['a pinned drop target', () => noteUrlFolder(DEST)],
    ['a foreign drag payload', () => noteUrlFolder(DEST)],
  ]

  for (const [name, apply] of triggers) {
    test(`${name}: deferred, nothing published`, async () => {
      apply()
      expect(await create(DEST)).toBe('deferred')
      expect(published).toEqual([])
      const queue = readDeferredPublishes(store)
      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({ parentId: DEST, rootId: ROOT, own: true })
      expect(store.getItem(PUBLISH_QUEUE_KEY)).not.toBeNull()
    })
  }

  test('control: a click through the destination in this tab does publish once', async () => {
    noteFolderClick(ROOT)
    noteFolderClick(DEST)
    noteUrlFolder(DEST)
    expect(await create(DEST)).toBe('published')
    expect(published).toHaveLength(1)
    expect(published[0].folderId).toBe(ROOT)
    expect(readDeferredPublishes(store)).toEqual([])
  })
})

describe('A26: a plaintext-named O folder is not a proven publish destination', () => {
  test('an upload into it is deferred, not published', async () => {
    noteFolderClick(PLAIN_DEST)
    noteUrlFolder(PLAIN_DEST)
    expect(await create(PLAIN_DEST)).toBe('deferred')
    expect(published).toEqual([])
    expect(readDeferredPublishes(store)).toHaveLength(1)
  })

  test('control: the same folder renamed under its derived key publishes', async () => {
    rows[PLAIN_DEST] = { ...rows[PLAIN_DEST], name_encrypted: SEALED }
    noteFolderClick(PLAIN_DEST)
    noteUrlFolder(PLAIN_DEST)
    expect(await create(PLAIN_DEST)).toBe('published')
    expect(published).toHaveLength(1)
  })
})
