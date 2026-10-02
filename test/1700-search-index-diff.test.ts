import { describe, expect, test } from 'bun:test'
import type { SyncNode } from '../src/lib/api'
import { applyIndexDiff, planIndexDiff, type IndexNameCacheEntry } from '../src/lib/search-index-diff'

/**
 * Task 1700 — reconcileFromTree used to upsert EVERY live node on every pass,
 * and core's upsert dirties a bucket unconditionally, so each foreign sync op
 * re-encrypted and re-PUT every search-index shard page. The plan must diff
 * names per node (ciphertext-keyed name cache) and the apply step must push
 * once, only when something changed.
 */

function node(id: string, overrides: Partial<SyncNode> = {}): SyncNode {
  return {
    id,
    name_encrypted: `cipher-${id}`,
    parent_id: null,
    is_folder: false,
    size_bytes: 1,
    mime_type: null,
    content_hash: null,
    version_number: 1,
    has_thumbnail: false,
    has_large_thumbnail: false,
    storage_pool_id: null,
    is_trashed: false,
    is_starred: false,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeIndex(bucketByFile: Record<string, number[]> = {}) {
  const pushes: number[][] = []
  const upserted: string[] = []
  const removed: string[] = []
  return {
    pushes,
    upserted,
    removed,
    target: {
      upsert: async (id: string) => {
        upserted.push(id)
        return bucketByFile[id] ?? []
      },
      remove: async (id: string) => {
        removed.push(id)
        return bucketByFile[id] ?? []
      },
      pushBuckets: async (_masterKey: Uint8Array, dirty: number[]) => {
        pushes.push([...dirty])
        return []
      },
    },
  }
}

const KEY = new Uint8Array(32)

describe('1700: planIndexDiff + applyIndexDiff', () => {
  test('T7 unchanged names → zero upserts, zero putShards (even after repeated passes)', async () => {
    const cachedNames = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a', name: 'alpha' }],
      ['b', { cipher: 'cipher-b', name: 'beta' }],
    ])
    const indexedIds = new Set(['a', 'b'])
    const nodes = [node('a'), node('b')]
    const resolved = new Map([['a', 'alpha'], ['b', 'beta']])

    const index = fakeIndex()
    for (let pass = 0; pass < 3; pass++) {
      const plan = planIndexDiff({ nodes, resolved, indexedIds, cachedNames })
      expect(plan.upserts).toEqual([])
      expect(plan.prunes).toEqual([])
      expect(await applyIndexDiff(index.target, KEY, plan)).toBe(0)
    }
    expect(index.pushes).toEqual([])
    expect(index.upserted).toEqual([])
    expect(index.removed).toEqual([])
  })

  test('T7 a rename upserts only the affected id and pushes only its bucket(s)', async () => {
    const cachedNames = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a', name: 'alpha' }],
      ['b', { cipher: 'cipher-b', name: 'beta' }],
    ])
    const indexedIds = new Set(['a', 'b'])
    // a was renamed (new ciphertext); b is untouched.
    const nodes = [node('a', { name_encrypted: 'cipher-a2' }), node('b')]
    const resolved = new Map([['a', 'alpha-renamed'], ['b', 'beta']])

    const plan = planIndexDiff({ nodes, resolved, indexedIds, cachedNames })
    expect(plan.upserts).toEqual([{ id: 'a', name: 'alpha-renamed' }])

    const index = fakeIndex({ a: [3] })
    const dirty = await applyIndexDiff(index.target, KEY, plan)
    expect(dirty).toBe(1)
    expect(index.pushes).toEqual([[3]])
    expect(index.upserted).toEqual(['a'])
  })

  test('a node missing from the index is upserted once; an unindexed trashed node is not pruned', async () => {
    const cachedNames = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a', name: 'alpha' }],
    ])
    const indexedIds = new Set(['a'])
    const nodes = [node('a'), node('new'), node('ghost', { is_trashed: true })]
    const resolved = new Map([['a', 'alpha'], ['new', 'new-name']])

    const plan = planIndexDiff({ nodes, resolved, indexedIds, cachedNames })
    expect(plan.upserts).toEqual([{ id: 'new', name: 'new-name' }])
    expect(plan.prunes).toEqual([])
  })

  test('a trashed node that was indexed is pruned', async () => {
    const indexedIds = new Set(['a', 'dead'])
    const nodes = [node('a'), node('dead', { is_trashed: true })]
    const resolved = new Map([['a', 'alpha']])
    const plan = planIndexDiff({ nodes, resolved, indexedIds, cachedNames: new Map() })
    expect(plan.prunes).toEqual(['dead'])

    const index = fakeIndex({ dead: [7] })
    await applyIndexDiff(index.target, KEY, plan)
    expect(index.removed).toEqual(['dead'])
    expect(index.pushes).toEqual([[7]])
  })

  test('an undecryptable node (no resolved name) is skipped, never upserted as a placeholder', async () => {
    const indexedIds = new Set<string>()
    const nodes = [node('a')]
    const plan = planIndexDiff({ nodes, resolved: new Map(), indexedIds, cachedNames: new Map() })
    expect(plan.upserts).toEqual([])
  })
})
