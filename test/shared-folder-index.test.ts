/**
 * Task 2237b — shared-folder search index client.
 *
 * The crypto surface is mocked (the wasm worker is not loaded in unit tests);
 * the interesting contracts are the 20,000 bound, the retry loop and the
 * client-side shard guards.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { IndexTransport, ShardCoord, ShardRef } from '../src/lib/shared-folder-index-shards'

let proxyFileCount = 0
let queryResult: string[] = []
let batchRejects = false

function fakeProxy() {
  return {
    async upsert() {
      return [0]
    },
    async remove() {
      return [0]
    },
    async query() {
      return queryResult
    },
    async fileCount() {
      return proxyFileCount
    },
    async encryptBucketsWithFolderKey(_key: Uint8Array, buckets: number[]) {
      return buckets.map((bucket) => ({ bucket, page: 0, blob: new Uint8Array([bucket & 0xff]) }))
    },
    async encryptShardsWithFolderKey() {
      return []
    },
    async dispose() {},
  }
}

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  createSharedSearchIndex: async () => fakeProxy(),
  sharedSearchIndexFromShards: async (_key: Uint8Array, shards: { blob: Uint8Array }[]) => {
    if (batchRejects || shards.some((shard) => shard.blob[0] === 0xff)) {
      throw new Error('page decrypt failed')
    }
    return fakeProxy()
  },
})

const {
  SEARCH_INDEX_MAX_ENTRIES,
  SharedSearchIndex,
  loadSharedIndex,
  pushSharedIndexDelta,
  rebuildSharedIndexFromListing,
} = await import('../src/lib/shared-folder-index')
const { publicIndexTransport, ownerIndexTransport, IndexVersionConflictError } = await import(
  '../src/lib/shared-folder-index-shards'
)

const folderKey = new Uint8Array(32).fill(3)

function transportWith(overrides: Partial<IndexTransport> = {}): IndexTransport {
  return {
    listShards: async () => [],
    getShard: async () => null,
    putShard: async (shard) => ({ bucket: shard.bucket, page: shard.page, version: 1 }),
    deleteShard: async () => {},
    ...overrides,
  }
}

beforeEach(() => {
  proxyFileCount = 0
  queryResult = []
  batchRejects = false
})

describe('loadSharedIndex', () => {
  test('an empty manifest yields an empty, untruncated index', async () => {
    proxyFileCount = 0
    const result = await loadSharedIndex({ transport: transportWith(), folderKey })
    expect(result.fileCount).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('20,000 entries is not truncated; 20,001 is', async () => {
    proxyFileCount = SEARCH_INDEX_MAX_ENTRIES
    const atBound = await loadSharedIndex({
      transport: transportWith({
        listShards: async () => [{ bucket: 1, page: 0, version: 1 }],
        getShard: async () => new Uint8Array([1]),
      }),
      folderKey,
    })
    expect(atBound.truncated).toBe(false)

    proxyFileCount = SEARCH_INDEX_MAX_ENTRIES + 1
    const overBound = await loadSharedIndex({
      transport: transportWith({
        listShards: async () => [{ bucket: 1, page: 0, version: 1 }],
        getShard: async () => new Uint8Array([1]),
      }),
      folderKey,
    })
    expect(overBound.truncated).toBe(true)
  })

  test('a page that fails to decrypt is skipped, not fatal', async () => {
    proxyFileCount = 5
    const result = await loadSharedIndex({
      transport: transportWith({
        listShards: async () => [
          { bucket: 1, page: 0, version: 1 },
          { bucket: 2, page: 0, version: 1 },
        ],
        getShard: async (coord) =>
          coord.bucket === 2 ? new Uint8Array([0xff]) : new Uint8Array([1]),
      }),
      folderKey,
    })
    expect(result.fileCount).toBe(5)
    expect(result.skippedPages).toBe(1)
  })
})

describe('pushSharedIndexDelta', () => {
  test('a new page is written with if_version 0', async () => {
    const sends: { coord: ShardCoord; ifVersion: number }[] = []
    const index = new SharedSearchIndex(fakeProxy() as never, 64)
    const result = await pushSharedIndexDelta({
      transport: transportWith({
        putShard: async (shard, ifVersion) => {
          sends.push({ coord: { bucket: shard.bucket, page: shard.page }, ifVersion })
          return { bucket: shard.bucket, page: shard.page, version: 1 }
        },
      }),
      index,
      folderKey,
      dirtyBuckets: [7],
    })

    expect(result).toEqual({ written: 1, conflicts: 0, dirtyBuckets: [] })
    expect(sends).toEqual([{ coord: { bucket: 7, page: 0 }, ifVersion: 0 }])
  })

  test('one conflict is retried with the server version and then succeeds', async () => {
    let calls = 0
    const result = await pushSharedIndexDelta({
      transport: transportWith({
        putShard: async (shard) => {
          calls += 1
          if (calls === 1) throw new IndexVersionConflictError(4)
          return { bucket: shard.bucket, page: shard.page, version: 5 }
        },
      }),
      index: new SharedSearchIndex(fakeProxy() as never, 64),
      folderKey,
      dirtyBuckets: [2],
    })

    expect(result).toEqual({ written: 1, conflicts: 1, dirtyBuckets: [] })
  })

  test('three conflicts stop and leave the bucket dirty', async () => {
    let calls = 0
    const result = await pushSharedIndexDelta({
      transport: transportWith({
        putShard: async () => {
          calls += 1
          throw new IndexVersionConflictError(9)
        },
      }),
      index: new SharedSearchIndex(fakeProxy() as never, 64),
      folderKey,
      dirtyBuckets: [5],
    })

    expect(calls).toBe(3)
    expect(result).toEqual({ written: 0, conflicts: 3, dirtyBuckets: [5] })
  })
})

describe('rebuildSharedIndexFromListing', () => {
  test('stops at the bound and reports the overflow', async () => {
    const entries = Array.from({ length: SEARCH_INDEX_MAX_ENTRIES + 1 }, (_, i) => ({
      fileId: `id-${i}`,
      name: `name-${i}`,
    }))
    const result = await rebuildSharedIndexFromListing({ entries })
    expect(result.truncated).toBe(true)
  })

  test('a listing at the bound is not truncated', async () => {
    const entries = Array.from({ length: SEARCH_INDEX_MAX_ENTRIES }, (_, i) => ({
      fileId: `id-${i}`,
      name: `name-${i}`,
    }))
    const result = await rebuildSharedIndexFromListing({ entries })
    expect(result.truncated).toBe(false)
  })
})

describe('transports', () => {
  let requests: { url: string; init: RequestInit }[] = []

  beforeEach(() => {
    requests = []
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      requests.push({ url: String(url), init })
      if (init.method === 'PUT') {
        return new Response(JSON.stringify({ bucket: 0, page: 0, version: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify({ shards: [] }), { status: 200 })
    }) as unknown as typeof fetch
  })

  test('rejects an out-of-range coordinate before any request', async () => {
    const transport = publicIndexTransport('tok', null)
    await expect(transport.getShard({ bucket: 64, page: 0 })).rejects.toThrow(
      'bucket must be in 0..64',
    )
    await expect(transport.putShard({ bucket: 0, page: 16, blob: new Uint8Array([1]) }, 0)).rejects.toThrow(
      'page must be in 0..16',
    )
    expect(requests.length).toBe(0)
  })

  test('the public transport carries the proof header and if_version', async () => {
    const transport = publicIndexTransport('tok', { token: 'tok', proof: 'p1', expiresAt: Date.now() + 1000 })
    await transport.putShard({ bucket: 3, page: 2, blob: new Uint8Array([1, 2]) }, 7)

    expect(requests.length).toBe(1)
    expect(requests[0].url).toContain('/api/v1/f/tok/search-index/shards/3/2?if_version=7')
    expect((requests[0].init.headers as Record<string, string>)['x-folder-link-proof']).toBe('p1')
  })

  test('the owner transport addresses the shared-folder route', async () => {
    const transport = ownerIndexTransport('folder-1')
    await transport.listShards()
    expect(requests[0].url).toContain('/api/v1/shared-folders/folder-1/search-index/shards')
  })

  test('the public transport refuses a blob over the cap before sending', async () => {
    const transport = publicIndexTransport('tok', null)
    await expect(
      transport.putShard({ bucket: 0, page: 0, blob: new Uint8Array(163_841) }, 0),
    ).rejects.toThrow('exceeds')
    expect(requests.length).toBe(0)
  })
})

export type { ShardRef }
