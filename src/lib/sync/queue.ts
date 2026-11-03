// ─── Sync pending-op queue ──────────────────────────
// The ops this tab submitted that the server has not confirmed yet. Persisted
// across reloads, confirmed by identity (`client_op_id`) or by a snapshot that
// covers their recorded position, and resubmitted only when the server never
// recorded them.

import type { SyncNode, SyncSnapshot, UserSeqSyncSnapshot } from '../api'
import { userSeqOf } from './protocol'

const PENDING_OPS_KEY = 'bb_sync_pending_ops'

export interface PendingOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
  /** Snapshot of the affected node before the op was applied (for rollback). */
  rollback?: SyncNode | null
  /** Logical id the op affects, used to look up the node. */
  target_id?: string
  /**
   * Task 1973 r2: where the server recorded this op, from POST `applied[]` or
   * found in the op log. Persisted: a snapshot (also the first one after a
   * reload) that covers this position already holds the op, so the entry is
   * confirmed then instead of being re-applied over the snapshot and resubmitted.
   */
  applied_seq_id?: number
  applied_user_seq?: number | null
  /**
   * Task 1973 r2: the global cursor when the op was submitted. The server
   * numbers the op above it, so an orphan lookup in the op log starts here.
   */
  submitted_after_seq?: number
}

/**
 * Task 1973 r3: true when the server recorded this pending op, i.e. it has a
 * finite `applied_seq_id`. ONE predicate decides both sides of the invariant:
 * `flushPending` resubmits exactly the entries without a recorded position, and
 * `pendingCoveredBy` can clear every entry with one (the `seq_id` comparison
 * needs nothing else, and every snapshot carries `seq_id`).
 */
export function hasRecordedPosition(p: Pick<PendingOp, 'applied_seq_id'>): boolean {
  return typeof p.applied_seq_id === 'number' && Number.isFinite(p.applied_seq_id)
}

/**
 * Task 1973 r2/r3: true when a snapshot already holds a pending op the server
 * recorded. Compared on `user_seq` when BOTH the snapshot and the entry carry
 * one (a user's ops commit in user_seq order). Otherwise on the global
 * `seq_id`, which every snapshot carries: the legacy coverage rule, and the
 * fallback for an entry whose POST `applied[]` came from a node that predates
 * server#233 (no `user_seq`) while the client is in user_seq mode (Codex P2 on
 * web#173 at 04ad1c89). Without that fallback such an entry was cleared by no
 * snapshot, and `flushPending` never resubmits it: if its echo was missed it
 * stayed pending for good and was re-applied over every snapshot.
 *
 * Invariant (test/1973-sync-pending-confirm.test.ts, "r3"): an entry with a recorded
 * position is cleared by a numbered AND by an unnumbered snapshot once that
 * snapshot is far enough ahead; an entry without one is resubmitted. No shape
 * is neither.
 */
export function pendingCoveredBy(p: PendingOp, snapSeq: number, snapUserSeq: number | null): boolean {
  if (!hasRecordedPosition(p)) return false
  const userSeq = p.applied_user_seq
  if (snapUserSeq !== null && typeof userSeq === 'number' && Number.isFinite(userSeq)) {
    return userSeq <= snapUserSeq
  }
  return (p.applied_seq_id as number) <= snapSeq
}

function loadPendingOps(): PendingOp[] {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : []
  } catch {
    return []
  }
}

/**
 * The ops this tab is waiting on. `ops` is the live array: the client iterates
 * it while confirming entries (a snapshot merge, a flush), so every mutation
 * goes through this class and persists at the same points it always did.
 */
export class SyncQueue {
  readonly ops: PendingOp[]
  /**
   * Task 1973 r2: pending ops the server may have recorded although this tab
   * never heard back: loaded from storage without a recorded position (the
   * page went away mid-POST), or whose POST failed. The next snapshot fetch
   * looks them up in the op log by `client_op_id` before merging.
   */
  private readonly orphaned: Set<string>

  /** `bootSeq` is the global cursor this tab booted with: the orphan lookup floor. */
  constructor(private readonly bootSeq: number) {
    this.ops = loadPendingOps()
    this.orphaned = new Set(
      this.ops.filter((p) => !hasRecordedPosition(p)).map((p) => p.client_op_id),
    )
  }

  get size(): number {
    return this.ops.length
  }

  has(clientOpId: string): boolean {
    return this.ops.some((p) => p.client_op_id === clientOpId)
  }

  find(clientOpId: string): PendingOp | undefined {
    return this.ops.find((p) => p.client_op_id === clientOpId)
  }

  /** Queue a locally submitted op and persist it. */
  add(op: PendingOp): void {
    this.ops.push(op)
    this.persist()
  }

  /**
   * Task 1973 r2: confirmation is by IDENTITY, never by sequence. A
   * server-applied op carrying this `client_op_id` (a stream echo, a catch-up
   * page, a POST `applied[]` entry, an op found in the op log) confirms and
   * clears its pending entry whatever its number is relative to the cursor;
   * only the TREE application of an op at or below the cursor is skipped.
   * Returns true when an entry was cleared.
   */
  confirm(clientOpId: string | null | undefined): boolean {
    if (!clientOpId) return false
    const idx = this.ops.findIndex((p) => p.client_op_id === clientOpId)
    if (idx === -1) return false
    this.ops.splice(idx, 1)
    this.persist()
    this.orphaned.delete(clientOpId)
    return true
  }

  /** Remove an entry without treating it as confirmed (a rejected op). */
  remove(clientOpId: string): PendingOp | null {
    const idx = this.ops.findIndex((p) => p.client_op_id === clientOpId)
    if (idx === -1) return null
    const [removed] = this.ops.splice(idx, 1)
    this.orphaned.delete(clientOpId)
    return removed
  }

  /** Task 1973 r2: confirm every pending op whose recorded position `snap` covers. */
  confirmCoveredBy(snap: SyncSnapshot): void {
    const snapUserSeq = userSeqOf(snap as UserSeqSyncSnapshot)
    const covered = this.ops.filter((p) => pendingCoveredBy(p, snap.seq_id, snapUserSeq))
    for (const p of covered) this.confirm(p.client_op_id)
  }

  /** Task 1973 r2: record the server's position for a pending op (persisted). */
  recordPosition(clientOpId: string, seqId: number, userSeq: number | null): boolean {
    const p = this.find(clientOpId)
    if (!p || typeof seqId !== 'number' || !Number.isFinite(seqId)) return false
    p.applied_seq_id = seqId
    p.applied_user_seq = userSeq
    this.orphaned.delete(clientOpId)
    return true
  }

  /**
   * The op was submitted but its answer is gone (network error): the server may
   * still have recorded it, so the next snapshot looks it up before merging.
   */
  markOrphaned(clientOpId: string): void {
    if (this.has(clientOpId)) this.orphaned.add(clientOpId)
  }

  isOrphaned(clientOpId: string): boolean {
    return this.orphaned.has(clientOpId)
  }

  get hasOrphans(): boolean {
    return this.orphaned.size > 0
  }

  /** The pending entries that still need an op-log lookup. */
  orphanCandidates(): PendingOp[] {
    return this.ops.filter((p) => this.orphaned.has(p.client_op_id))
  }

  /**
   * Where an orphan lookup starts: the earliest position any orphan was
   * submitted after, falling back to the cursor this tab booted with.
   */
  orphanLookupFloor(orphans: readonly PendingOp[]): number {
    return Math.min(...orphans.map((p) => p.submitted_after_seq ?? this.bootSeq))
  }

  /** One lookup per orphan: what is left was not found and stays pending. */
  clearOrphans(): void {
    this.orphaned.clear()
  }

  /** Entries the server never recorded: the only ones worth resubmitting. */
  unsent(): PendingOp[] {
    return this.ops.filter((p) => !hasRecordedPosition(p))
  }

  /** Write the queue to storage. */
  persist(): void {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(this.ops))
  }
}
