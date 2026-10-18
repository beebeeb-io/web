import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SyncNode, SyncOp, SyncSnapshot } from '../src/lib/api'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1973, PR #173 round 2 (Codex review at c31bfcdf): a pending op is
 * confirmed by IDENTITY, never by sequence.
 *
 * The bug: `applyRemoteOp` returned on `key <= cursor` BEFORE echo suppression
 * removed the matching `client_op_id`. When a snapshot already covered an op
 * this tab submitted (a snapshot that overtook the POST answer, a stream echo
 * held during a snapshot fetch, or a reload after the server committed the
 * op), its pending entry stayed in `bb_sync_pending_ops` for good: every later
 * snapshot merge kept the stale optimistic node and re-applied the op over the
 * server's state, and the next boot resubmitted it. The server has no
 * idempotency on `client_op_id` (server main routes/sync.rs `apply_one_op`
 * re-executes the mutation and records a NEW op), so that resubmission also
 * re-wrote the stale value on the server.
 *
 * The same ordering existed on the legacy (global `seq_id`) path on main.
 *
 * FakeServer models one user's op log on a platform with other users, like
 * test/1973-sync-user-seq.test.ts, plus a POST that can be held (committed,
 * answer not yet delivered), lost (committed, answer never delivered) or fail
 * (never committed), and a snapshot that can be held or served stale.
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
interface SubmittedOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
}
type Applied = { client_op_id: string; seq_id: number; user_seq?: number }
type SubmitResult = { applied: Applied[]; rejected: [] }

class FakeServer {
  /** true = server#233 (numbers ops per user); false = the legacy server. */
  numbered = true
  ops: WireOp[] = []
  nodes = new Map<string, SyncNode>()
  globalSeq = 0
  userHead = 0
  snapshotCalls = 0
  legacyOpsCalls: number[] = []
  /** Every POST /sync/ops batch, by client_op_id. */
  submitCalls: string[][] = []
  /**
   * normal: commit + answer. hold: commit now, answer on releaseSubmits().
   * lose: commit, then the answer never arrives (the fetch rejects).
   * fail: never reaches the server (the fetch rejects, nothing committed).
   */
  submitMode: 'normal' | 'hold' | 'lose' | 'fail' = 'normal'
  /**
   * r3: the POST lands on a node that predates server#233 during a rolling
   * deploy (or after a rollback): the database still numbers the op (the
   * trigger), but the `applied[]` answer carries no `user_seq`.
   */
  oldNodeAnswers = false
  private held: { result: SubmitResult; resolve: (r: SubmitResult) => void }[] = []
  /** Serve this snapshot once instead of the current state (fetched earlier). */
  staleSnapshot: WireSnapshot | null = null
  /** Hold the next snapshot answer until releaseSnapshot(). */
  holdSnapshot = false
  private heldSnapshot: (() => void) | null = null

  otherUsersWrite(n: number): void {
    this.globalSeq += n
  }

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
    const id = payload.id as string
    if (op_type === 'file_create') {
      this.nodes.set(id, node(id, { name_encrypted: String(payload.name_encrypted ?? '') }))
    } else if (op_type === 'file_rename') {
      const n = this.nodes.get(id)
      if (n) this.nodes.set(id, { ...n, name_encrypted: payload.new_name_encrypted as string })
    }
    return op
  }

  snapshotNow(): WireSnapshot {
    const mine = this.ops.map((o) => o.seq_id)
    const snap: WireSnapshot = {
      seq_id: mine.length ? Math.max(...mine) : 0,
      nodes: Array.from(this.nodes.values()).map((n) => ({ ...n })),
    }
    if (this.numbered) snap.user_seq = this.userHead
    return snap
  }

  async snapshot(): Promise<WireSnapshot> {
    this.snapshotCalls += 1
    const snap = this.staleSnapshot ?? this.snapshotNow()
    this.staleSnapshot = null
    if (!this.holdSnapshot) return snap
    this.holdSnapshot = false
    return new Promise((resolve) => {
      this.heldSnapshot = () => resolve(snap)
    })
  }

  releaseSnapshot(): void {
    const release = this.heldSnapshot
    this.heldSnapshot = null
    release?.()
  }

  get snapshotHeld(): boolean {
    return this.heldSnapshot !== null
  }

  legacyPage(since: number): WireOp[] {
    this.legacyOpsCalls.push(since)
    return this.ops.filter((o) => o.seq_id > since).slice(0, 1000)
  }

  async userSeqPage(since: number) {
    const ops = this.ops
      .filter((o) => typeof o.user_seq === 'number' && o.user_seq > since)
      .sort((a, b) => (a.user_seq as number) - (b.user_seq as number))
      .slice(0, 1000)
    return { ops, head_seq: this.globalSeq, head_user_seq: this.userHead }
  }

  /** Like server main `apply_one_op`: no idempotency on client_op_id — every POST re-executes. */
  submit(ops: SubmittedOp[]): Promise<SubmitResult> {
    this.submitCalls.push(ops.map((o) => o.client_op_id))
    if (this.submitMode === 'fail') return Promise.reject(new Error('network down'))
    const applied = ops.map((o) => {
      const rec = this.record(o.op_type, o.payload, o.client_op_id)
      return this.numbered && !this.oldNodeAnswers
        ? { client_op_id: o.client_op_id, seq_id: rec.seq_id, user_seq: rec.user_seq as number }
        : { client_op_id: o.client_op_id, seq_id: rec.seq_id }
    })
    const result: SubmitResult = { applied, rejected: [] }
    if (this.submitMode === 'lose') return Promise.reject(new Error('connection reset after commit'))
    if (this.submitMode === 'hold') {
      return new Promise((resolve) => this.held.push({ result, resolve }))
    }
    return Promise.resolve(result)
  }

  get heldSubmits(): number {
    return this.held.length
  }

  releaseSubmits(): void {
    for (const h of this.held.splice(0)) h.resolve(h.result)
  }

  /** The last op this server recorded (the stream frame of it). */
  last(): WireOp {
    return this.ops[this.ops.length - 1]
  }
}

let server = new FakeServer()

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSnapshot: () => server.snapshot(),
  getSyncOps: async (since: number) => server.legacyPage(since),
  getSyncOpsSinceUserSeq: (since: number) => server.userSeqPage(since),
  getStreamToken: async () => ({ stream_token: 'test-token' }),
  submitSyncOps: (ops: SubmittedOp[]) => server.submit(ops),
})

const { SyncClient, pendingCoveredBy, hasRecordedPosition } = await import('../src/lib/sync-client')
type Client = InstanceType<typeof SyncClient>
type Pending = Parameters<typeof pendingCoveredBy>[0]

/**
 * Round 3 invariant, checked after EVERY test in this file (r2 and r3): an
 * entry with a recorded position is cleared by a far-enough numbered snapshot
 * AND by a far-enough unnumbered one; one without is what flushPending sends.
 */
function assertEveryPendingClearable(entries: Pending[], where: string): void {
  const far = Number.MAX_SAFE_INTEGER
  for (const p of entries) {
    if (!hasRecordedPosition(p)) continue
    const numbered = pendingCoveredBy(p, far, far)
    const unnumbered = pendingCoveredBy(p, far, null)
    if (!numbered || !unnumbered) {
      throw new Error(`invariant (${where}): ${JSON.stringify(p)} numbered=${numbered} unnumbered=${unnumbered}`)
    }
  }
}

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

const FILE = '00000000-0000-4000-8000-000000000001'

function rename(name: string): [string, Record<string, unknown>] {
  return ['file_rename', { id: FILE, new_name_encrypted: name }]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, label: string, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${label}`)
    await sleep(5)
  }
}

const liveClients: Client[] = []

async function boot(): Promise<Client> {
  const client = new SyncClient()
  liveClients.push(client)
  await client.start()
  await sleep(20) // let start()'s fire-and-forget flushPending settle
  return client
}

/** A page reload: the old tab dies, a new one boots from the same storage. */
async function reload(old: Client): Promise<Client> {
  old.stop()
  return boot()
}

function feed(client: Client, op: WireOp): void {
  client.ingestStreamFrame(JSON.stringify(op))
}

/** A mid-session snapshot merge (reconnect, missing node, gap fallback). */
function resync(client: Client): Promise<void> {
  return (client as unknown as { resyncSnapshot: () => Promise<void> }).resyncSnapshot()
}

function memPending(client: Client): string[] {
  return (client as unknown as { pendingOps: { client_op_id: string }[] }).pendingOps.map((p) => p.client_op_id)
}

function storedPending(): string[] {
  const raw = storage.getItem('bb_sync_pending_ops')
  return raw ? (JSON.parse(raw) as { client_op_id: string }[]).map((p) => p.client_op_id) : []
}

function name(client: Client): string | undefined {
  return client.getNode(FILE)?.name_encrypted
}

beforeEach(() => {
  storage.clear()
  server = new FakeServer()
})

afterEach(() => {
  const inMemory = liveClients.flatMap((c) => [...(c as unknown as { pendingOps: Pending[] }).pendingOps])
  for (const c of liveClients.splice(0)) c.stop()
  assertEveryPendingClearable(inMemory, 'memory')
  const raw = storage.getItem('bb_sync_pending_ops')
  assertEveryPendingClearable(raw ? (JSON.parse(raw) as Pending[]) : [], 'storage')
})

for (const mode of ['user_seq', 'legacy seq_id'] as const) {
  const legacy = mode === 'legacy seq_id'
  const label = legacy ? '(c) legacy seq_id' : '(a) user_seq'

  describe(`1973 r2 ${label}: a snapshot overtakes an accepted POST`, () => {
    beforeEach(() => {
      server.numbered = !legacy
    })

    test('the late POST answer clears the pending op; the next snapshot is authoritative', async () => {
      server.record('file_create', { id: FILE, name_encrypted: 'start' })
      const client = await boot()

      server.submitMode = 'hold'
      server.otherUsersWrite(7)
      const submitted = client.submitOp(...rename('mine'))
      await waitFor(() => server.heldSubmits === 1, 'POST committed, answer held')
      const mine = server.last()
      expect(name(client)).toBe('mine')

      // A snapshot taken after the commit merges before the POST answer (the
      // stream echo is lost: a dropped connection).
      await resync(client)
      server.releaseSubmits()
      await submitted

      expect(memPending(client)).toEqual([])
      expect(storedPending()).toEqual([])

      // Another device renames afterwards; its frame is lost, a snapshot brings it.
      server.otherUsersWrite(3)
      server.record(...rename('theirs'))
      await resync(client)
      expect(name(client)).toBe('theirs')

      // A late duplicate of our own op changes nothing.
      feed(client, mine)
      expect(name(client)).toBe('theirs')

      // And the next boot does not resubmit the stale op.
      const before = server.submitCalls.length
      const next = await reload(client)
      expect(server.submitCalls.length).toBe(before)
      expect(name(next)).toBe('theirs')
      expect(server.nodes.get(FILE)?.name_encrypted).toBe('theirs')
    })

    test('the stream echo held during a snapshot fetch clears the pending op', async () => {
      server.record('file_create', { id: FILE, name_encrypted: 'start' })
      const client = await boot()

      server.submitMode = 'hold'
      server.otherUsersWrite(7)
      void client.submitOp(...rename('mine'))
      await waitFor(() => server.heldSubmits === 1, 'POST committed, answer held')
      const echo = server.last()

      // The snapshot fetch starts after the commit; the echo lands while it is
      // in flight, is held, and is replayed after the merge, at or below the cursor.
      server.holdSnapshot = true
      const merged = resync(client)
      await waitFor(() => server.snapshotHeld, 'snapshot in flight')
      feed(client, echo)
      server.releaseSnapshot()
      await merged

      // Confirmed by the echo alone: the POST answer is still outstanding.
      expect(server.heldSubmits).toBe(1)
      expect(memPending(client)).toEqual([])
      expect(storedPending()).toEqual([])

      server.otherUsersWrite(3)
      server.record(...rename('theirs'))
      await resync(client)
      expect(name(client)).toBe('theirs')
      server.releaseSubmits()
    })
  })

  describe(`1973 r2 ${legacy ? '(c) legacy seq_id' : '(b) user_seq'}: reload with a pending op the server already committed`, () => {
    beforeEach(() => {
      server.numbered = !legacy
    })

    test('POST answer lost: found in the op log on boot, cleared, not resubmitted, no tree clobber', async () => {
      server.record('file_create', { id: FILE, name_encrypted: 'start' })
      const client = await boot()

      server.submitMode = 'lose'
      server.otherUsersWrite(4)
      await client.submitOp(...rename('mine'))
      expect(storedPending().length).toBe(1)
      expect(server.nodes.get(FILE)?.name_encrypted).toBe('mine') // committed

      // Another device renames after our commit, then this tab reloads.
      server.otherUsersWrite(4)
      server.record(...rename('theirs'))
      server.submitMode = 'normal'
      const before = server.submitCalls.length
      const next = await reload(client)

      expect(name(next)).toBe('theirs')
      expect(server.submitCalls.length).toBe(before)
      expect(server.nodes.get(FILE)?.name_encrypted).toBe('theirs')
      expect(memPending(next)).toEqual([])
      expect(storedPending()).toEqual([])
    })

    if (legacy) {
      // On the legacy server the POST answer never confirmed (main ignores
      // applied[]): the echo did. A reload between the answer and the echo
      // left the op pending with no record of the server's position.
      test('POST answered, echo not yet delivered: cleared on boot, not resubmitted, no tree clobber', async () => {
        server.record('file_create', { id: FILE, name_encrypted: 'start' })
        const client = await boot()

        server.otherUsersWrite(4)
        await client.submitOp(...rename('mine'))
        // Above the cursor: still pending, waiting for its echo.
        expect(storedPending().length).toBe(1)

        server.otherUsersWrite(4)
        server.record(...rename('theirs'))
        const before = server.submitCalls.length
        const next = await reload(client)

        expect(name(next)).toBe('theirs')
        expect(server.submitCalls.length).toBe(before)
        expect(server.nodes.get(FILE)?.name_encrypted).toBe('theirs')
        expect(storedPending()).toEqual([])
      })
    }
  })
}

describe('1973 r2 (d): a pending op that is NOT confirmed stays pending', () => {
  test('user_seq: a POST that never reached the server survives a snapshot, a reload and foreign ops, then is submitted once', async () => {
    server.record('file_create', { id: FILE, name_encrypted: 'start' }, 'someone-else')
    const client = await boot()

    server.submitMode = 'fail'
    await client.submitOp(...rename('mine'))
    const [ours] = storedPending()
    expect(ours).toBeDefined()

    // A covered op with ANOTHER client_op_id (a replayed frame) confirms nothing.
    feed(client, server.ops[0])
    // A snapshot that does not hold our op keeps the optimistic state.
    await resync(client)
    expect(memPending(client)).toEqual([ours])
    expect(name(client)).toBe('mine')

    // Reload: the op log has no trace of it, so it is resubmitted exactly once.
    server.submitMode = 'normal'
    const callsBefore = server.submitCalls.length
    const next = await reload(client)
    expect(server.submitCalls.slice(callsBefore)).toEqual([[ours]])
    expect(name(next)).toBe('mine')
    expect(server.nodes.get(FILE)?.name_encrypted).toBe('mine')
    expect(storedPending()).toEqual([])
  })

  test('legacy: an answered op is NOT cleared by a snapshot taken before its commit', async () => {
    server.numbered = false
    server.record('file_create', { id: FILE, name_encrypted: 'start' })
    const client = await boot()
    const older = server.snapshotNow() // fetched before our commit

    // No other user writes here, so the echo below is contiguous on the global seq.
    await client.submitOp(...rename('mine'))
    const [ours] = storedPending()
    expect(ours).toBeDefined()

    // The older snapshot merges after the answer: it does not hold the op.
    server.staleSnapshot = older
    await resync(client)
    expect(memPending(client)).toEqual([ours])
    expect(name(client)).toBe('mine')

    // Its echo, above the cursor, confirms it.
    feed(client, server.ops.find((o) => o.client_op_id === ours)!)
    expect(memPending(client)).toEqual([])
    expect(name(client)).toBe('mine')
  })
})

/**
 * Round 3 (Codex P2 at 04ad1c89): in user_seq mode a POST `applied[]` entry
 * from a node that predates server#233 carries no `user_seq`. The entry got a
 * recorded `applied_seq_id` and a null `applied_user_seq`. With the echo
 * missed, every numbered snapshot ignored the global position, and
 * `flushPending` never resubmits an entry with a position: it stayed pending
 * for good and was re-applied over every snapshot. Coverage now falls back to
 * the snapshot's global `seq_id` when the entry has no `user_seq`.
 */
describe('1973 r3 (a)/(b): user_seq mode, applied[] without user_seq, echo missed', () => {
  test('(a) a numbered snapshot past its seq_id clears it; it is not re-applied or resubmitted', async () => {
    server.record('file_create', { id: FILE, name_encrypted: 'start' })
    const client = await boot()

    server.oldNodeAnswers = true
    server.otherUsersWrite(5)
    await client.submitOp(...rename('mine'))
    const [ours] = storedPending()
    expect(ours).toBeDefined()
    expect(name(client)).toBe('mine')
    // The echo is missed (a dropped connection). Another device renames
    // afterwards; its frame is missed too, a snapshot brings it.
    server.oldNodeAnswers = false
    server.otherUsersWrite(3)
    server.record(...rename('theirs'))
    await resync(client)

    expect(memPending(client)).toEqual([])
    expect(storedPending()).toEqual([])
    expect(name(client)).toBe('theirs')

    const before = server.submitCalls.length
    const next = await reload(client)
    expect(server.submitCalls.length).toBe(before)
    expect(name(next)).toBe('theirs')
    expect(server.nodes.get(FILE)?.name_encrypted).toBe('theirs')
  })

  test('(b) a numbered snapshot NOT yet past its seq_id keeps it pending', async () => {
    server.record('file_create', { id: FILE, name_encrypted: 'start' })
    const client = await boot()
    const older = server.snapshotNow() // numbered, fetched before our commit
    expect(typeof older.user_seq).toBe('number')

    server.oldNodeAnswers = true
    server.otherUsersWrite(5)
    await client.submitOp(...rename('mine'))
    const [ours] = storedPending()
    expect(ours).toBeDefined()

    server.staleSnapshot = older
    await resync(client)
    expect(memPending(client)).toEqual([ours])
    expect(storedPending()).toEqual([ours])
    expect(name(client)).toBe('mine')
  })
})

/**
 * Round 3 (c), the invariant: every pending entry is either resubmitted (no
 * recorded position) or cleared by a snapshot that is far enough ahead,
 * numbered OR unnumbered (the client cannot choose which node answers). No
 * entry shape may sit in neither class. Driven through the real client: the
 * entry is persisted, the tab boots, then one more snapshot merges.
 */
describe('1973 r3 (c): no pending entry shape is uncleareable', () => {
  const shapes: { label: string; pos: Record<string, unknown>; recorded: boolean }[] = [
    { label: 'no position', pos: {}, recorded: false },
    { label: 'applied_seq_id null', pos: { applied_seq_id: null }, recorded: false },
    { label: 'both null', pos: { applied_seq_id: null, applied_user_seq: null }, recorded: false },
    { label: 'applied_user_seq only', pos: { applied_user_seq: 3 }, recorded: false },
    { label: 'applied_seq_id only', pos: { applied_seq_id: 5 }, recorded: true },
    { label: 'applied_seq_id + user_seq null', pos: { applied_seq_id: 5, applied_user_seq: null }, recorded: true },
    { label: 'applied_seq_id + user_seq', pos: { applied_seq_id: 5, applied_user_seq: 3 }, recorded: true },
  ]
  for (const numbered of [true, false]) {
    for (const s of shapes) {
      test(`${numbered ? 'numbered' : 'unnumbered'} snapshot, entry: ${s.label}`, async () => {
        server.numbered = numbered
        server.record('file_create', { id: FILE, name_encrypted: 'start' })
        for (let i = 2; i <= 6; i++) {
          server.otherUsersWrite(1)
          server.record('file_create', { id: `00000000-0000-4000-8000-00000000000${i}`, name_encrypted: `f${i}` })
        }
        // The snapshot is past every position in the table (seq 5, user_seq 3).
        expect(server.snapshotNow().seq_id).toBeGreaterThan(5)
        if (numbered) expect(server.snapshotNow().user_seq).toBeGreaterThan(3)
        const id = `r3-${numbered ? 'n' : 'u'}-${s.label.replace(/\W+/g, '-')}`
        storage.setItem(
          'bb_sync_pending_ops',
          JSON.stringify([
            {
              client_op_id: id,
              op_type: 'file_rename',
              payload: { id: FILE, new_name_encrypted: 'mine' },
              target_id: FILE,
              ...s.pos,
            },
          ]),
        )

        const client = await boot()
        await resync(client)

        expect(memPending(client)).toEqual([])
        expect(storedPending()).toEqual([])
        const sent = server.submitCalls.flat().filter((x) => x === id).length
        // A recorded op was applied: resubmitting it would execute it twice.
        expect(sent).toBe(s.recorded ? 0 : 1)
      })
    }
  }
})
