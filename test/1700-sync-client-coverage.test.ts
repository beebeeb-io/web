import { beforeEach, describe, expect, test } from 'bun:test'
import type { SyncNode, SyncOp, SyncSnapshot } from '../src/lib/api'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1700 — SyncClient tree-coverage robustness. The false EmptyDrive during
 * a foreign bulk sync came from the client trusting `getSyncOps(lastSeq)` with
 * no gap/coverage detection: ops for unknown nodes were dropped while lastSeq
 * advanced, so `children(root)` could return [] and the drive clobbered a good
 * list with empty. These tests drive the real SyncClient with injected
 * getSyncOps/getSnapshot responses.
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

// Minimal EventSource so start() can open a stream without a browser.
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

// Mutable behaviour the mocked api module delegates to, set per test.
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

const storage = (globalThis as { localStorage: MemoryStorage }).localStorage

beforeEach(() => {
  storage.clear()
  FakeEventSource.instances = []
  syncOpsImpl = async () => []
  snapshotImpl = async () => ({ seq_id: 0, nodes: [] })
})

describe('1700: reorder buffer + gap fill', () => {
  test('T1 reverse-order file_create(N) + file_update(N+1) → both applied', () => {
    const client = new SyncClient()
    // N+1 arrives first — must be held, not dropped-with-advance.
    client.ingestStreamFrame(JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 99 })))
    expect(client.getNode(FILE_ID)).toBeUndefined()
    // N arrives and closes the hole from the buffer, no server call needed.
    client.ingestStreamFrame(
      JSON.stringify(op(1, 'file_create', { id: FILE_ID, name_encrypted: 'x', parent_id: null, size_bytes: 1 })),
    )
    expect(client.getNode(FILE_ID)?.size_bytes).toBe(99)
    expect(client.getNode(FILE_ID)?.name_encrypted).toBe('x')
    expect(client.getLastSeq()).toBe(2)
  })

  test('T2 seq gap → single gap-fill via getSyncOps(lastSeq); node present', async () => {
    const calls: number[] = []
    syncOpsImpl = async (since: number) => {
      calls.push(since)
      return [
        op(1, 'file_create', { id: FILE_ID, name_encrypted: 'x', parent_id: null, size_bytes: 1 }),
        op(2, 'file_update', { id: FILE_ID, size_bytes: 42 }),
      ]
    }
    const client = new SyncClient()
    // Op 2 arrives with a hole at 1 — currently dropped as "node missing".
    client.ingestStreamFrame(JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 42 })))
    await waitFor(() => calls.length === 1, 'gap-fill called')
    await waitFor(() => client.getNode(FILE_ID) !== undefined, 'node restored')
    expect(calls).toEqual([0])
    expect(client.getNode(FILE_ID)?.size_bytes).toBe(42)
    expect(client.getLastSeq()).toBe(2)
  })

  test('T3 file_restore for an unknown id → coverage resync; node visible after snapshot', async () => {
    let snapshotCalls = 0
    snapshotImpl = async () => {
      snapshotCalls += 1
      return { seq_id: 7, nodes: [node(FILE_ID, { is_trashed: false })] }
    }
    const client = new SyncClient()
    client.ingestStreamFrame(JSON.stringify(op(1, 'file_restore', { id: FILE_ID })))
    await waitFor(() => snapshotCalls === 1, 'snapshot resync called')
    await waitFor(() => client.getNode(FILE_ID) !== undefined, 'restored node visible')
    expect(client.getNode(FILE_ID)?.is_trashed).toBe(false)
    expect(client.getLastSeq()).toBe(7)
    expect(client.isCoverageComplete()).toBe(true)
  })

  test('T3b repeat missing-node ops for an id the snapshot confirms absent do not resync-storm', async () => {
    let snapshotCalls = 0
    snapshotImpl = async () => {
      snapshotCalls += 1
      return { seq_id: 1, nodes: [] }
    }
    const client = new SyncClient()
    client.ingestStreamFrame(JSON.stringify(op(1, 'file_update', { id: FILE_ID, size_bytes: 2 })))
    await waitFor(() => snapshotCalls === 1, 'first snapshot resync')
    await waitFor(() => client.getLastSeq() === 1, 'first op applied')
    // Let the first resync settle, then send another op for the same absent id.
    await new Promise((r) => setTimeout(r, 200))
    client.ingestStreamFrame(JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 3 })))
    await new Promise((r) => setTimeout(r, 250))
    expect(snapshotCalls).toBe(1)
    expect(client.getLastSeq()).toBe(2)
  })
})

describe('1700: start() coverage', () => {
  test('a returning device always merges the full snapshot, not only when the tree is empty', async () => {
    storage.setItem('bb_sync_last_seq', '5')
    let snapshotCalls = 0
    // Review B1: the tail is fetched from the SNAPSHOT position (10), not the
    // persisted position (5). Recorded and asserted AFTER start() so a
    // mismatch is a loud test failure, never a swallowed throw inside the mock
    // (a throw here is caught by catchUpOps and only logged).
    const seenSince: number[] = []
    syncOpsImpl = async (since: number) => {
      seenSince.push(since)
      // Empty tail: the snapshot at 10 already carries the full node set, so
      // lastSeq stays 10 (the test's intent).
      return []
    }
    snapshotImpl = async () => {
      snapshotCalls += 1
      return { seq_id: 10, nodes: [node(FILE_ID), node(OTHER_ID)] }
    }
    const client = new SyncClient()
    await client.start()
    // The persisted position (5) must have been superseded before catch-up.
    expect(seenSince).toEqual([10])
    // The old tree.size===0 heuristic could skip the snapshot; the returning
    // device must always merge it so OTHER_ID is visible.
    expect(snapshotCalls).toBe(1)
    expect(client.getNode(FILE_ID)).toBeDefined()
    expect(client.getNode(OTHER_ID)).toBeDefined()
    expect(client.getLastSeq()).toBe(10)
    expect(client.isCoverageComplete()).toBe(true)
  })

  test('a gap-fill that hits the server op cap falls back to a snapshot merge', async () => {
    // 1000 ops is the server page cap; a full page means "there is more".
    syncOpsImpl = async () => Array.from({ length: 1000 }, (_, i) => op(i + 1, 'file_create', {
      id: `file-${i + 1}`, name_encrypted: 'x', parent_id: null, size_bytes: 1,
    }))
    let snapshotCalls = 0
    snapshotImpl = async () => {
      snapshotCalls += 1
      return { seq_id: 1500, nodes: [node(OTHER_ID)] }
    }
    const client = new SyncClient()
    // Hole at 1 (op 2 arrives first) → gap-fill returns a full page → snapshot.
    client.ingestStreamFrame(JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 42 })))
    await waitFor(() => snapshotCalls === 1, 'snapshot fallback called')
    expect(client.getNode(OTHER_ID)).toBeDefined()
    expect(client.getLastSeq()).toBe(1500)
    expect(client.isCoverageComplete()).toBe(true)
  })
})
