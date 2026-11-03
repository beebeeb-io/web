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
import { encodeEnvelope } from '../src/lib/metadata-envelope'

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
const FOLDER_KEY_2 = new Uint8Array(32).fill(0x33)

const ROOT = '11111111-1111-4111-8111-111111111111'
const DEST = '22222222-2222-4222-8222-222222222222'
const OUTSIDE = '33333333-3333-4333-8333-333333333333'
/** A second custody root the server may name on a later parent walk (N2). */
const R2 = '44444444-4444-4444-8444-444444444444'
const PLAIN_DEST = '55555555-5555-4555-8555-555555555555'
const DECOY = '66666666-6666-4666-8666-666666666666'
const TAXES = '99999999-9999-4999-8999-999999999999'

function derive(id: string): Uint8Array {
  return wasm.derive_file_key(MASTER, enc.encode(id)) as Uint8Array
}

/** The name a folder really carries: metadata sealed under its derived key. */
function sealedName(id: string): string {
  const meta = wasm.encrypt_metadata(derive(id), JSON.stringify({ name: `${id}.folder`, mime_type: null })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return encodeEnvelope(wasm, meta.nonce, meta.ciphertext)
}

/** R's inventory wrap for (R, folder, folder key): the L14 proof. */
function childWrap(id: string): string {
  return Buffer.from(
    wasm.wrapFolderChild(FOLDER_KEY, ROOT, id, 2, derive(id)) as Uint8Array,
  ).toString('base64')
}

type Row = { id: string; parent_id: string | null; name_encrypted: string; is_folder: boolean }
let rows: Record<string, Row> = {}
/** The wrap rows R's inventory keeps, even for a folder moved out of R (A17c). */
let rootInventory: Array<{ file_id: string; encrypted_file_key: string }> = []

const published: Array<{ folderId: string; keys: Array<{ file_id: string; encrypted_file_key: string }> }> = []
let inventoryReads = 0
/** N2: fires on the first inventory read, mid-call (see the test). */
let onInventory: (() => void) | null = null

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
    if (folderId !== ROOT && folderId !== R2) {
      const NotFound = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new NotFound('Not found.', 404)
    }
    const key = folderId === ROOT ? FOLDER_KEY : FOLDER_KEY_2
    return {
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: Buffer.from(wasm.wrapFolderCustody(MASTER, folderId, key) as Uint8Array).toString('base64'),
      wrapped_folder_key: null,
    }
  },
  listSharedFolderKeys: async () => {
    inventoryReads += 1
    const hook = onInventory
    onInventory = null
    hook?.()
    return { keys: rootInventory, next_cursor: null }
  },
  publishSharedFolderKeys: async (folderId: string, keys: Array<{ file_id: string; encrypted_file_key: string }>) => {
    published.push({ folderId, keys })
    return { published: keys.length }
  },
}))

// The owned-item port crosses into the worker; run the same core calls here.
await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (r) => ({
  ...r,
  ownedItem: {
    ...r.ownedItem,
    async resolve(args: {
      masterKey: Uint8Array
      itemId: string
      kind: number
      ownerWrap?: Uint8Array | null
      nameEncrypted: string
      sharedFolderId?: string | null
      folderKey?: Uint8Array | null
      folderWrap?: Uint8Array | null
      firstChunkFrame?: Uint8Array | null
    }) {
      const out = wasm.resolveOwnedKey(
        args.masterKey,
        args.itemId,
        args.kind,
        args.ownerWrap ?? null,
        args.nameEncrypted,
        args.sharedFolderId ?? null,
        args.folderKey ?? null,
        args.folderWrap ?? null,
        args.firstChunkFrame ?? null,
      ) as Record<string, unknown>
      return {
        key: out.key as Uint8Array,
        contentKey: (out.contentKey as Uint8Array | null) ?? null,
        origin: out.origin as never,
        name: (out.name as never) ?? null,
        writeTarget: (out.writeTarget as never) ?? null,
      }
    },
    async childWrapMatches(
      folderKey: Uint8Array,
      root: string,
      itemId: string,
      kind: number,
      wrapped: Uint8Array,
      expected: Uint8Array,
    ) {
      return wasm.childWrapMatches(folderKey, root, itemId, kind, wrapped, expected)
    },
  },
}))

const { publishOrDeferOwnerUpload } = await import('../src/lib/owner-upload-key')
const { noteFolderClick, noteUrlFolder, resetAnchorsForTests, readDeferredPublishes, PUBLISH_QUEUE_KEY } =
  await import('../src/lib/publish-anchor')
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')
const adoption = await import('../src/lib/owner-adoption')

function baseRows(): Record<string, Row> {
  return {
    [ROOT]: { id: ROOT, parent_id: null, name_encrypted: sealedName(ROOT), is_folder: true },
    [DEST]: { id: DEST, parent_id: ROOT, name_encrypted: sealedName(DEST), is_folder: true },
    [OUTSIDE]: { id: OUTSIDE, parent_id: null, name_encrypted: sealedName(OUTSIDE), is_folder: true },
    [PLAIN_DEST]: { id: PLAIN_DEST, parent_id: ROOT, name_encrypted: 'My plain folder', is_folder: true },
    [DECOY]: { id: DECOY, parent_id: ROOT, name_encrypted: sealedName(DECOY), is_folder: true },
  }
}

function reset(): void {
  rows = baseRows()
  // R's inventory carries the L14 proof for DEST and the decoy, so those
  // destination checks are not what the anchoring tests exercise.
  rootInventory = [
    { file_id: DEST, encrypted_file_key: childWrap(DEST) },
    { file_id: DECOY, encrypted_file_key: childWrap(DECOY) },
  ]
  inventoryReads = 0
  onInventory = null
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
    test(`${name}: owner-only, nothing queued`, async () => {
      apply()
      expect(await create(DEST)).toBe('not_published')
      expect(published).toEqual([])
      expect(readDeferredPublishes(store)).toEqual([])
      expect(store.getItem(PUBLISH_QUEUE_KEY)).toBeNull()
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
    noteFolderClick(ROOT)
    noteFolderClick(PLAIN_DEST)
    noteUrlFolder(PLAIN_DEST)
    expect(await create(PLAIN_DEST)).toBe('deferred')
    expect(published).toEqual([])
    expect(readDeferredPublishes(store)).toHaveLength(1)
  })

  test('control: the same folder renamed under its derived key (with its L14 wrap) publishes', async () => {
    // Renamed under its derived key AND its wrap in R's inventory passes L14,
    // and the tab clicked into R itself: the only case that may publish.
    rows[PLAIN_DEST] = { ...rows[PLAIN_DEST], name_encrypted: sealedName(PLAIN_DEST) }
    rootInventory = [
      { file_id: PLAIN_DEST, encrypted_file_key: childWrap(PLAIN_DEST) },
    ]
    noteFolderClick(ROOT)
    noteFolderClick(PLAIN_DEST)
    noteUrlFolder(PLAIN_DEST)
    expect(await create(PLAIN_DEST)).toBe('published')
    expect(published).toHaveLength(1)
  })
})

describe('N2: the seal uses the proven root, not a second parent walk', () => {
  test('a chain that names R2 mid-call publishes once, under the proven R', async () => {
    // The whole chain runs through the real entry point (publishOrDefer), not a
    // hand-fed proven root. The create is anchored: the tab clicked R then DEST.
    noteFolderClick(ROOT)
    noteFolderClick(DEST)
    noteUrlFolder(DEST)
    // The L14 proof named ROOT and unwrapped ROOT's folder key. From the first
    // inventory read on, the server (and the 10 s parent cache) would answer a
    // fresh walk with a different custody root R2; a re-walk would prove
    // against R2, whose key is not ROOT's, and the seal must not follow it.
    onInventory = () => {
      rows[DEST] = { ...rows[DEST], parent_id: R2 }
      adoption.clearSharedFolderLookups()
      resetCustodyMemoryForTests()
    }
    expect(await create(DEST)).toBe('published')
    expect(onInventory).toBeNull()
    expect(published).toHaveLength(1)
    expect(published[0].folderId).toBe(ROOT)
    expect(published.some((p) => p.folderId === R2)).toBe(false)
  })
})

describe('A17 decoy: a member folder shown at My files > Taxes > 2024', () => {
  test('R was clicked earlier, but the user left it before opening the decoy: nothing is published', async () => {
    // The user clicks into R, then leaves it for My files > Taxes > 2024.
    // 2024 is the member's decoy and the server's parent walk places it under
    // R; its L14 proof passes. R is in the tab's history but not on the
    // current click path that ends at the decoy — the anchor is missing.
    noteFolderClick(ROOT)
    noteUrlFolder(ROOT)
    noteUrlFolder(OUTSIDE)
    noteFolderClick(TAXES)
    noteUrlFolder(TAXES)
    noteFolderClick(DECOY)
    noteUrlFolder(DECOY)
    expect(await create(DECOY)).toBe('not_published')
    expect(published).toEqual([])
    expect(readDeferredPublishes(store)).toEqual([])
  })
})
