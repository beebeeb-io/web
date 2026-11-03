/**
 * Review F12 (2275 L14/T5.6): a shared-index push accepts only an index whose
 * entries this client proved.
 *
 * The rule used to live in a comment: any `SharedSearchIndex` — including one
 * loaded from the server's shards — could be encrypted and PUT back, so a
 * hostile server could seed entries into the searchable index. The proof now
 * travels with the index and the push refuses without it.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L14: only a wrap that passes every check enters a written index.
 */
import { describe, expect, test } from 'bun:test'
import {
  SharedSearchIndex,
  UnverifiedSharedIndexError,
  pushSharedIndexDelta,
  pushSharedIndexFull,
} from '../src/lib/shared-folder-index'
import type { ShardCoord } from '../src/lib/shared-folder-index-shards'

const folderKey = new Uint8Array(32).fill(0x11)

function fakeProxy(onUpsert?: () => void): unknown {
  return {
    async upsert() {
      onUpsert?.()
      return [1]
    },
    async remove() {
      return [1]
    },
    async query() {
      return []
    },
    async fileCount() {
      return 1
    },
    async encryptShardsWithFolderKey() {
      return [{ bucket: 1, page: 0, blob: new Uint8Array([1, 2, 3]) }]
    },
    async encryptBucketsWithFolderKey(_key: Uint8Array, buckets: number[]) {
      return buckets.map((bucket) => ({ bucket, page: 0, blob: new Uint8Array([1, 2, 3]) }))
    },
    async dispose() {},
  }
}

const transport = () => ({
  listShards: async () => [],
  getShard: async (_coord: ShardCoord) => new Uint8Array([0]),
  putShard: async (shard: { bucket: number; page: number }) => ({
    bucket: shard.bucket,
    page: shard.page,
    version: 1,
  }),
})

describe('F12: a shared-index push enforces L14', () => {
  test('an index loaded from the server (no proof) is refused by delta and full push', async () => {
    const loaded = new SharedSearchIndex(fakeProxy() as never, 64)
    expect(loaded.l14Entries).toBeNull()

    await expect(
      pushSharedIndexDelta({ transport: transport(), index: loaded, folderKey, dirtyBuckets: [7] }),
    ).rejects.toBeInstanceOf(UnverifiedSharedIndexError)
    await expect(pushSharedIndexFull({ transport: transport(), index: loaded, folderKey })).rejects.toBeInstanceOf(
      UnverifiedSharedIndexError,
    )
  })

  test('an index proven by the L14 filter pushes normally', async () => {
    const proven = new SharedSearchIndex(fakeProxy() as never, 64, [{ fileId: 'a', name: 'a.pdf' }])
    expect(proven.l14Entries).toEqual([{ fileId: 'a', name: 'a.pdf' }])

    const delta = await pushSharedIndexDelta({ transport: transport(), index: proven, folderKey, dirtyBuckets: [7] })
    expect(delta).toEqual({ written: 1, conflicts: 0, dirtyBuckets: [] })
    const full = await pushSharedIndexFull({ transport: transport(), index: proven, folderKey })
    expect(full).toEqual({ written: 1 })
  })

  test('an upsert on an index with no proof is refused before it reaches the proxy', async () => {
    let upserts = 0
    const loaded = new SharedSearchIndex(fakeProxy(() => (upserts += 1)) as never, 64)
    await expect(loaded.upsert('a', 'a.pdf')).rejects.toBeInstanceOf(UnverifiedSharedIndexError)
    expect(upserts).toBe(0)
  })

  test('an upsert cannot inject an entry the L14 filter did not prove', async () => {
    let upserts = 0
    const proven = new SharedSearchIndex(fakeProxy(() => (upserts += 1)) as never, 64, [
      { fileId: 'a', name: 'a.pdf' },
    ])
    await expect(proven.upsert('evil', 'evil.pdf')).rejects.toBeInstanceOf(UnverifiedSharedIndexError)
    await expect(proven.upsert('a', 'renamed.pdf')).rejects.toBeInstanceOf(UnverifiedSharedIndexError)
    expect(upserts).toBe(0)

    // The entry the filter proved still upserts normally.
    await expect(proven.upsert('a', 'a.pdf')).resolves.toEqual([1])
    expect(upserts).toBe(1)
  })

  test('the proof is stamped only where the L14 filter assembled the index', async () => {
    const source = await Bun.file('src/lib/shared-folder-index.ts').text()
    // The loaded-from-server path passes no proof; the assembler passes `kept`.
    expect(source).toContain('new SharedSearchIndex(proxy, numShards, kept)')
    expect(source).toContain('assertL14Verified(args.index)')
  })
})
