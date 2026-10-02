import { beforeEach, describe, expect, test } from 'bun:test'
import type { SyncNode, SyncOp, SyncSnapshot } from '../src/lib/api'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1700 review (2026-10-02) — B1 (boot catch-up must not replay a stale
 * op page over the fresh snapshot) and S1 (snapshot merges single-flighted,
 * post-snapshot ops not overwritten, hung fetches time out and retry).
 * Behavioral tests on the real SyncClient with injected API responses.
 *
 * Every test stops its client in a `finally`: an assertion failure must not
 * leak a live client into the next test, because leftover async loops invoke
 * the shared module-level api mocks and can make a genuinely-red test look
 * green (observed during the red capture).
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

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((msg: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void {}
}
;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource

let syncOpsImpl: (since: number) => Promise<SyncOp[]> = async () => []
let snapshotImpl: () => Promise<SyncSnapshot> = async () => ({ seq_id: 0, nodes: [] })

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSyncOps: (since: number) => syncOpsImpl(since),
  getSnapshot: () => snapshotImpl(),
  getStreamToken: async () => ({ stream_token: 'test-token' }),
  submitSyncOps: async () => ({ applied: [], rejected: [] }),
})

const { SyncClient } = await import('../src/lib/sync-client')

const FILE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

function op(seq: number, op_type: string, payload: Record<string, unknown>): SyncOp {
  return { seq_id: seq, op_type, payload, created_at: '' }
}

function node(id: string, overrides: Partial<SyncNode> = {}): SyncNode {
  return {
    id,
    name_encrypted: `enc-${id}`,
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

async function waitFor(pred: () => boolean, label: string, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Stop a client and let its in-flight promises settle. */
async function stopAndSettle(client: InstanceType<typeof SyncClient>): Promise<void> {
  client.stop()
  await new Promise((r) => setTimeout(r, 100))
}

const storage = (globalThis as { localStorage: MemoryStorage }).localStorage

beforeEach(() => {
  storage.clear()
  FakeEventSource.instances = []
  syncOpsImpl = async () => []
  snapshotImpl = async () => ({ seq_id: 0, nodes: [] })
})

describe('1700 review B1: boot catch-up ordering', () => {
  test('B1 a stale >1000-op catch-up page must not overwrite the newer snapshot', async () => {
    storage.setItem('bb_sync_last_seq', '0')
    const calls: number[] = []
    // The server returns an ascending LIMIT-1000 page from `since`. With a
    // persisted position of 0 and a snapshot at 5000, the stale page ends at
    // 1000 — well before the snapshot.
    const stalePage: SyncOp[] = Array.from({ length: 1000 }, (_, i) => {
      const seq = i + 1
      if (seq === 50) {
        return op(50, 'file_rename', { id: FILE_ID, new_name_encrypted: 'cipher-A' })
      }
      if (seq === 60) {
        return op(60, 'file_trash', { id: FILE_ID })
      }
      return op(seq, 'file_update', { id: `other-${seq}`, size_bytes: seq })
    })
    syncOpsImpl = async (since: number) => {
      calls.push(since)
      return since >= 5000 ? [] : stalePage
    }
    snapshotImpl = async () => ({
      seq_id: 5000,
      nodes: [node(FILE_ID, { name_encrypted: 'cipher-B', size_bytes: 7, is_trashed: false })],
    })
    const client = new SyncClient()
    try {
      await client.start()
      // The tail must be fetched from the snapshot position, not the persisted one.
      expect(calls[0]).toBe(5000)
      // Snapshot state wins: the pre-window rename/trash must NOT be replayed.
      expect(client.getNode(FILE_ID)?.name_encrypted).toBe('cipher-B')
      expect(client.getNode(FILE_ID)?.size_bytes).toBe(7)
      expect(client.getNode(FILE_ID)?.is_trashed).toBe(false)
      expect(client.getLastSeq()).toBe(5000)
      expect(client.isCoverageComplete()).toBe(true)
    } finally {
      await stopAndSettle(client)
    }
  })
})

describe('1700 review S1: snapshot single-flight + timeout', () => {
  test('S1 ops arriving while a snapshot fetch is in flight are replayed after the merge', async () => {
    let resolveSnap: ((snap: SyncSnapshot) => void) | null = null
    let markStarted: (() => void) | null = null
    const started = new Promise<void>((r) => { markStarted = r })
    snapshotImpl = () => new Promise<SyncSnapshot>((resolve) => {
      resolveSnap = resolve
      markStarted?.()
    })
    const client = new SyncClient({ snapshotTimeoutMs: 2000 })
    try {
      // Missing node → debounced coverage resync (snapshot fetch starts).
      client.ingestStreamFrame(JSON.stringify(op(1, 'file_update', { id: FILE_ID, size_bytes: 5 })))
      await started
      // A newer op lands DURING the fetch; the snapshot predates it.
      client.ingestStreamFrame(JSON.stringify(op(2, 'file_create', {
        id: FILE_ID, name_encrypted: 'fresh', parent_id: null, size_bytes: 10,
      })))
      resolveSnap?.({ seq_id: 1, nodes: [node(FILE_ID, { name_encrypted: 'stale', size_bytes: 1 })] })
      await waitFor(() => client.isCoverageComplete(), 'coverage complete after resync')
      // The post-snapshot op must win (no overwrite by the older snapshot).
      expect(client.getNode(FILE_ID)?.name_encrypted).toBe('fresh')
      expect(client.getNode(FILE_ID)?.size_bytes).toBe(10)
      expect(client.getLastSeq()).toBe(2)
    } finally {
      await stopAndSettle(client)
    }
  })

  test('S1 concurrent resync triggers never fetch snapshots concurrently', async () => {
    let fetches = 0
    let active = 0
    let maxActive = 0
    let resolveFirst: ((snap: SyncSnapshot) => void) | null = null
    let markStarted: (() => void) | null = null
    const started = new Promise<void>((r) => { markStarted = r })
    snapshotImpl = () => {
      fetches += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      const p = fetches === 1
        ? new Promise<SyncSnapshot>((resolve) => { resolveFirst = resolve; markStarted?.() })
        : Promise.resolve({ seq_id: 1, nodes: [] })
      return p.finally(() => { active -= 1 })
    }
    const client = new SyncClient({ snapshotTimeoutMs: 2000 })
    try {
      client.ingestStreamFrame(JSON.stringify(op(1, 'file_update', { id: FILE_ID, size_bytes: 5 })))
      await started
      // Overflow the reorder buffer while the fetch is in flight: without
      // single-flight this launches a second, overlapping snapshot fetch.
      for (let i = 0; i < 510; i++) {
        client.ingestStreamFrame(JSON.stringify(op(1000 + i, 'file_update', { id: `f-${i}`, size_bytes: i })))
      }
      resolveFirst?.({ seq_id: 1, nodes: [] })
      await new Promise((r) => setTimeout(r, 400))
      expect(maxActive).toBe(1)
    } finally {
      await stopAndSettle(client)
    }
  })

  test('S1 a hung snapshot times out and the resync retries (no permanent stall)', async () => {
    let calls = 0
    snapshotImpl = () => {
      calls += 1
      return new Promise<SyncSnapshot>(() => { /* never resolves */ })
    }
    const client = new SyncClient({ snapshotTimeoutMs: 30 })
    try {
      client.ingestStreamFrame(JSON.stringify(op(1, 'file_update', { id: FILE_ID, size_bytes: 2 })))
      await waitFor(() => calls >= 2, 'retry after snapshot timeout', 4000)
      expect(calls).toBeGreaterThanOrEqual(2)
    } finally {
      await stopAndSettle(client)
    }
  })
})

describe('1700 round-3: gap-fill vs in-flight snapshot', () => {
  test('R3 gap-fill never applies while a snapshot fetch is in flight (no overwrite, no op lost)', async () => {
    let resolveOps1: ((ops: SyncOp[]) => void) | null = null
    let opsCalls = 0
    let snapshotStarted = false
    let resolveSnap: ((snap: SyncSnapshot) => void) | null = null
    // The op page that fills the hole above `lastSeq = 1`.
    const tail = [
      op(2, 'file_create', { id: FILE_ID, name_encrypted: 'op', parent_id: null, size_bytes: 50 }),
      op(3, 'file_update', { id: FILE_ID, size_bytes: 50 }),
    ]
    syncOpsImpl = async () => {
      opsCalls += 1
      if (opsCalls === 1) {
        // Held: the gap-fill is mid-fetch when the snapshot fetch starts.
        return new Promise<SyncOp[]>((resolve) => { resolveOps1 = resolve })
      }
      return tail
    }
    snapshotImpl = () => {
      snapshotStarted = true
      return new Promise<SyncSnapshot>((resolve) => { resolveSnap = resolve })
    }
    const client = new SyncClient({ snapshotTimeoutMs: 8000 })
    try {
      // Hole below 4 with a buffered future op; gap-fill starts after ~30 ms.
      client.ingestStreamFrame(JSON.stringify(op(4, 'file_update', { id: FILE_ID, size_bytes: 50 })))
      await waitFor(() => opsCalls === 1, 'gap-fill op fetch started')
      // A missing-node op (in-order) starts a coverage resync whose snapshot we hold.
      client.ingestStreamFrame(JSON.stringify(op(1, 'file_update', { id: OTHER_ID, size_bytes: 9 })))
      await waitFor(() => snapshotStarted, 'snapshot fetch started')
      // Release the op page while the snapshot fetch is STILL in flight.
      resolveOps1?.(tail)
      await new Promise((r) => setTimeout(r, 150))
      // Nothing from the op log may be applied before the snapshot merges.
      expect(client.getNode(FILE_ID)).toBeUndefined()
      expect(client.getNode(OTHER_ID)).toBeUndefined()
      expect(client.getLastSeq()).toBe(1)
      // Merge the older snapshot, then let coverage recovery re-fetch the tail.
      resolveSnap?.({ seq_id: 0, nodes: [node(FILE_ID, { size_bytes: 999 })] })
      await waitFor(
        () => client.isCoverageComplete() && client.getLastSeq() === 4,
        'coverage complete and tail applied',
      )
      // The op tail wins: the buffered create/update are applied after the merge.
      expect(client.getNode(FILE_ID)?.name_encrypted).toBe('op')
      expect(client.getNode(FILE_ID)?.size_bytes).toBe(50)
      expect(client.getLastSeq()).toBe(4)
    } finally {
      await stopAndSettle(client)
    }
  })
})
