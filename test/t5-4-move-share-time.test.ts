/**
 * 2275 T5.4 (L15 option A): a move is a share-time event only when the move
 * picker showed the shared root R for the chosen destination, and every wrap
 * comes from the resolver — a plaintext-name row and a row whose name does not
 * authenticate are never sealed under a guessed derived key.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L15 (a): each item is wrapped with the key `resolve_owned_key` returns;
 *            request rows and plaintext-named items are skipped.
 *   L15 (b)3: the destination is R, shown to the user by this client.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { encodeEnvelope } from '../src/lib/metadata-envelope'

const wasm = loadWasm()
const encoder = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const DEST = '77777777-7777-4777-8777-777777777777'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const FOLDER_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []
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
await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  updateFile: async (id: string, body: { parent_id?: string | null }) => ({ id, parent_id: body.parent_id ?? null }),
  getSharedFolder: async (folderId: string) => {
    if (folderId !== ROOT) throw Object.assign(new Error('not found'), { status: 404 })
    return {
      folder_id: ROOT,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: (await import('../src/lib/crypto')).toBase64(wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => ({ id, parent_id: id === DEST ? ROOT : null }),
  getSentInvites: async () => [],
  listFilesPage: async () => ({ files: [], next_cursor: null }),
  publishSharedFolderKeys: async (root: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    published.push({ root, keys })
    return { written: keys.length, skipped: 0 }
  },
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

const { moveOwnerItems } = await import('../src/lib/owner-upload-key')
const { markCustodySeen, resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')

/** The name an owner item really carries: its metadata sealed under its derived key. */
function nameOf(id: string): string {
  const key = wasm.derive_file_key(MASTER, encoder.encode(id)) as Uint8Array
  const meta = wasm.encrypt_metadata(key, JSON.stringify({ name: `${id}.pdf`, mime_type: null })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return encodeEnvelope(wasm, meta.nonce, meta.ciphertext)
}

beforeEach(() => {
  flagOn = true
  published.length = 0
  clearSharedFolderLookups()
  resetCustodyMemoryForTests()
})

describe('T5.4: moveOwnerItems publishes only what the picker showed and the resolver proves', () => {
  test('a move into R the picker showed seals the resolver key of each moved row', async () => {
    markCustodySeen(ROOT)
    await moveOwnerItems({
      ids: [FILE_ID, FOLDER_ID],
      destinationId: DEST,
      rows: [
        { id: FILE_ID, is_folder: false, name_encrypted: nameOf(FILE_ID) },
        { id: FOLDER_ID, is_folder: true, name_encrypted: nameOf(FOLDER_ID) },
      ],
      masterKey: MASTER,
      viewerId: 'owner-user',
    })
    const keys = published.flatMap((p) => p.keys)
    expect(published.every((p) => p.root === ROOT)).toBe(true)
    expect(keys.map((k) => k.file_id).sort()).toEqual([FILE_ID, FOLDER_ID].sort())
    for (const { file_id, encrypted_file_key } of keys) {
      const kind = file_id === FOLDER_ID ? 2 : 1
      const opened = wasm.unwrapFolderChild(
        FOLDER_KEY,
        ROOT,
        file_id,
        kind,
        (await import('../src/lib/crypto')).fromBase64(encrypted_file_key) as Uint8Array,
      ) as Uint8Array
      expect(Array.from(opened)).toEqual(Array.from(wasm.derive_file_key(MASTER, encoder.encode(file_id)) as Uint8Array))
    }
  })

  test('no custody proof for R (the picker never showed it): the move publishes nothing', async () => {
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, name_encrypted: nameOf(FILE_ID) }],
      masterKey: MASTER,
      viewerId: 'owner-user',
    })
    expect(published).toEqual([])
  })

  test('an explicit picker answer wins: the picker showed R publishes, an explicit null does not', async () => {
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, name_encrypted: nameOf(FILE_ID) }],
      masterKey: MASTER,
      viewerId: 'owner-user',
      pickerRootId: ROOT,
    })
    expect(published.flatMap((p) => p.keys).map((k) => k.file_id)).toEqual([FILE_ID])

    published.length = 0
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, name_encrypted: nameOf(FILE_ID) }],
      masterKey: MASTER,
      viewerId: 'owner-user',
      pickerRootId: null,
    })
    expect(published).toEqual([])
  })

  test('a plaintext-named row is shown but never sealed under a guessed derived key', async () => {
    markCustodySeen(ROOT)
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, name_encrypted: 'notes.pdf' }],
      masterKey: MASTER,
      viewerId: 'owner-user',
    })
    expect(published).toEqual([])
  })

  test('a row whose name does not authenticate under its derived key is skipped, not guessed', async () => {
    markCustodySeen(ROOT)
    await moveOwnerItems({
      ids: [FILE_ID],
      destinationId: DEST,
      rows: [{ id: FILE_ID, name_encrypted: nameOf(FOLDER_ID) }],
      masterKey: MASTER,
      viewerId: 'owner-user',
    })
    expect(published).toEqual([])
  })
})
