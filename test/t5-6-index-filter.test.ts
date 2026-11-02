/**
 * 2275 T5.6 / L14 — the shared-folder search index is written only from rows
 * that pass all four checks: R's inventory has a wrap, the wrap matches the
 * resolver's key under R's proven custody key (core, constant time), and the
 * name authenticates. Request rows and plaintext names are never indexed; a
 * failing row is skipped and counted.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const ROOT = '11111111-1111-4111-8111-111111111111'
const GOOD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PLAINTEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NO_WRAP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const BAD_NAME = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const UNPROVEN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const MISMATCH = '99999999-9999-4999-8999-999999999999'

const KEY = new Uint8Array([1, 2, 3])
const WRAP = new Uint8Array([9, 9, 9])

await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (real) => ({
  ...real,
  ownedItem: {
    ...(real.ownedItem as object),
    async resolve(args: {
      itemId: string
      nameEncrypted: string
      folderWrap?: Uint8Array | null
    }) {
      if (args.itemId === BAD_NAME) throw new Error('name did not authenticate')
      const origin = args.itemId === UNPROVEN ? 'derived_binary' : 'derived'
      return {
        key: Uint8Array.from(KEY),
        contentKey: null,
        origin,
        name: { name: `name-${args.itemId}` },
        writeTarget: null,
      }
    },
    async childWrapMatches(_folderKey: Uint8Array, _root: string, itemId: string) {
      return itemId !== MISMATCH
    },
  },
}))

const { filterIndexRowsForSharing } = await import('../src/lib/shared-index-writer')

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  createSharedSearchIndex: async (entries: { fileId: string; name: string }[]) => ({
    async upsert() { return [0] },
    async remove() { return [0] },
    async query() { return [] },
    async fileCount() { return entries.length },
    async encryptBucketsWithFolderKey() { return [] },
    async encryptShardsWithFolderKey() { return [] },
    async dispose() {},
  }),
})

const { rebuildSharedIndexFromListing } = await import('../src/lib/shared-folder-index')

const rows = [
  { id: GOOD, nameEncrypted: '{"nonce":"n","ciphertext":"c"}' },
  { id: REQUEST, nameEncrypted: '{"nonce":"n","ciphertext":"c"}', fileRequestId: 'r1' },
  { id: PLAINTEXT, nameEncrypted: 'notes.pdf' },
  { id: NO_WRAP, nameEncrypted: '{"nonce":"n","ciphertext":"c"}' },
  { id: BAD_NAME, nameEncrypted: '{"nonce":"n","ciphertext":"c"}' },
  { id: UNPROVEN, nameEncrypted: '{"nonce":"n","ciphertext":"c"}' },
  { id: MISMATCH, nameEncrypted: '{"nonce":"n","ciphertext":"c"}' },
]
const wraps = new Map<string, Uint8Array>(
  [GOOD, REQUEST, BAD_NAME, UNPROVEN, MISMATCH].map((id) => [id, WRAP]),
)

const args = { rows, rootId: ROOT, folderKey: KEY, masterKey: new Uint8Array([7]), wraps }

describe('T5.6 L14 index filter', () => {
  test('keeps only the row that passes all four checks', async () => {
    const result = await filterIndexRowsForSharing(args)
    expect(result.entries).toEqual([{ fileId: GOOD, name: `name-${GOOD}` }])
  })

  test('counts every refusal by reason', async () => {
    const { skipped } = await filterIndexRowsForSharing(args)
    expect(skipped.requestRow).toBe(1)
    expect(skipped.plaintextName).toBe(1)
    expect(skipped.noWrap).toBe(1)
    expect(skipped.unproven).toBe(3)
  })

  test('the listing writer indexes nothing that failed the filter', async () => {
    const built = await rebuildSharedIndexFromListing(args)
    expect(built.fileCount).toBe(1)
    expect(built.entries.map((e) => e.fileId)).toEqual([GOOD])
    expect(built.truncated).toBe(false)
  })

  test('a request row and a plaintext name never reach the resolver', async () => {
    const result = await filterIndexRowsForSharing({
      ...args,
      rows: rows.filter((r) => r.id === REQUEST || r.id === PLAINTEXT),
    })
    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual({ requestRow: 1, plaintextName: 1, noWrap: 0, unproven: 0 })
  })
})
