import { describe, expect, test } from 'bun:test'

/**
 * W-P2-3 — the three collaborators the sync client was split into must behave
 * exactly as the single class did: the same backoff schedules, the same
 * pending-op bookkeeping (confirm by identity, two writes to one file are two
 * ops), and the same error kind out of the transport.
 */

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

const { mockModuleScoped } = await import('./helpers/scoped-module-mock')

// Mutable behaviour the mocked api module delegates to, set per test.
let opsImpl: () => Promise<unknown> = async () => []
let submitImpl: () => Promise<unknown> = async () => ({ applied: [], rejected: [] })

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSyncOps: () => opsImpl(),
  submitSyncOps: () => submitImpl(),
})

const { COVERAGE_RESYNC_BACKOFF, GAP_FILL_BACKOFF, RECONNECT_BACKOFF, SyncBackoff } = await import(
  '../src/lib/sync/backoff'
)
const { SyncQueue, hasRecordedPosition } = await import('../src/lib/sync/queue')
const { SYNC_REQUEST_TIMEOUT_MS, SyncTransport } = await import('../src/lib/sync/transport')
const PENDING_OPS_KEY = 'bb_sync_pending_ops'

/** The delays one policy produces, in order, `n` times. */
function schedule(policy: typeof RECONNECT_BACKOFF, n: number): number[] {
  const backoff = new SyncBackoff(policy)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(backoff.next())
  return out
}

describe('SyncBackoff', () => {
  test('the reconnect policy doubles 1.5s up to 30s, exactly as before', () => {
    expect(schedule(RECONNECT_BACKOFF, 8)).toEqual([
      1500, 3000, 6000, 12000, 24000, 30000, 30000, 30000,
    ])
  })

  test('the gap-fill policy doubles 30ms up to 5s', () => {
    expect(schedule(GAP_FILL_BACKOFF, 10)).toEqual([
      30, 60, 120, 240, 480, 960, 1920, 3840, 5000, 5000,
    ])
  })

  test('the coverage-resync policy doubles 100ms up to 10s', () => {
    expect(schedule(COVERAGE_RESYNC_BACKOFF, 9)).toEqual([
      100, 200, 400, 800, 1600, 3200, 6400, 10000, 10000,
    ])
  })

  test('peek does not consume an attempt, reset returns to the base delay', () => {
    const backoff = new SyncBackoff(RECONNECT_BACKOFF)
    expect(backoff.peek()).toBe(1500)
    expect(backoff.peek()).toBe(1500)
    expect(backoff.failedAttempts).toBe(0)
    backoff.next()
    backoff.next()
    expect(backoff.failedAttempts).toBe(2)
    expect(backoff.peek()).toBe(6000)
    backoff.reset()
    expect(backoff.failedAttempts).toBe(0)
    expect(backoff.next()).toBe(1500)
  })
})

describe('SyncQueue', () => {
  function freshQueue(bootSeq = 0): InstanceType<typeof SyncQueue> {
    localStorage.clear()
    return new SyncQueue(bootSeq)
  }

  function op(clientOpId: string, targetId?: string) {
    return {
      client_op_id: clientOpId,
      op_type: 'file.update',
      payload: { name_encrypted: 'x' },
      target_id: targetId,
    }
  }

  test('two writes to the same file stay two ops (no coalescing, same as main)', () => {
    const queue = freshQueue()
    queue.add(op('c1', 'file-a'))
    queue.add(op('c2', 'file-a'))
    expect(queue.ops.map((p) => p.client_op_id)).toEqual(['c1', 'c2'])
    expect(queue.size).toBe(2)
  })

  test('add persists, and a reloaded queue keeps the entries', () => {
    const queue = freshQueue()
    queue.add(op('c1', 'file-a'))
    expect(localStorage.getItem(PENDING_OPS_KEY)).toContain('c1')
    const reloaded = new SyncQueue(0)
    expect(reloaded.ops.map((p) => p.client_op_id)).toEqual(['c1'])
  })

  test('confirm clears only the matching client_op_id and persists the rest', () => {
    const queue = freshQueue()
    queue.add(op('c1', 'file-a'))
    queue.add(op('c2', 'file-a'))
    expect(queue.confirm('c2')).toBe(true)
    expect(queue.ops.map((p) => p.client_op_id)).toEqual(['c1'])
    expect(queue.confirm('c2')).toBe(false)
    expect(queue.confirm(null)).toBe(false)
    expect(JSON.parse(localStorage.getItem(PENDING_OPS_KEY) ?? '[]')).toHaveLength(1)
  })

  test('remove returns the entry for rollback and leaves the queue without it', () => {
    const queue = freshQueue()
    queue.add(op('c1', 'file-a'))
    const removed = queue.remove('c1')
    expect(removed?.target_id).toBe('file-a')
    expect(queue.size).toBe(0)
    expect(queue.remove('c1')).toBeNull()
  })

  test('an entry with no recorded position is resubmitted; a covered one is cleared by a snapshot', () => {
    const queue = freshQueue()
    queue.add(op('c1', 'file-a'))
    queue.add(op('c2', 'file-b'))
    queue.recordPosition('c2', 7, null)
    expect(queue.unsent().map((p) => p.client_op_id)).toEqual(['c1'])
    expect(hasRecordedPosition(queue.find('c2')!)).toBe(true)
    queue.confirmCoveredBy({ seq_id: 7, nodes: [] })
    expect(queue.ops.map((p) => p.client_op_id)).toEqual(['c1'])
  })

  test('an entry loaded without a position is an orphan candidate', () => {
    localStorage.clear()
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify([op('c1', 'file-a')]))
    const queue = new SyncQueue(11)
    expect(queue.hasOrphans).toBe(true)
    expect(queue.orphanCandidates().map((p) => p.client_op_id)).toEqual(['c1'])
    expect(queue.orphanLookupFloor(queue.orphanCandidates())).toBe(11)
    queue.markOrphaned('c1')
    queue.clearOrphans()
    expect(queue.hasOrphans).toBe(false)
  })
})

describe('SyncTransport', () => {
  test('a request that never answers rejects with the same Error as before', async () => {
    opsImpl = () => new Promise(() => {})
    const transport = new SyncTransport()
    const failure = await transport.opsSince(0, 25).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('sync request timed out after 25ms')
  })

  test('a request that answers passes the value through', async () => {
    opsImpl = async () => [{ seq_id: 3, op_type: 'file.update', payload: {}, created_at: '' }]
    const transport = new SyncTransport()
    expect(await transport.opsSince(0)).toHaveLength(1)
  })

  test('a server rejection surfaces unchanged (same error kind)', async () => {
    const apiError = Object.assign(new Error('conflict'), { name: 'ApiError', status: 409 })
    submitImpl = async () => {
      throw apiError
    }
    const transport = new SyncTransport()
    const failure = await transport.submit([]).catch((err: unknown) => err)
    expect(failure).toBe(apiError)
  })

  test('the default request bound is the 10s gap-fill bound', () => {
    expect(SYNC_REQUEST_TIMEOUT_MS).toBe(10_000)
  })
})
