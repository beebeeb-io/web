/**
 * Review F11 (2275 L15): a binary-convention row is a proven owner key too.
 *
 * Core's `resolve_owned_key` reports the legacy binary convention for a row
 * whose name was sealed with `derive_file_key(master, uuid_bytes)`; its origin
 * is `derived_binary` and the name authenticates under that key. Leaving
 * `derived_binary` out of the proven set refused the row ("its name is not
 * sealed") in the share panel and silently skipped it on a move, so binary
 * items were never shareable.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L14: the wrap equals the resolver key and the name authenticates.
 *   L15: "Share N items with this folder" publishes exactly what was shown.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const DEST = '77777777-7777-4777-8777-777777777777'
const FILE_ID = '66666666-6666-4666-8666-666666666666'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

const uuidBytes = Uint8Array.from(
  FILE_ID.replace(/-/g, '').match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
)
const BINARY_KEY = wasm.derive_file_key(MASTER, uuidBytes) as Uint8Array
const NAME = wasm.encrypt_name_for(BINARY_KEY, 'legacy-binary.bin', null, 0) as string

const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []
let listings: Record<string, unknown>[] = []
let flagOn = true

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => flagOn,
  sharedFoldersEnabledForWrite: async () => flagOn,
}))
await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, encoder.encode(id)),
}))
// The publish sink is mocked on BOTH the facade and its source: `api.ts`
// re-exports it, and code that imports the source directly (or held the
// binding before this file's mock) must record here too. The full run caught
// the facade-only mock being bypassed and the test posting to production.
const publishSharedFolderKeys = async (root: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
  published.push({ root, keys })
  return { written: keys.length, skipped: 0 }
}
await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  updateFile: async (id: string, body: { parent_id?: string | null }) => ({ id, parent_id: body.parent_id ?? null }),
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
  getFile: async (id: string) => ({ id, parent_id: id === DEST ? ROOT : null }),
  getSentInvites: async () => [],
  listFilesPage: async ({ parentId }: { parentId: string }) => ({
    files: parentId === ROOT ? listings : [],
    next_cursor: null,
  }),
  publishSharedFolderKeys,
}))
await mockModuleScoped('../src/lib/api-folder-links', import.meta.dir, () => ({
  listSharedFolderKeys: async () => ({ keys: [], next_cursor: null }),
  publishSharedFolderKeys,
}))
// The owned-item port crosses into the worker; run the same core calls here.
await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (real) => ({
  ...real,
  ownedItem: {
    ...real.ownedItem,
    async isForeign(itemId: string) {
      return wasm.isForeignItemId(itemId)
    },
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
      const r = wasm.resolveOwnedKey(
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
        key: r.key as Uint8Array,
        contentKey: (r.contentKey as Uint8Array | null) ?? null,
        origin: r.origin as never,
        name: (r.name as never) ?? null,
        writeTarget: (r.writeTarget as never) ?? null,
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

const { collectShareCandidates, cannotShareReason } = await import('../src/lib/share-missing-items')
const { moveOwnerItems } = await import('../src/lib/owner-upload-key')
const { fromBase64 } = await import('../src/lib/crypto')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')

const binaryRow = {
  id: FILE_ID,
  name_encrypted: NAME,
  is_folder: false,
  owner_wrapped_file_key: null,
  wrapped_file_key: null,
  file_request_id: null,
  size_bytes: 4,
  chunk_count: 1,
}

beforeEach(() => {
  flagOn = true
  published.length = 0
  listings = []
  clearSharedFolderLookups()
})

describe('F11: a binary-convention row is a proven owner key', () => {
  test('core reports the row as derived_binary, and the share panel calls it shareable', async () => {
    expect(wasm.ownerFileKeyForName(MASTER, FILE_ID, NAME).convention).toBe('binary')
    listings = [binaryRow]

    const result = await collectShareCandidates({ rootId: ROOT, masterKey: MASTER, folderKey: FOLDER_KEY })
    expect(result.candidates).toHaveLength(1)
    const [candidate] = result.candidates
    expect(candidate.status).toBe('shareable')
    expect(cannotShareReason(candidate.status)).toBeNull()

    const { publishShareCandidates } = await import('../src/lib/share-missing-items')
    await publishShareCandidates({ rootId: ROOT, folderKey: FOLDER_KEY, confirmed: result.shareable })
    const keys = published.flatMap((p) => p.keys)
    expect(keys.map((k) => k.file_id)).toEqual([FILE_ID])
    // The wrap must hold the key that authenticates the name: the binary one.
    const opened = wasm.unwrapFolderChild(
      FOLDER_KEY,
      ROOT,
      FILE_ID,
      1,
      fromBase64(keys[0].encrypted_file_key) as Uint8Array,
    ) as Uint8Array
    expect(Array.from(opened)).toEqual(Array.from(BINARY_KEY))
  })

  test('a move into R the picker showed publishes the binary-convention key', async () => {
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, is_folder: false, name_encrypted: NAME }],
      masterKey: MASTER,
      viewerId: 'owner-user',
      pickerRootId: ROOT,
    })

    const keys = published.flatMap((p) => p.keys)
    expect(keys.map((k) => k.file_id)).toEqual([FILE_ID])
    const opened = wasm.unwrapFolderChild(
      FOLDER_KEY,
      ROOT,
      FILE_ID,
      1,
      fromBase64(keys[0].encrypted_file_key) as Uint8Array,
    ) as Uint8Array
    expect(Array.from(opened)).toEqual(Array.from(BINARY_KEY))
  })
})
