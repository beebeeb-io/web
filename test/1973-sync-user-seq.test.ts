import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SyncNode, SyncOp, SyncSnapshot } from '../src/lib/api'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1973 (scale audit R3, N05) — the web follows the per-user `user_seq`.
 *
 * `sync_ops.seq_id` is ONE global sequence: every other user's ops sit between
 * two of yours. The client required `seq_id === lastSeq + 1`, so with more than
 * one active user nearly every live op looked like a missed op, the gap fill
 * handed back ops that were just as non-contiguous, and the client fell back to
 * a full `/sync/snapshot` (O(vault)) per op per open tab.
 *
 * Server contract (server#233): every op carries `user_seq` (stream frames,
 * `/sync/ops` pages, POST `applied[]`), the snapshot carries `user_seq`,
 * `GET /sync/ops?since_user_seq=N` pages by it and every page has
 * `head_user_seq`. Ops recorded before that deploy have `user_seq: null`. The
 * client feature-detects on a numeric snapshot `user_seq`; an older server
 * (no such field) keeps today's global-seq behaviour exactly.
 *
 * A FakeServer below models one user's op log on a platform with other users:
 * other users' ops consume global `seq_id`s, never this user's `user_seq`.
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
  onopen: (() => void) | null = null
  onmessage: ((msg: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  close(): void {}
}
;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource

type WireOp = SyncOp & { user_seq?: number | null }
type WireSnapshot = SyncSnapshot & { user_seq?: number }
interface UserSeqPage {
  ops: WireOp[]
  head_seq?: number
  head_user_seq?: number
}
interface SubmittedOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
}

/** One user's view of the server, with other users writing in between. */
class FakeServer {
  /** true = server#233 (numbers ops per user); false = an older server. */
  numbered = true
  ops: WireOp[] = []
  nodes = new Map<string, SyncNode>()
  globalSeq = 0
  userHead = 0
  snapshotCalls = 0
  legacyOpsCalls: number[] = []
  userSeqCalls: number[] = []
  /** Override for the next `since_user_seq` page (failure / contradiction). */
  userSeqPageOverride: ((since: number) => Promise<UserSeqPage>) | null = null

  /** Other users write `n` ops: global seq moves, this user's sequence does not. */
  otherUsersWrite(n: number): void {
    this.globalSeq += n
  }

  /** Record one of THIS user's ops and return its wire form (the stream frame). */
  record(op_type: string, payload: Record<string, unknown>, client_op_id?: string): WireOp {
    this.globalSeq += 1
    const op: WireOp = {
      seq_id: this.globalSeq,
      op_type,
      payload,
      created_at: '2026-10-18T00:00:00.000Z',
      ...(client_op_id ? { client_op_id } : {}),
    }
    if (this.numbered) {
      this.userHead += 1
      op.user_seq = this.userHead
    }
    this.ops.push(op)
    this.applyToNodes(op)
    return op
  }

  /** An op recorded by the server before the 1973 deploy: `user_seq: null`. */
  recordPreDeploy(op_type: string, payload: Record<string, unknown>): WireOp {
    this.globalSeq += 1
    const op: WireOp = { seq_id: this.globalSeq, user_seq: null, op_type, payload, created_at: '' }
    this.ops.push(op)
    this.applyToNodes(op)
    return op
  }

  private applyToNodes(op: WireOp): void {
    const id = op.payload.id as string
    if (op.op_type === 'file_create') {
      this.nodes.set(id, node(id, { name_encrypted: String(op.payload.name_encrypted ?? '') }))
    } else if (op.op_type === 'file_update') {
      const n = this.nodes.get(id)
      if (n) this.nodes.set(id, { ...n, size_bytes: op.payload.size_bytes as number })
    } else if (op.op_type === 'file_rename') {
      const n = this.nodes.get(id)
      if (n) this.nodes.set(id, { ...n, name_encrypted: op.payload.new_name_encrypted as string })
    }
  }

  snapshot(): WireSnapshot {
    this.snapshotCalls += 1
    const mine = this.ops.map((o) => o.seq_id)
    const snap: WireSnapshot = {
      seq_id: mine.length ? Math.max(...mine) : 0,
      nodes: Array.from(this.nodes.values()),
    }
    if (this.numbered) snap.user_seq = this.userHead
    return snap
  }

  /** `GET /sync/ops?since=N` — this user's ops by GLOBAL seq (what main uses). */
  legacyPage(since: number): WireOp[] {
    this.legacyOpsCalls.push(since)
    return this.ops.filter((o) => o.seq_id > since).slice(0, 1000)
  }

  /** `GET /sync/ops?since_user_seq=N` — server#233. */
  async userSeqPage(since: number): Promise<UserSeqPage> {
    this.userSeqCalls.push(since)
    if (this.userSeqPageOverride) return this.userSeqPageOverride(since)
    const ops = this.ops
      .filter((o) => typeof o.user_seq === 'number' && o.user_seq > since)
      .sort((a, b) => (a.user_seq as number) - (b.user_seq as number))
      .slice(0, 1000)
    return { ops, head_seq: this.globalSeq, head_user_seq: this.userHead }
  }

  /** `POST /sync/ops` — records each op; answers `applied[]` (no stream echo here). */
  submit(ops: SubmittedOp[]): { applied: { client_op_id: string; seq_id: number; user_seq?: number }[]; rejected: [] } {
    const applied = ops.map((o) => {
      const rec = this.record(o.op_type, o.payload, o.client_op_id)
      return this.numbered
        ? { client_op_id: o.client_op_id, seq_id: rec.seq_id, user_seq: rec.user_seq as number }
        : { client_op_id: o.client_op_id, seq_id: rec.seq_id }
    })
    return { applied, rejected: [] }
  }
}

let server = new FakeServer()

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSnapshot: async () => server.snapshot(),
  getSyncOps: async (since: number) => server.legacyPage(since),
  getSyncOpsSinceUserSeq: (since: number) => server.userSeqPage(since),
  getStreamToken: async () => ({ stream_token: 'test-token' }),
  submitSyncOps: async (ops: SubmittedOp[]) => server.submit(ops),
})

const { SyncClient } = await import('../src/lib/sync-client')
type Client = InstanceType<typeof SyncClient>

const storage = (globalThis as { localStorage: MemoryStorage }).localStorage

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

function fileId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function create(n: number): [string, Record<string, unknown>] {
  return ['file_create', { id: fileId(n), name_encrypted: `name-${n}`, parent_id: null, size_bytes: 1 }]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, label: string, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${label}`)
    await sleep(10)
  }
}

/** Let every debounced gap fill / resync (30–100 ms) run to completion. */
async function settle(): Promise<void> {
  await sleep(400)
}

/**
 * Start a client, then count `resyncSnapshot` calls and every sync request
 * from that point on (boot's own snapshot is not counted).
 */
/** Every client a test started; stopped after each test so no timer outlives it. */
const liveClients: Client[] = []

async function startCounted(): Promise<{ client: Client; resyncCalls: () => number; reset: () => void }> {
  const client = new SyncClient()
  liveClients.push(client)
  await client.start()
  let resyncs = 0
  const c = client as unknown as { resyncSnapshot: () => Promise<void> }
  const original = c.resyncSnapshot.bind(client)
  c.resyncSnapshot = () => {
    resyncs += 1
    return original()
  }
  const reset = () => {
    resyncs = 0
    server.snapshotCalls = 0
    server.legacyOpsCalls = []
    server.userSeqCalls = []
  }
  reset()
  return { client, resyncCalls: () => resyncs, reset }
}

function feed(client: Client, op: WireOp): void {
  client.ingestStreamFrame(JSON.stringify(op))
}

beforeEach(() => {
  storage.clear()
  server = new FakeServer()
})

afterEach(() => {
  for (const c of liveClients.splice(0)) c.stop()
})

describe('1973 (a): two users interleaved', () => {
  test('every op of this user is applied and resyncSnapshot is called 0 times', async () => {
    // History before the tab opens, interleaved with another user's writes.
    for (let i = 1; i <= 3; i++) {
      server.otherUsersWrite(2)
      server.record(...create(i))
    }
    const { client, resyncCalls } = await startCounted()

    // Live: another user's ops land between every op of ours.
    for (let i = 4; i <= 23; i++) {
      server.otherUsersWrite(1 + (i % 3))
      feed(client, server.record(...create(i)))
      server.otherUsersWrite(2)
      feed(client, server.record('file_update', { id: fileId(i), size_bytes: 1000 + i }))
    }
    await settle()

    for (let i = 1; i <= 23; i++) expect(client.getNode(fileId(i))).toBeDefined()
    for (let i = 4; i <= 23; i++) expect(client.getNode(fileId(i))?.size_bytes).toBe(1000 + i)
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
    // No hole existed, so no catch-up request either.
    expect(server.userSeqCalls).toEqual([])
    expect(server.legacyOpsCalls).toEqual([])
    expect(client.isCoverageComplete()).toBe(true)
  })
})

describe('1973 (b): a real gap', () => {
  test('exactly one /sync/ops?since_user_seq=<cursor> request and 0 snapshots', async () => {
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()

    server.otherUsersWrite(5)
    feed(client, server.record(...create(2))) // user_seq 2
    server.otherUsersWrite(5)
    server.record(...create(3)) // user_seq 3 — LOST on the stream
    server.otherUsersWrite(5)
    feed(client, server.record('file_update', { id: fileId(3), size_bytes: 33 })) // user_seq 4

    await waitFor(() => client.getNode(fileId(3))?.size_bytes === 33, 'gap filled')
    await settle()

    expect(server.userSeqCalls).toEqual([2])
    expect(server.legacyOpsCalls).toEqual([])
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
    expect(client.getNode(fileId(2))).toBeDefined()
    expect(client.isCoverageComplete()).toBe(true)
  })
})

describe('1973 (c): a catch-up that fails or contradicts head', () => {
  test('a failing catch-up falls back to exactly 1 snapshot', async () => {
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()
    server.userSeqPageOverride = async () => {
      throw new Error('503')
    }

    server.otherUsersWrite(3)
    server.record(...create(2)) // lost
    feed(client, server.record('file_update', { id: fileId(2), size_bytes: 22 }))

    await waitFor(() => client.getNode(fileId(2))?.size_bytes === 22, 'snapshot restored')
    await settle()

    expect(server.userSeqCalls).toEqual([1])
    expect(resyncCalls()).toBe(1)
    expect(server.snapshotCalls).toBe(1)
    expect(client.isCoverageComplete()).toBe(true)
  })

  test('a catch-up whose head_user_seq is below an op already seen falls back to exactly 1 snapshot', async () => {
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()
    // The server claims nothing exists after user_seq 1, yet the stream already
    // delivered user_seq 3: the page contradicts what this tab saw.
    server.userSeqPageOverride = async () => ({ ops: [], head_seq: server.globalSeq, head_user_seq: 1 })

    server.otherUsersWrite(3)
    server.record(...create(2)) // lost
    feed(client, server.record('file_update', { id: fileId(2), size_bytes: 22 }))

    await waitFor(() => client.getNode(fileId(2))?.size_bytes === 22, 'snapshot restored')
    await settle()

    expect(server.userSeqCalls).toEqual([1])
    expect(resyncCalls()).toBe(1)
    expect(server.snapshotCalls).toBe(1)
    expect(client.isCoverageComplete()).toBe(true)
  })
})

describe('1973 (d): an older server (no numeric snapshot user_seq)', () => {
  test('keeps today’s global-seq behaviour exactly', async () => {
    server.numbered = false
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()
    const bootSeq = client.getLastSeq()
    expect(bootSeq).toBe(1)

    // Contiguous global seqs (no other user wrote): applied straight away.
    feed(client, server.record(...create(2)))
    expect(client.getNode(fileId(2))).toBeDefined()
    expect(client.getLastSeq()).toBe(2)

    // Another user writes in between: today this is a gap, filled from the
    // global op log by the GLOBAL cursor, and the still-non-contiguous result
    // falls back to one snapshot (the very behaviour 1973 removes on a new server).
    server.otherUsersWrite(4)
    feed(client, server.record(...create(3)))
    await waitFor(() => server.snapshotCalls === 1, 'old-server fallback snapshot')
    await settle()

    expect(server.legacyOpsCalls).toEqual([2])
    expect(server.userSeqCalls).toEqual([])
    expect(resyncCalls()).toBe(1)
    expect(server.snapshotCalls).toBe(1)
    expect(client.getNode(fileId(3))).toBeDefined()
    expect(client.getLastSeq()).toBe(server.globalSeq)
    // The POST path does not move the cursor on an old server either (the echo does).
    const before = client.getLastSeq()
    await client.submitOp(...create(4))
    expect(client.getLastSeq()).toBe(before)
  })
})

describe('1973 (e): stream frames and POST applied[] both advance the user_seq cursor', () => {
  test('frame, then own POST, then another device’s frame: no catch-up, no snapshot', async () => {
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()

    // A stream frame (user_seq 2, global seq far ahead).
    server.otherUsersWrite(40)
    feed(client, server.record(...create(2)))
    expect(client.getNode(fileId(2))).toBeDefined()

    // This tab's own op: POST /sync/ops answers applied[{ seq_id, user_seq: 3 }].
    // The stream echo is not delivered yet.
    server.otherUsersWrite(40)
    const result = await client.submitOp(...create(3))
    expect(result.accepted).toBe(true)
    const echo = server.ops[server.ops.length - 1]
    expect(echo.user_seq).toBe(3)

    // Another device's op, user_seq 4: contiguous only if the POST moved the cursor.
    server.otherUsersWrite(40)
    feed(client, server.record('file_update', { id: fileId(3), size_bytes: 77 }))
    expect(client.getNode(fileId(3))?.size_bytes).toBe(77)

    // The late echo of our own op (user_seq 3) is now old: ignored.
    feed(client, echo)
    await settle()

    expect(client.getNode(fileId(3))?.size_bytes).toBe(77)
    expect(server.userSeqCalls).toEqual([])
    expect(server.legacyOpsCalls).toEqual([])
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
    expect(client.isCoverageComplete()).toBe(true)
  })
})

describe('1973 (f): a duplicate or old user_seq is ignored idempotently', () => {
  test('replayed user_seq 2 and 3 never undo user_seq 4', async () => {
    server.record(...create(1))
    const { client, resyncCalls } = await startCounted()

    server.otherUsersWrite(9)
    const u2 = server.record('file_update', { id: fileId(1), size_bytes: 20 })
    server.otherUsersWrite(9)
    const u3 = server.record('file_rename', { id: fileId(1), new_name_encrypted: 'old-name' })
    server.otherUsersWrite(9)
    const u4 = server.record('file_rename', { id: fileId(1), new_name_encrypted: 'new-name' })
    feed(client, u2)
    feed(client, u3)
    feed(client, u4)
    expect(client.getNode(fileId(1))?.name_encrypted).toBe('new-name')

    // Duplicates and an old op arrive again (a replayed stream, a late page).
    feed(client, u3)
    feed(client, u2)
    feed(client, u4)
    feed(client, u3)
    await settle()

    expect(client.getNode(fileId(1))?.name_encrypted).toBe('new-name')
    expect(client.getNode(fileId(1))?.size_bytes).toBe(20)
    expect(server.userSeqCalls).toEqual([])
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
    expect(client.isCoverageComplete()).toBe(true)
  })
})

describe('1973: persisted cursor and mode switches', () => {
  test('an old persisted global cursor is never used as a user_seq', async () => {
    // A tab that last ran against the old server left a GLOBAL cursor behind.
    storage.setItem('bb_sync_last_seq', '5000')
    server.otherUsersWrite(6000)
    server.record(...create(1))
    server.record(...create(2)) // user_seq 2 — far below 5000
    const { client, resyncCalls } = await startCounted()

    server.otherUsersWrite(10)
    feed(client, server.record(...create(3))) // user_seq 3
    expect(client.getNode(fileId(3))).toBeDefined()

    server.record(...create(4)) // lost
    server.otherUsersWrite(10)
    feed(client, server.record('file_update', { id: fileId(4), size_bytes: 44 }))
    await waitFor(() => client.getNode(fileId(4))?.size_bytes === 44, 'gap filled')
    await settle()

    expect(server.userSeqCalls).toEqual([3])
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
  })

  test('old server → new server mid-session: one snapshot on reconnect, then incremental', async () => {
    server.numbered = false
    server.record(...create(1))
    const { client, resyncCalls, reset } = await startCounted()

    // The server is upgraded: ops already recorded keep user_seq null and new
    // ones are numbered from the head the migration starts at (0).
    server.numbered = true
    const c = client as unknown as { reconnect: () => Promise<void> }
    await c.reconnect() // the stream dropped during the deploy: one snapshot
    expect(server.snapshotCalls).toBe(1)
    reset()

    server.otherUsersWrite(50)
    feed(client, server.record(...create(2))) // user_seq 1
    server.otherUsersWrite(50)
    feed(client, server.record(...create(3))) // user_seq 2
    await settle()

    expect(client.getNode(fileId(2))).toBeDefined()
    expect(client.getNode(fileId(3))).toBeDefined()
    expect(resyncCalls()).toBe(0)
    expect(server.snapshotCalls).toBe(0)
    expect(server.legacyOpsCalls).toEqual([])
  })

  test('new server → old server (rollback): back to the global cursor after one snapshot', async () => {
    server.record(...create(1))
    const { client, reset } = await startCounted()
    server.numbered = false
    const c = client as unknown as { reconnect: () => Promise<void> }
    await c.reconnect()
    reset()

    // Contiguous by global seq on the old server: applied with no request.
    feed(client, server.record(...create(2)))
    await settle()
    expect(client.getNode(fileId(2))).toBeDefined()
    expect(server.snapshotCalls).toBe(0)
    expect(server.legacyOpsCalls).toEqual([])
    expect(server.userSeqCalls).toEqual([])
  })

  test('pre-deploy ops (user_seq null) are applied as today and do not move the user cursor', async () => {
    server.recordPreDeploy(...create(1))
    const { client } = await startCounted()
    // A frame without a number in user_seq mode (an old node mid-rolling-deploy).
    server.otherUsersWrite(3)
    feed(client, server.recordPreDeploy('file_update', { id: fileId(1), size_bytes: 9 }))
    expect(client.getNode(fileId(1))?.size_bytes).toBe(9)
    // The next numbered op is user_seq 1: contiguous with the snapshot's 0.
    server.otherUsersWrite(3)
    feed(client, server.record(...create(2)))
    await settle()
    expect(client.getNode(fileId(2))).toBeDefined()
    expect(server.userSeqCalls).toEqual([])
    expect(server.snapshotCalls).toBe(0)
  })
})
