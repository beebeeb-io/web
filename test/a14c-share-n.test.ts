/**
 * 2275 A14c: "Share N items with this folder".
 *
 * The owner confirms a selection; exactly the confirmed items are wrapped with
 * keys from the resolver, request rows and plaintext-named items are refused,
 * and the confirm publishes only what was shown (no re-list).
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
const SUB = '99999999-9999-4999-8999-999999999999'
const SHAREABLE = '22222222-2222-4222-8222-222222222222'
const ALREADY = '33333333-3333-4333-8333-333333333333'
const PLAIN = '44444444-4444-4444-8444-444444444444'
const REQUEST = '55555555-5555-4555-8555-555555555555'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []
let listCalls = 0
let inventory: { file_id: string; encrypted_file_key: string }[] = []
let tree: Record<string, Record<string, unknown>[]> = {}

function nameOf(id: string, name: string): string {
  const key = wasm.derive_file_key(MASTER, encoder.encode(id)) as Uint8Array
  const meta = wasm.encrypt_metadata(key, JSON.stringify({ name, mime_type: null })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return encodeEnvelope(wasm, meta.nonce, meta.ciphertext)
}

await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, encoder.encode(id)),
}))
await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  listFilesPage: async (opts: { parentId?: string }) => {
    listCalls += 1
    return { files: tree[opts.parentId ?? ''] ?? [], next_cursor: null }
  },
  publishSharedFolderKeys: async (root: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    published.push({ root, keys })
    return { written: keys.length, skipped: 0 }
  },
}))
await mockModuleScoped('../src/lib/api-folder-links', import.meta.dir, () => ({
  listSharedFolderKeys: async () => ({ keys: inventory, next_cursor: null }),
}))
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
      nameEncrypted: string
      sharedFolderId?: string | null
      folderKey?: Uint8Array | null
    }) {
      const v = wasm.resolveOwnedKey(
        args.masterKey,
        args.itemId,
        args.kind,
        null,
        args.nameEncrypted,
        args.sharedFolderId ?? null,
        args.folderKey ?? null,
        null,
        null,
      ) as Record<string, unknown>
      return {
        key: v.key as Uint8Array,
        contentKey: (v.contentKey as Uint8Array | null) ?? null,
        origin: v.origin as never,
        name: (v.name as never) ?? null,
        writeTarget: (v.writeTarget as never) ?? null,
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

const { collectShareCandidates, publishShareCandidates, cannotShareReason } = await import('../src/lib/share-missing-items')
const { fromBase64, toBase64 } = await import('../src/lib/crypto')

beforeEach(() => {
  published.length = 0
  listCalls = 0
  const alreadyKey = wasm.derive_file_key(MASTER, encoder.encode(ALREADY)) as Uint8Array
  inventory = [
    {
      file_id: ALREADY,
      encrypted_file_key: toBase64(wasm.wrapFolderChild(FOLDER_KEY, ROOT, ALREADY, 1, alreadyKey) as Uint8Array),
    },
  ]
  tree = {
    [ROOT]: [
      { id: SHAREABLE, is_folder: false, name_encrypted: nameOf(SHAREABLE, 'holiday.pdf'), file_request_id: null },
      { id: ALREADY, is_folder: false, name_encrypted: nameOf(ALREADY, 'shared.pdf'), file_request_id: null },
      { id: PLAIN, is_folder: false, name_encrypted: 'plain.pdf', file_request_id: null },
      { id: REQUEST, is_folder: false, name_encrypted: nameOf(REQUEST, 'incoming.pdf'), file_request_id: 'req-1' },
      { id: SUB, is_folder: true, name_encrypted: nameOf(SUB, 'Family'), file_request_id: null },
    ],
    [SUB]: [{ id: '66666666-6666-4666-8666-666666666666', is_folder: false, name_encrypted: nameOf('66666666-6666-4666-8666-666666666666', 'deep.pdf'), file_request_id: null }],
  }
})

describe('A14c: Share N items with this folder', () => {
  test('lists what R holds by decrypted name and path; request and plaintext rows are shown as can\'t be shared', async () => {
    const { candidates, shareable } = await collectShareCandidates({ rootId: ROOT, masterKey: MASTER, folderKey: FOLDER_KEY })
    const byId = new Map(candidates.map((c) => [c.id, c]))
    expect(byId.get(SHAREABLE)?.status).toBe('shareable')
    expect(byId.get(SHAREABLE)?.name).toBe('holiday.pdf')
    expect(byId.get(ALREADY)?.status).toBe('already_shared')
    expect(byId.get(PLAIN)?.status).toBe('plaintext_name')
    expect(cannotShareReason('plaintext_name')).toContain("can't be shared")
    expect(byId.get(REQUEST)?.status).toBe('request_row')
    expect(cannotShareReason('request_row')).toContain("can't be shared")
    const deep = byId.get('66666666-6666-4666-8666-666666666666')
    expect(deep?.path).toEqual(['Family'])
    expect(deep?.name).toBe('deep.pdf')
    expect(shareable.map((c) => c.id).sort()).toEqual(
      [SHAREABLE, SUB, '66666666-6666-4666-8666-666666666666'].sort(),
    )
  })

  test('confirms exactly the selection, deduplicated, from resolver keys, with no re-list', async () => {
    const { candidates, shareable } = await collectShareCandidates({ rootId: ROOT, masterKey: MASTER, folderKey: FOLDER_KEY })
    const request = candidates.find((c) => c.id === REQUEST)!
    const plain = candidates.find((c) => c.id === PLAIN)!
    const callsBeforeConfirm = listCalls
    const { written } = await publishShareCandidates({
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      confirmed: [...shareable, shareable[0], request, plain],
    })
    expect(written).toBe(3)
    expect(listCalls).toBe(callsBeforeConfirm)
    const keys = published.flatMap((p) => p.keys)
    expect(keys.map((k) => k.file_id).sort()).toEqual(
      [SHAREABLE, SUB, '66666666-6666-4666-8666-666666666666'].sort(),
    )
    for (const { file_id, encrypted_file_key } of keys) {
      const kind = file_id === SUB ? 2 : 1
      const opened = wasm.unwrapFolderChild(FOLDER_KEY, ROOT, file_id, kind, fromBase64(encrypted_file_key) as Uint8Array) as Uint8Array
      expect(Array.from(opened)).toEqual(Array.from(wasm.derive_file_key(MASTER, encoder.encode(file_id)) as Uint8Array))
    }
  })
})
