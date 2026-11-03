/**
 * Review F8 — the anchor wiring exists in PRODUCTION, not only in the library.
 *
 * `noteFolderClick` / `noteUrlFolder` / `readDeferredPublishes` /
 * `dropDeferredForItems` had no production callers: the drive never noted a
 * click, so an owner's upload into a shared folder was deferred forever and
 * A14 never happened. The drive now routes its folder clicks (folder row and
 * breadcrumb) through `noteDriveFolderClick` and every URL-only change through
 * `noteDriveUrlFolder`, then flushes what is due once a click lands.
 *
 * The bun harness has no DOM (no jsdom), so this drives the same production
 * functions the page calls, in the page's own order, and pins the call sites
 * in the hook/page source. Spec L15 (b)3 / §14.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { encodeEnvelope } from '../src/lib/metadata-envelope'

const wasm = loadWasm()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FILE_KEY = new Uint8Array(32).fill(0x11)
const SEALED_NAME = JSON.stringify({ name: 'deferred.pdf', mime_type: null })
const encoder = new TextEncoder()

class MemoryStore {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStore(), configurable: true, writable: true })
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})

const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []

const strKey = (id: string) => wasm.derive_file_key(MASTER, encoder.encode(id)) as Uint8Array
const sealedName = (key: Uint8Array) => {
  const sealed = wasm.encrypt_metadata(key, SEALED_NAME) as { nonce: Uint8Array; ciphertext: Uint8Array }
  return encodeEnvelope(wasm, sealed.nonce, sealed.ciphertext)
}

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => true,
  sharedFoldersEnabledForWrite: async () => true,
}))
await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
}))
await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (r) => ({
  ...r,
  ownedItem: {
    resolve: async (args: {
      masterKey: Uint8Array
      itemId: string
      kind: number
      ownerWrap?: Uint8Array | null
      nameEncrypted: string
      sharedFolderId?: string | null
      folderKey?: Uint8Array | null
      folderWrap?: Uint8Array | null
      firstChunkFrame?: Uint8Array | null
    }) =>
      wasm.resolveOwnedKey(
        args.masterKey,
        args.itemId,
        args.kind,
        args.ownerWrap ?? null,
        args.nameEncrypted,
        args.sharedFolderId ?? null,
        args.folderKey ?? null,
        args.folderWrap ?? null,
        args.firstChunkFrame ?? null,
      ),
    childWrapMatches: (
      folderKey: Uint8Array,
      root: string,
      itemId: string,
      kind: number,
      wrapped: Uint8Array,
      expected: Uint8Array,
    ) => wasm.childWrapMatches(folderKey, root, itemId, kind, wrapped, expected),
  },
}))
await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  ...r,
  getFile: async (id: string) => ({
    id,
    parent_id: id === ROOT ? null : ROOT,
    is_folder: id === ROOT,
    name_encrypted: id === ROOT ? sealedName(strKey(ROOT)) : sealedName(strKey(FILE_ID)),
    uploaded_by: 'owner',
  }),
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
  listSharedFolderKeys: async () => ({ keys: [], next_cursor: null }),
  listFilesPage: async () => ({ files: [], next_cursor: null }),
  publishSharedFolderKeys: async (
    root: string,
    keys: { file_id: string; encrypted_file_key: string }[],
  ) => {
    published.push({ root, keys })
    return { written: keys.length, skipped: 0 }
  },
}))

const { noteDriveFolderClick, noteDriveUrlFolder, publishDeferredOnAnchoredSite } = await import(
  '../src/lib/drive-anchors'
)
const { publishOrDeferOwnerUpload } = await import('../src/lib/owner-upload-key')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')
const { resetAnchorsForTests, readDeferredPublishes } = await import('../src/lib/publish-anchor')

beforeEach(() => {
  published.length = 0
  clearSharedFolderLookups()
  resetAnchorsForTests()
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStore(), configurable: true, writable: true })
})

describe('F8: the drive wires the anchor trail in production', () => {
  test('clicking into R then uploading publishes the wrap once', async () => {
    // handleFolderOpen: the user's own click, then the URL shows R.
    noteDriveFolderClick(ROOT)
    const result = await publishOrDeferOwnerUpload({
      masterKey: MASTER,
      parentId: ROOT,
      fileId: FILE_ID,
      fileKey: FILE_KEY,
    })
    expect(result).toBe('published')
    expect(published).toHaveLength(1)
    expect(published[0].root).toBe(ROOT)
    expect(published[0].keys.map((k) => k.file_id)).toEqual([FILE_ID])
  })

  test('A14: a create deferred under a URL-only view publishes when the user then clicks into R', async () => {
    // A deep link / ?folder= shows R without a click: the upload defers.
    noteDriveUrlFolder(ROOT)
    const first = await publishOrDeferOwnerUpload({
      masterKey: MASTER,
      parentId: ROOT,
      fileId: FILE_ID,
      fileKey: FILE_KEY,
    })
    expect(first).toBe('deferred')
    expect(published).toEqual([])
    expect(readDeferredPublishes(globalThis.localStorage).map((r) => r.id)).toEqual([FILE_ID])

    // The user clicks into R: the drive flushes what is now due.
    noteDriveFolderClick(ROOT)
    const flushed = await publishDeferredOnAnchoredSite(MASTER)
    expect(flushed).toBe(1)
    expect(published).toHaveLength(1)
    expect(published[0].keys.map((k) => k.file_id)).toEqual([FILE_ID])
    expect(readDeferredPublishes(globalThis.localStorage)).toEqual([])
  })

  test('a URL navigation alone still never anchors: the deferral stays', async () => {
    noteDriveUrlFolder(ROOT)
    await publishOrDeferOwnerUpload({ masterKey: MASTER, parentId: ROOT, fileId: FILE_ID, fileKey: FILE_KEY })
    expect(await publishDeferredOnAnchoredSite(MASTER)).toBe(0)
    expect(published).toEqual([])
    expect(readDeferredPublishes(globalThis.localStorage).map((r) => r.id)).toEqual([FILE_ID])
  })

  test('the drive page and its hook call the wiring (no dead exports)', async () => {
    const hook = await Bun.file(new URL('../src/pages/drive/use-drive-commands.ts', import.meta.url)).text()
    expect(hook).toContain('noteDriveFolderClick(folder.id)')
    expect(hook).toContain('noteDriveFolderClick(target.id)')
    expect(hook).toContain('publishDeferredOnAnchoredSite(getMasterKey())')
    const page = await Bun.file(new URL('../src/pages/drive.tsx', import.meta.url)).text()
    expect(page).toContain('noteDriveUrlFolder(folderId)')
  })
})
