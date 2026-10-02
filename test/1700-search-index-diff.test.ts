import { describe, expect, test } from 'bun:test'
import type { SyncNode } from '../src/lib/api'
import { applyIndexDiff, createRemoveCoalescer, planIndexDiff, type IndexNameCacheEntry } from '../src/lib/search-index-diff'

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
      expect(await applyIndexDiff(index.target, KEY, plan)).toEqual({ dirtyCount: 0, pushed: true })
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
    const result = await applyIndexDiff(index.target, KEY, plan)
    expect(result).toEqual({ dirtyCount: 1, pushed: true })
    expect(index.pushes).toEqual([[3]])
    expect(index.upserted).toEqual(['a'])
  })

  test('a node missing from the index is upserted once; a trashed node is pruned even when never indexed this session', async () => {
    const cachedNames = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a', name: 'alpha' }],
    ])
    const indexedIds = new Set(['a'])
    const nodes = [node('a'), node('new'), node('ghost', { is_trashed: true })]
    const resolved = new Map([['a', 'alpha'], ['new', 'new-name']])

    const plan = planIndexDiff({ nodes, resolved, indexedIds, cachedNames })
    expect(plan.upserts).toEqual([{ id: 'new', name: 'new-name' }])
    // PR #130 review: indexedIds is session-local; a node trashed while this
    // client was offline still sits in the loaded server index and must be
    // removed. remove(missing) is a no-op, so pruning is always safe.
    expect(plan.prunes).toEqual(['ghost'])
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

/**
 * PR #130 review round 4 — a failed shard push must stay dirty (retry), and
 * trashed/absent snapshot ids must prune regardless of session-local tracking.
 */
describe('1700 round-4 (PR #130): push failure + shard-loaded prunes', () => {
  test('R4-2 a failed push reports pushed:false and leaves the diff retryable', async () => {
    const cachedNames = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a', name: 'alpha' }],
    ])
    const indexedIds = new Set(['a'])
    const nodes = [node('a', { name_encrypted: 'cipher-a2' })]
    const resolved = new Map([['a', 'alpha-renamed']])
    const planFor = () => planIndexDiff({ nodes, resolved, indexedIds, cachedNames })
    expect(planFor().upserts).toEqual([{ id: 'a', name: 'alpha-renamed' }])

    const index = fakeIndex({ a: [3] })
    let failNext = true
    const flaky = {
      ...index.target,
      pushBuckets: async (masterKey: Uint8Array, dirty: number[]) => {
        if (failNext) {
          failNext = false
          throw new Error('transient shard failure')
        }
        return index.target.pushBuckets(masterKey, dirty)
      },
    }

    // First push fails: callers must NOT update their caches.
    const first = await applyIndexDiff(flaky, KEY, planFor())
    expect(first).toEqual({ dirtyCount: 1, pushed: false })

    // Because the caller kept its caches dirty, the same diff is produced and
    // retried on the next pass (no unrelated mutation required).
    expect(planFor().upserts).toEqual([{ id: 'a', name: 'alpha-renamed' }])
    const second = await applyIndexDiff(index.target, KEY, planFor())
    expect(second).toEqual({ dirtyCount: 1, pushed: true })
    expect(index.pushes).toEqual([[3]])

    // After the caller records the success, an unchanged pass is clean.
    const updatedCache = new Map<string, IndexNameCacheEntry>([
      ['a', { cipher: 'cipher-a2', name: 'alpha-renamed' }],
    ])
    const updatedIndexed = new Set(['a'])
    const cleanPlan = planIndexDiff({
      nodes,
      resolved,
      indexedIds: updatedIndexed,
      cachedNames: updatedCache,
    })
    expect(cleanPlan.upserts).toEqual([])
    const third = await applyIndexDiff(index.target, KEY, cleanPlan)
    expect(third).toEqual({ dirtyCount: 0, pushed: true })
    expect(index.pushes.length).toBe(1)
  })

  test('R4-3 a trashed node loaded from shards is pruned without session-local membership', async () => {
    const plan = planIndexDiff({
      nodes: [node('x', { is_trashed: true }), node('a')],
      resolved: new Map([['a', 'alpha']]),
      indexedIds: new Set(['a']), // x was never written this session
      cachedNames: new Map([['a', { cipher: 'cipher-a', name: 'alpha' }]]),
    })
    expect(plan.prunes).toEqual(['x'])

    const index = fakeIndex({ x: [9] })
    const result = await applyIndexDiff(index.target, KEY, plan)
    expect(result).toEqual({ dirtyCount: 1, pushed: true })
    expect(index.removed).toEqual(['x'])
    expect(index.pushes).toEqual([[9]])
  })
})

/**
 * Review finding S3 — per-event `unindexFile` called remove+pushBuckets for
 * every foreign delete/trash event, so a bulk delete storm re-encrypted and
 * PUT shard pages per event. The coalescer collects ids in a window and the
 * single applyIndexDiff call pushes once.
 */
describe('1700 review S3: delete coalescing', () => {
  test('N deletes inside one window → exactly one putShards with the affected buckets', async () => {
    const index = fakeIndex({ a: [1], b: [2], c: [3] })
    let latest: (() => void) | null = null
    let scheduleCalls = 0
    const coalescer = createRemoveCoalescer({
      windowMs: 1500,
      onFlush: (ids) => {
        void applyIndexDiff(index.target, KEY, { upserts: [], prunes: ids })
      },
      schedule: (fn) => {
        scheduleCalls += 1
        latest = fn
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clear: () => {},
    })

    coalescer.add('a')
    coalescer.add('b')
    coalescer.add('c')
    expect(coalescer.pendingCount()).toBe(3)
    expect(index.pushes).toEqual([]) // nothing pushed before the window closes

    latest?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(index.removed).toEqual(['a', 'b', 'c'])
    expect(index.pushes.length).toBe(1)
    expect(index.pushes[0]).toEqual([1, 2, 3])
    expect(scheduleCalls).toBe(3)
    expect(coalescer.pendingCount()).toBe(0)
  })

  test('a delete arriving after the flush opens a new window (second push)', async () => {
    const index = fakeIndex({ a: [1], d: [4] })
    let latest: (() => void) | null = null
    const coalescer = createRemoveCoalescer({
      windowMs: 1500,
      onFlush: (ids) => {
        void applyIndexDiff(index.target, KEY, { upserts: [], prunes: ids })
      },
      schedule: (fn) => {
        latest = fn
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clear: () => {},
    })

    coalescer.add('a')
    latest?.()
    await new Promise((r) => setTimeout(r, 0))
    coalescer.add('d')
    latest?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(index.pushes).toEqual([[1], [4]])
  })

  test('with real timers the window batches and fires once', async () => {
    const index = fakeIndex({ x: [5], y: [6] })
    const flushes: string[][] = []
    const coalescer = createRemoveCoalescer({
      windowMs: 20,
      onFlush: (ids) => {
        flushes.push(ids)
        void applyIndexDiff(index.target, KEY, { upserts: [], prunes: ids })
      },
    })
    coalescer.add('x')
    await new Promise((r) => setTimeout(r, 5))
    coalescer.add('y')
    await new Promise((r) => setTimeout(r, 60))
    expect(flushes).toEqual([['x', 'y']])
    expect(index.pushes).toEqual([[5, 6]])
  })
})
