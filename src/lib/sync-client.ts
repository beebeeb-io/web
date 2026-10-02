// ─── CRDT sync client ───────────────────────────────
// SSE + op-log client for the Beebeeb sync engine. See
// docs/superpowers/specs/2026-05-02-crdt-sync-engine-design.md for the
// protocol. The server is the source of truth; clients send ops, the
// server assigns seq_ids and broadcasts via SSE.

import {
  getApiUrl,
  getSnapshot,
  getSyncOps,
  submitSyncOps,
  getStreamToken,
} from './api'
import type { SyncOp, SyncNode, SyncSnapshot } from './api'

const LAST_SEQ_KEY = 'bb_sync_last_seq'
const PENDING_OPS_KEY = 'bb_sync_pending_ops'
const DEVICE_ID_KEY = 'bb_sync_device_id'

const RECONNECT_DELAY_MS = 1500
const RECONNECT_MAX_DELAY_MS = 30_000

/**
 * Server op-log page cap (`GET /sync/ops`, server sync.rs). A response this
 * long means the backlog was truncated — only a snapshot merge can restore
 * full coverage (task 1700).
 */
const SYNC_OPS_PAGE_CAP = 1000
/** Debounce before a detected seq gap is filled from the op log. */
const GAP_FILL_DEBOUNCE_MS = 30
/** A gap-fill request that never answers must not stall coverage (task 1700). */
const GAP_FILL_TIMEOUT_MS = 10_000
/** Debounce for the coverage resync a missing-node op schedules. */
const MISSING_NODE_RESYNC_DEBOUNCE_MS = 100
/** Upper bound on out-of-order ops held while a gap is filled. */
const REORDER_BUFFER_MAX = 500
/**
 * Upper bound on stream frames held while a snapshot fetch is in flight. A
 * fetch is time-bounded, so this only guards against pathological storms.
 */
const DEFERRED_FRAMES_MAX = 10_000
/** Bound on a full-snapshot fetch: a hung request must never stall coverage. */
const SNAPSHOT_TIMEOUT_MS = 10_000

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface PendingOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
  /** Snapshot of the affected node before the op was applied (for rollback). */
  rollback?: SyncNode | null
  /** Logical id the op affects, used to look up the node. */
  target_id?: string
}

interface SyncEvent {
  /** `tree` = the tree changed outside the sequenced op log (e.g. a star). */
  type: 'snapshot' | 'op' | 'tree' | 'status' | 'error' | 'coverage'
  status?: ConnectionStatus
  error?: Error
  op?: SyncOp
  /** Set on `coverage`: true once a snapshot merged and the stream is contiguous. */
  complete?: boolean
}

type Listener = (event: SyncEvent) => void

function uuid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // Fallback: random bytes shaped into a v4 UUID.
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = uuid()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

function loadLastSeq(): number {
  const raw = localStorage.getItem(LAST_SEQ_KEY)
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function saveLastSeq(seq: number): void {
  localStorage.setItem(LAST_SEQ_KEY, String(seq))
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

function savePendingOps(ops: PendingOp[]): void {
  localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops))
}

/**
 * SyncClient owns the in-memory tree, the SSE connection, and the
 * pending-ops queue. UI layers subscribe via `subscribe()` to be notified
 * of tree changes.
 *
 * Lifecycle:
 *   const c = new SyncClient()
 *   await c.start()        // boot: snapshot or catch-up + open stream
 *   c.stop()               // close stream, keep last_seq in storage
 */
export class SyncClient {
  private tree = new Map<string, SyncNode>()
  private lastSeq = loadLastSeq()
  private pendingOps: PendingOp[] = loadPendingOps()
  private deviceId = getDeviceId()
  private eventSource: EventSource | null = null
  private status: ConnectionStatus = 'idle'
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<Listener>()
  private started = false
  private destroyed = false
  /**
   * Tree coverage (task 1700). True once a full snapshot has merged and the
   * sequenced stream has been contiguous since (no known hole). While false,
   * consumers must not treat an empty `children()` result as authoritative —
   * that is how a partial tree produced the false EmptyDrive.
   */
  private treeComplete = false
  /** True after a snapshot merge in this process; gates the coverage flag. */
  private coverageSnapshotMerged = false
  /** Out-of-order ops held by seq_id until the hole below them fills. */
  private reorderBuffer = new Map<number, SyncOp>()
  private gapFillTimer: ReturnType<typeof setTimeout> | null = null
  private gapFillInFlight: Promise<void> | null = null
  private gapFillAttempts = 0
  private resyncTimer: ReturnType<typeof setTimeout> | null = null
  private resyncInFlight: Promise<void> | null = null
  private resyncQueued = false
  private resyncAttempts = 0
  /** Ops whose node is missing at schedule time (resolved after the resync). */
  private pendingMissingIds = new Set<string>()
  /**
   * Ids a completed snapshot confirmed absent server-side. Repeat missing-node
   * ops for such an id must not trigger resync after resync (task 1700) — only
   * a genuinely unknown id (or a reconnect) retries.
   */
  private knownAbsentIds = new Set<string>()
  /**
   * Star ordering state (task 1577, PR #115 review). `file.starred` is a
   * realtime event, not a sequenced op, so it has no seq_id to order by.
   * - `starFrameAt`: server `timestamp` (ms) of the newest `file.starred`
   *   frame applied per file — an older frame for the same file is dropped.
   * - `starEchoes`: local-clock times of this client's own star PATCHes whose
   *   `file.starred` echo has not come back over the stream yet. While more
   *   than one is outstanding, an arriving frame predates a newer local write
   *   the tree already reflects, so it must not overwrite it.
   */
  private starFrameAt = new Map<string, number>()
  private starEchoes = new Map<string, number[]>()
  /**
   * In-flight single snapshot merge, shared by every resync caller (review
   * S1) — overlapping merges can never land out of order.
   */
  private snapshotInFlight: Promise<void> | null = null
  /** True while the snapshot HTTP fetch is outstanding — stream frames are held. */
  private snapshotFetchInFlight = false
  /** Frames held during a snapshot fetch, replayed right after the merge. */
  private deferredStreamFrames: StreamFrame[] = []
  /** Snapshot fetch bound; overridable so tests can exercise the timeout. */
  private readonly snapshotTimeoutMs: number

  constructor(options?: { snapshotTimeoutMs?: number }) {
    this.snapshotTimeoutMs = options?.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getLastSeq(): number {
    return this.lastSeq
  }

  getNode(id: string): SyncNode | undefined {
    return this.tree.get(id)
  }

  getAllNodes(): SyncNode[] {
    return Array.from(this.tree.values())
  }

  /** Children of a folder. `null`/`undefined` returns root nodes. */
  getChildren(parentId: string | null | undefined): SyncNode[] {
    const target = parentId ?? null
    const out: SyncNode[] = []
    for (const node of this.tree.values()) {
      if ((node.parent_id ?? null) === target) out.push(node)
    }
    return out
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[SyncClient] Listener error:', err)
      }
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit({ type: 'status', status })
  }

  /**
   * True once a snapshot has merged and the op stream has been contiguous
   * since (task 1700). UI layers use this to avoid treating a partial tree as
   * an empty vault. Exposed as a method so the sync context can mirror it.
   */
  isCoverageComplete(): boolean {
    return this.treeComplete
  }

  private setTreeComplete(complete: boolean): void {
    if (this.treeComplete === complete) return
    this.treeComplete = complete
    this.emit({ type: 'coverage', complete })
  }

  /** Recompute the coverage flag from the current buffering state. */
  private refreshCoverageFlag(): void {
    if (!this.coverageSnapshotMerged) return
    if (this.reorderBuffer.size > 0) return
    if (this.gapFillTimer || this.gapFillInFlight) return
    if (this.resyncTimer || this.resyncInFlight || this.resyncQueued) return
    this.setTreeComplete(true)
  }

  /** Boot. Idempotent — calling twice is a no-op. */
  async start(): Promise<void> {
    if (this.started || this.destroyed) return
    this.started = true
    this.setStatus('connecting')

    try {
      // Always establish full coverage from a snapshot (task 1700). The old
      // `tree.size === 0` heuristic trusted a catch-up that silently dropped
      // ops for unknown nodes, leaving root-level nodes missing — which the
      // drive read as an empty vault.
      await this.establishCoverage()

      this.openStream()

      // Flush any locally-queued ops from a prior session.
      if (this.pendingOps.length > 0) {
        void this.flushPending()
      }
    } catch (err) {
      this.started = false
      this.setStatus('disconnected')
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      throw err
    }
  }

  /**
   * Merge a full snapshot, then apply the op tail AFTER the snapshot position.
   * Merge-only + idempotent: the tree is never cleared, so a snapshot can
   * never turn a populated vault into an empty one. `lastSeq` only ever moves
   * forward, to `max(stream, snapshot)`.
   *
   * Review B1: the persisted op position can be thousands of ops behind the
   * snapshot. Replaying that window over the newer snapshot would clobber its
   * state (a stale rename/size/parent/trash inside the first LIMIT-1000 page
   * would win), so the snapshot advances `lastSeq` BEFORE any catch-up and the
   * tail is fetched from the snapshot position.
   */
  private async establishCoverage(): Promise<void> {
    this.setTreeComplete(false)
    // A reconnect/first boot may see nodes the last snapshot confirmed absent.
    this.knownAbsentIds.clear()
    this.pendingMissingIds.clear()
    await this.resyncSnapshot()
    try {
      const { truncated } = await this.catchUpOps()
      if (truncated) {
        // The tail itself exceeds one server page — merge a newer snapshot
        // rather than silently skipping the rest of it.
        await this.resyncSnapshot()
      }
    } catch (err) {
      // The snapshot already covers everything up to its seq_id; the op tail
      // is best-effort and a buffered hole re-triggers a gap fill on its own.
      console.warn('[SyncClient] op catch-up after snapshot failed', err)
    }
    if (this.reorderBuffer.size > 0) this.scheduleGapFill()
    this.refreshCoverageFlag()
  }

  /** Apply the op tail after `lastSeq`; report a server-truncated backlog. */
  private async catchUpOps(): Promise<{ truncated: boolean }> {
    const ops = await getSyncOps(this.lastSeq)
    for (const op of ops) {
      this.applyRemoteOp(op)
    }
    return { truncated: ops.length >= SYNC_OPS_PAGE_CAP }
  }

  /**
   * Merge snapshot nodes into the tree (task 1700), then reconcile absence.
   *
   * - A pending-target node is preserved ONLY when the tree actually holds its
   *   optimistic state: a persisted pending op on a fresh page load starts
   *   from an empty tree, and skipping its target would leave the file absent
   *   forever (the echo confirms without mutating the tree). PR #130 review.
   * - Nodes absent from the snapshot are pruned unless trashed (the server
   *   snapshot excludes trashed items — absence is not a deletion signal for
   *   them) or the target of a pending op. Coverage is marked complete only
   *   after this prune, by the caller. PR #130 review.
   * - Persisted pending ops whose optimistic state is not in the tree are
   *   re-applied over the snapshot so the echo stays a pure confirmation.
   *   PR #130 review.
   */
  private mergeSnapshot(snap: { seq_id: number; nodes: SyncNode[] }): void {
    const pendingTargets = new Set<string>()
    for (const p of this.pendingOps) {
      if (p.target_id) pendingTargets.add(p.target_id)
    }
    const snapshotIds = new Set<string>()
    for (const node of snap.nodes) {
      snapshotIds.add(node.id)
      if (pendingTargets.has(node.id) && this.tree.has(node.id)) continue
      this.tree.set(node.id, node)
    }
    for (const [id, node] of this.tree) {
      if (snapshotIds.has(id)) continue
      if (node.is_trashed) continue
      if (pendingTargets.has(id)) continue
      this.tree.delete(id)
    }
    for (const p of this.pendingOps) {
      this.applyOpToTree(p.op_type, p.payload)
    }
    this.emit({ type: 'snapshot' })
  }

  private dropBufferedThrough(seq: number): void {
    for (const [buffered] of this.reorderBuffer) {
      if (buffered <= seq) this.reorderBuffer.delete(buffered)
    }
  }

  /** Tear down. Stream closed, last_seq persisted, pending ops kept. */
  stop(): void {
    this.destroyed = true
    this.started = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.gapFillTimer) {
      clearTimeout(this.gapFillTimer)
      this.gapFillTimer = null
    }
    if (this.resyncTimer) {
      clearTimeout(this.resyncTimer)
      this.resyncTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    // Round-3 hygiene: drop held frames and snapshot state. In-flight
    // continuations are gated by `destroyed`, so this only releases memory.
    this.deferredStreamFrames.length = 0
    this.snapshotInFlight = null
    this.snapshotFetchInFlight = false
    this.setStatus('idle')
    this.listeners.clear()
  }

  private async openStream(): Promise<void> {
    if (this.destroyed) return
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    let token: string
    try {
      const tokenResp = await getStreamToken()
      token = tokenResp.stream_token
    } catch (err) {
      this.scheduleReconnect()
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      return
    }

    const url = `${getApiUrl()}/api/v1/sync/stream?token=${encodeURIComponent(token)}`
    // Echoes published while no stream was open are gone for good; waiting
    // for them would swallow the next genuine frame for that file.
    this.starEchoes.clear()
    const es = new EventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus('connected')
    }

    es.onmessage = (msg: MessageEvent<string>) => {
      this.ingestStreamFrame(msg.data)
    }

    es.onerror = () => {
      // The browser auto-reconnects EventSource, but we want our own
      // backoff + token refresh so we manage it explicitly.
      es.close()
      this.eventSource = null
      if (this.destroyed) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    if (this.reconnectTimer) return
    this.setStatus('reconnecting')
    const delay = Math.min(
      RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    )
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect()
    }, delay)
  }

  private async reconnect(): Promise<void> {
    if (this.destroyed) return
    // Always re-establish full coverage (task 1700): a disconnect can span
    // more ops than the server's op log retains, so an ops-only catch-up is
    // not guaranteed gapless.
    try {
      await this.establishCoverage()
    } catch (err) {
      console.warn('[SyncClient] reconnect coverage failed', err)
    }
    void this.openStream()
  }

  /**
   * Handle one raw frame from `/sync/stream`.
   *
   * The server's SSE stream forwards EVERY message on the user's event bus —
   * both sequenced sync ops (`{ seq_id, op_type, payload }`) and the realtime
   * events the WebSocket also carries (`{ type: 'file.starred', data }`, …).
   * Before task 1577 every frame was treated as a sync op: a realtime event
   * fell through `applyOpToTree`'s default branch, overwrote `lastSeq` with
   * `undefined`, and still emitted a tree change. The drive re-derived its
   * rows from a tree that had never learned the star → the row reverted to
   * "Star" whenever that frame landed after the PATCH response.
   *
   * Exposed (not private) so unit tests can feed frames without an
   * EventSource.
   */
  ingestStreamFrame(raw: string): void {
    let frame: StreamFrame
    try {
      frame = classifyStreamFrame(JSON.parse(raw))
    } catch (err) {
      console.error('[SyncClient] Failed to parse SSE message', err)
      return
    }
    if (this.snapshotFetchInFlight && (frame.kind === 'op' || frame.kind === 'starred')) {
      // A snapshot fetched before this frame landed would overwrite its tree
      // state — hold the frame and replay it right after the merge (review S1).
      if (this.deferredStreamFrames.length >= DEFERRED_FRAMES_MAX) {
        // Never grow without bound. `lastSeq` does not advance for dropped
        // frames, so a fresh coverage resync supersedes them; schedule one so
        // a failed in-flight fetch can't leave treeComplete=false until
        // reconnect (round-3 hardening).
        this.deferredStreamFrames.length = 0
        this.coverageSnapshotMerged = false
        this.setTreeComplete(false)
        this.scheduleCoverageResync()
      }
      this.deferredStreamFrames.push(frame)
      return
    }
    this.dispatchStreamFrame(frame)
  }

  private dispatchStreamFrame(frame: StreamFrame): void {
    switch (frame.kind) {
      case 'op':
        this.applyRemoteOp(frame.op)
        break
      case 'starred':
        this.applyStarredFrame(frame.id, frame.isStarred, frame.at)
        break
      case 'ignore':
        // A realtime event with no tree-state effect: leave lastSeq and the
        // tree alone, and do not bump listeners (a bump with an unchanged tree
        // just makes every consumer re-derive for nothing).
        break
    }
  }

  /** Replay frames held while a snapshot fetch was in flight. */
  private replayDeferredFrames(): void {
    if (this.deferredStreamFrames.length === 0) return
    const frames = this.deferredStreamFrames
    this.deferredStreamFrames = []
    for (const frame of frames) this.dispatchStreamFrame(frame)
  }

  /**
   * Record this client's own star write — the authoritative
   * `PATCH /files/:id/star` response — in the tree, so a later tree-driven
   * re-derive keeps it instead of reverting it. The server publishes exactly
   * one `file.starred` frame per PATCH; that echo is counted as outstanding
   * so a frame from an OLDER write (star → unstar, the star's frame delayed
   * past the unstar's response) cannot restore the superseded value.
   * Stars are not sequenced sync ops, so this never touches `lastSeq`.
   */
  setNodeStarred(id: string, isStarred: boolean): void {
    const now = Date.now()
    const echoes = this.liveStarEchoes(id, now)
    echoes.push(now)
    this.starEchoes.set(id, echoes)
    this.writeStarred(id, isStarred)
  }

  /**
   * Apply a `file.starred` frame from `/sync/stream`. The SSE stream is the
   * ONLY realtime source allowed to write star state into the tree (the drive
   * WebSocket handler no longer does): one ordered connection, so two
   * deliveries of the same event can never be reordered against each other.
   * On top of that ordering:
   * 1. a frame whose server timestamp is older than the newest applied for
   *    this file is dropped (publishes from different API nodes reach the
   *    stream via the bridge and are not guaranteed to be in commit order);
   * 2. every frame consumes one outstanding local echo — the oldest — and is
   *    applied only when no newer local write is still waiting for its echo.
   * Every PATCH yields exactly one frame, so once the echoes drain the tree
   * holds the value of the last frame the server published: eventually
   * correct even when another device toggles concurrently.
   */
  private applyStarredFrame(id: string, isStarred: boolean, at: number | undefined): void {
    const echoes = this.liveStarEchoes(id, Date.now())
    if (echoes.length > 0) echoes.shift()
    if (echoes.length > 0) this.starEchoes.set(id, echoes)
    else this.starEchoes.delete(id)

    if (at !== undefined) {
      const newest = this.starFrameAt.get(id)
      if (newest !== undefined && at < newest) return
      this.starFrameAt.set(id, at)
    }
    if (echoes.length > 0) return
    this.writeStarred(id, isStarred)
  }

  /** Outstanding local echoes for `id`, minus any too old to still arrive. */
  private liveStarEchoes(id: string, now: number): number[] {
    return (this.starEchoes.get(id) ?? []).filter((t) => now - t < STAR_ECHO_TTL_MS)
  }

  /** Write a star value into the tree; emits a tree change only on a move. */
  private writeStarred(id: string, isStarred: boolean): void {
    const existing = this.tree.get(id)
    if (!existing || Boolean(existing.is_starred) === isStarred) return
    this.tree.set(id, { ...existing, is_starred: isStarred })
    this.emit({ type: 'tree' })
  }

  /**
   * Apply a remote op (from SSE or catch-up) to the tree. Ops must arrive in
   * seq order: a future op is held in a bounded reorder buffer until the hole
   * below it is filled (task 1700), instead of the old drop-with-advance that
   * silently lost updates. If the op was originally submitted by this client
   * (echo), the optimistic update is already in place — we just confirm it.
   */
  private applyRemoteOp(op: SyncOp): void {
    if (op.seq_id <= this.lastSeq) return // already applied

    if (op.seq_id === this.lastSeq + 1) {
      this.applyOpNow(op)
      this.drainReorderBuffer()
      if (this.reorderBuffer.size > 0) {
        this.setTreeComplete(false)
        this.scheduleGapFill()
      } else {
        this.refreshCoverageFlag()
      }
      return
    }

    // Future op: hold it until the hole below it is filled.
    this.reorderBuffer.set(op.seq_id, op)
    if (this.reorderBuffer.size > REORDER_BUFFER_MAX) {
      // Buffer exhausted — a snapshot merge is the bounded fallback, routed
      // through the single-flight/retry path (review S1).
      this.reorderBuffer.clear()
      this.coverageSnapshotMerged = false
      this.setTreeComplete(false)
      this.scheduleCoverageResync()
      return
    }
    this.setTreeComplete(false)
    this.scheduleGapFill()
  }

  /** Apply every buffered op that is now contiguous with `lastSeq`. */
  private drainReorderBuffer(): void {
    for (;;) {
      const next = this.reorderBuffer.get(this.lastSeq + 1)
      if (!next) break
      this.reorderBuffer.delete(next.seq_id)
      this.applyOpNow(next)
    }
  }

  /**
   * Apply one in-order op, preserving the original echo/pending-op semantics:
   * a locally submitted op already applied optimistically is only confirmed
   * here. A missing-node op schedules a debounced coverage resync instead of
   * being silently dropped (task 1700).
   */
  private applyOpNow(op: SyncOp): void {
    // Echo suppression.
    if (op.client_op_id) {
      const idx = this.pendingOps.findIndex((p) => p.client_op_id === op.client_op_id)
      if (idx !== -1) {
        this.pendingOps.splice(idx, 1)
        savePendingOps(this.pendingOps)
        // Tree already reflects the change locally — only update seq.
        this.lastSeq = op.seq_id
        saveLastSeq(this.lastSeq)
        this.emit({ type: 'op', op })
        return
      }
    }

    const applied = this.applyOpToTree(op.op_type, op.payload)
    this.lastSeq = op.seq_id
    saveLastSeq(this.lastSeq)
    this.emit({ type: 'op', op })

    if (applied === 'missing-node') {
      // The op targets a node the tree has never seen (restore/rename/move/
      // update/trash). The full snapshot is the only authoritative backfill —
      // do not fabricate node fields (task 1700).
      const id = op.payload.id as string | undefined
      if (id && this.knownAbsentIds.has(id)) {
        // A completed snapshot already confirmed this id is absent
        // server-side — do not resync again for every repeat op.
        return
      }
      if (id) this.pendingMissingIds.add(id)
      this.coverageSnapshotMerged = false
      this.setTreeComplete(false)
      this.scheduleCoverageResync()
    }
  }

  /** Mutate the in-memory tree based on op type + payload. */
  private applyOpToTree(
    opType: string,
    payload: Record<string, unknown>,
  ): 'applied' | 'missing-node' {
    switch (opType) {
      case 'file_create':
      case 'folder_create': {
        const node = payloadToNode(payload, opType === 'folder_create')
        if (node) {
          this.tree.set(node.id, node)
          // The id exists now — a later missing-node op must resync again.
          this.knownAbsentIds.delete(node.id)
        }
        return 'applied'
      }
      case 'file_update': {
        const id = payload.id as string | undefined
        if (!id) return 'applied'
        const existing = this.tree.get(id)
        if (!existing) return 'missing-node'
        this.tree.set(id, {
          ...existing,
          size_bytes: (payload.size_bytes as number | undefined) ?? existing.size_bytes,
          version_number:
            (payload.version_number as number | undefined) ?? existing.version_number,
          content_hash:
            (payload.content_hash as string | undefined) ?? existing.content_hash,
          has_thumbnail:
            (payload.has_thumbnail as boolean | undefined) ?? existing.has_thumbnail,
          has_large_thumbnail:
            (payload.has_large_thumbnail as boolean | undefined) ?? existing.has_large_thumbnail,
          updated_at: new Date().toISOString(),
        })
        return 'applied'
      }
      case 'file_move':
      case 'folder_move': {
        const id = payload.id as string | undefined
        if (!id) return 'applied'
        const existing = this.tree.get(id)
        if (!existing) return 'missing-node'
        this.tree.set(id, {
          ...existing,
          parent_id: (payload.new_parent_id as string | null | undefined) ?? null,
          updated_at: new Date().toISOString(),
        })
        return 'applied'
      }
      case 'file_rename':
      case 'folder_rename': {
        const id = payload.id as string | undefined
        if (!id) return 'applied'
        const existing = this.tree.get(id)
        if (!existing) return 'missing-node'
        this.tree.set(id, {
          ...existing,
          name_encrypted:
            (payload.new_name_encrypted as string | undefined) ?? existing.name_encrypted,
          updated_at: new Date().toISOString(),
        })
        return 'applied'
      }
      case 'file_trash': {
        const id = payload.id as string | undefined
        if (!id) return 'applied'
        const existing = this.tree.get(id)
        if (!existing) return 'missing-node'
        this.tree.set(id, { ...existing, is_trashed: true })
        return 'applied'
      }
      case 'file_restore': {
        const id = payload.id as string | undefined
        if (!id) return 'applied'
        const existing = this.tree.get(id)
        if (!existing) return 'missing-node'
        this.tree.set(id, { ...existing, is_trashed: false })
        return 'applied'
      }
      case 'file_delete': {
        const id = payload.id as string | undefined
        if (id) this.tree.delete(id)
        return 'applied'
      }
      case 'share_create':
      case 'share_revoke':
        // Notification-only — UI listens for these to refresh share state.
        return 'applied'
      default:
        // Unknown op type — keep going. Future protocol versions may add
        // new types and we don't want to crash on them.
        return 'applied'
    }
  }

  // ─── Coverage recovery (task 1700) ─────────────────────────────────────
  // A seq gap is filled from the op log; if that errors, times out, or hits
  // the server page cap, a snapshot merge is the bounded fallback. Both paths
  // are single-flight and time-bounded so coverage can never stall forever.

  private scheduleGapFill(): void {
    if (this.destroyed || this.gapFillTimer || this.gapFillInFlight) return
    if (this.reorderBuffer.size === 0) return
    // Back off exponentially across failed attempts (capped): a persistently
    // failing server must not be hammered by the recovery path (task 1700).
    const delay = Math.min(GAP_FILL_DEBOUNCE_MS * 2 ** this.gapFillAttempts, 5_000)
    this.gapFillTimer = setTimeout(() => {
      this.gapFillTimer = null
      void this.runGapFill()
    }, delay)
  }

  private async runGapFill(): Promise<void> {
    if (this.destroyed || this.gapFillInFlight || this.reorderBuffer.size === 0) return
    if (this.snapshotFetchInFlight) {
      // Round-3 review: a snapshot merge is in flight. Applying op-log results
      // now would let the pending (older) snapshot overwrite them afterwards.
      // Leave the buffer intact — resyncSnapshot's finally re-arms this fill.
      return
    }
    const run = (async () => {
      try {
        const ops = await this.withTimeout(getSyncOps(this.lastSeq), GAP_FILL_TIMEOUT_MS)
        if (this.snapshotFetchInFlight) {
          // A coverage resync started while the op page was in flight: the
          // same hold applies. Do NOT apply anything an older snapshot would
          // overwrite; the finally below re-arms once the merge settles.
          return
        }
        if (ops.length >= SYNC_OPS_PAGE_CAP) {
          // Truncated backlog — the snapshot merges the whole thing.
          await this.resyncSnapshot()
          return
        }
        for (const op of ops) {
          this.applyRemoteOp(op)
        }
        if (this.reorderBuffer.size > 0) {
          // The op log no longer reaches the hole (purged server-side).
          await this.resyncSnapshot()
        }
      } catch (err) {
        console.warn('[SyncClient] gap-fill failed, falling back to snapshot', err)
        await this.resyncSnapshot().catch(() => {})
      } finally {
        this.gapFillInFlight = null
        if (this.reorderBuffer.size > 0) {
          this.gapFillAttempts += 1
          this.scheduleGapFill()
        } else {
          this.gapFillAttempts = 0
          this.refreshCoverageFlag()
        }
      }
    })()
    this.gapFillInFlight = run
    await run
  }

  /** Debounced single-flight snapshot merge for missing-node ops. */
  private scheduleCoverageResync(): void {
    if (this.destroyed) return
    if (this.resyncInFlight || this.snapshotInFlight) {
      // A snapshot merge is already running; queue exactly one follow-up so a
      // coverage hole (missing node, dropped held frames) cannot be masked by
      // the in-flight fetch. resyncSnapshot's wrapper runs it as a FRESH fetch.
      this.resyncQueued = true
      return
    }
    if (this.resyncTimer) return
    // Retries back off exponentially (capped) after a failed snapshot fetch.
    const delay = Math.min(MISSING_NODE_RESYNC_DEBOUNCE_MS * 2 ** this.resyncAttempts, 10_000)
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null
      void this.runCoverageResync()
    }, delay)
  }

  private async runCoverageResync(): Promise<void> {
    if (this.destroyed || this.resyncInFlight) return
    let ok = false
    this.resyncInFlight = (async () => {
      try {
        await this.resyncSnapshot()
        ok = true
      } catch (err) {
        console.warn('[SyncClient] coverage resync failed', err)
      } finally {
        this.resyncInFlight = null
        if (this.resyncQueued) {
          this.resyncQueued = false
          this.resyncAttempts = 0
          this.scheduleCoverageResync()
        } else if (!ok && !this.destroyed) {
          // Retry with backoff — a transient failure must not leave coverage
          // incomplete forever, and a persistent one must not spin.
          this.resyncAttempts += 1
          this.scheduleCoverageResync()
        } else {
          this.resyncAttempts = 0
          this.refreshCoverageFlag()
        }
      }
    })()
    await this.resyncInFlight
  }

  /**
   * Merge a fresh snapshot once — single-flight across ALL callers (boot,
   * reconnect, gap-cap, gap-error, missing-node, overflow) and time-bounded
   * (review S1). Stream frames arriving during the fetch are held and replayed
   * after the merge, and gap-fill refuses to apply op-log results while a
   * fetch is in flight (round-3 review) — every op-application path is either
   * before this fetch started or replayed after the merge, so an older
   * snapshot cannot overwrite newer op state.
   */
  private resyncSnapshot(): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    if (this.snapshotInFlight) return this.snapshotInFlight
    const run = (async () => {
      this.setTreeComplete(false)
      this.snapshotFetchInFlight = true
      let snap: SyncSnapshot
      try {
        snap = await this.withTimeout(getSnapshot(), this.snapshotTimeoutMs)
      } finally {
        this.snapshotFetchInFlight = false
      }
      this.mergeSnapshot(snap)
      if (snap.seq_id > this.lastSeq) {
        this.lastSeq = snap.seq_id
        saveLastSeq(this.lastSeq)
        this.dropBufferedThrough(this.lastSeq)
      }
      // Snapshot is authoritative for the missing ids that scheduled it: a
      // node that is still absent is genuinely gone — never resync for it
      // again until a reconnect or a create brings it back (task 1700).
      for (const id of this.pendingMissingIds) {
        if (this.tree.has(id)) this.knownAbsentIds.delete(id)
        else this.knownAbsentIds.add(id)
      }
      this.pendingMissingIds.clear()
      this.coverageSnapshotMerged = true
    })()
    const wrapped = (async () => {
      try {
        await run
      } finally {
        this.snapshotInFlight = null
        this.replayDeferredFrames()
        if (this.resyncQueued && !this.resyncInFlight) {
          // A resync was requested while this fetch ran (dropped held frames)
          // and needs a FRESH fetch — the settled snapshot may predate the
          // frames that requested it (round-3 hardening).
          this.resyncQueued = false
          this.resyncAttempts = 0
          void this.runCoverageResync()
        }
        if (this.reorderBuffer.size > 0) this.scheduleGapFill()
        this.refreshCoverageFlag()
      }
    })()
    this.snapshotInFlight = wrapped
    return wrapped
  }

  /** Bound a sync request so coverage recovery can never hang indefinitely. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`sync request timed out after ${ms}ms`))
      }, ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })
  }

  /**
   * Submit a local op. Applies optimistically, queues for the server,
   * rolls back on rejection.
   */
  async submitOp(opType: string, payload: Record<string, unknown>): Promise<{
    accepted: boolean
    reason?: string
  }> {
    const clientOpId = uuid()
    const targetId = (payload.id as string | undefined) ?? null
    const rollback = targetId ? this.tree.get(targetId) ?? null : null

    // Optimistic local apply.
    this.applyOpToTree(opType, payload)

    const pending: PendingOp = {
      client_op_id: clientOpId,
      op_type: opType,
      payload,
      rollback,
      target_id: targetId ?? undefined,
    }
    this.pendingOps.push(pending)
    savePendingOps(this.pendingOps)
    this.emit({ type: 'op' })

    try {
      const result = await submitSyncOps([
        {
          client_op_id: clientOpId,
          op_type: opType,
          payload,
          device_id: this.deviceId,
        },
      ])

      const rejected = result.rejected.find((r) => r.client_op_id === clientOpId)
      if (rejected) {
        // Remove from pending and roll back the local change.
        const idx = this.pendingOps.findIndex((p) => p.client_op_id === clientOpId)
        if (idx !== -1) {
          this.pendingOps.splice(idx, 1)
          savePendingOps(this.pendingOps)
        }
        if (targetId) {
          if (rollback) this.tree.set(targetId, rollback)
          else this.tree.delete(targetId)
        }
        // Apply the winning op if present.
        if (rejected.winning_op) {
          this.applyOpToTree(rejected.winning_op.op_type, rejected.winning_op.payload)
        }
        this.emit({ type: 'op' })
        return { accepted: false, reason: rejected.reason ?? 'rejected' }
      }
      // Accepted ops stay in pending until echoed via SSE — that confirms
      // the server's seq_id assignment.
      return { accepted: true }
    } catch (err) {
      // Network error — leave it in pending; we'll flush on reconnect.
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      return { accepted: true } // optimistic state stays
    }
  }

  private async flushPending(): Promise<void> {
    if (this.pendingOps.length === 0) return
    const batch = this.pendingOps.map((p) => ({
      client_op_id: p.client_op_id,
      op_type: p.op_type,
      payload: p.payload,
      device_id: this.deviceId,
    }))
    try {
      const result = await submitSyncOps(batch)
      for (const rej of result.rejected) {
        const idx = this.pendingOps.findIndex((p) => p.client_op_id === rej.client_op_id)
        if (idx === -1) continue
        const [pending] = this.pendingOps.splice(idx, 1)
        if (pending.target_id) {
          if (pending.rollback) this.tree.set(pending.target_id, pending.rollback)
          else this.tree.delete(pending.target_id)
        }
        if (rej.winning_op) {
          this.applyOpToTree(rej.winning_op.op_type, rej.winning_op.payload)
        }
      }
      savePendingOps(this.pendingOps)
      this.emit({ type: 'op' })
    } catch (err) {
      console.warn('[SyncClient] Failed to flush pending ops', err)
    }
  }
}

function payloadToNode(
  payload: Record<string, unknown>,
  isFolder: boolean,
): SyncNode | null {
  const id = payload.id as string | undefined
  if (!id) return null
  const now = new Date().toISOString()
  return {
    id,
    name_encrypted: (payload.name_encrypted as string | undefined) ?? '',
    parent_id: (payload.parent_id as string | null | undefined) ?? null,
    is_folder: isFolder,
    size_bytes: (payload.size_bytes as number | undefined) ?? 0,
    mime_type: (payload.mime_type as string | null | undefined) ?? null,
    content_hash: (payload.content_hash as string | null | undefined) ?? null,
    version_number: (payload.version_number as number | undefined) ?? 1,
    has_thumbnail: (payload.has_thumbnail as boolean | undefined) ?? false,
    has_large_thumbnail: (payload.has_large_thumbnail as boolean | undefined) ?? false,
    storage_pool_id: (payload.storage_pool_id as string | null | undefined) ?? null,
    is_trashed: false,
    is_starred: false,
    chunk_count: (payload.chunk_count as number | undefined) ?? 1,
    created_at: now,
    updated_at: now,
  }
}

/**
 * How long a local star write waits for its `file.starred` echo before it
 * stops holding back other frames for that file. The echo is published before
 * the PATCH response is sent, so it normally lands within milliseconds; the
 * TTL only bounds the damage of an echo lost to a dropped stream.
 */
const STAR_ECHO_TTL_MS = 15_000

/** A `/sync/stream` frame, classified. See `SyncClient.ingestStreamFrame`. */
export type StreamFrame =
  | { kind: 'op'; op: SyncOp }
  | { kind: 'starred'; id: string; isStarred: boolean; at?: number }
  | { kind: 'ignore' }

/**
 * Classify a parsed `/sync/stream` frame. A sequenced sync op carries a
 * numeric `seq_id` and a string `op_type`; anything else is a realtime
 * event-bus message (`{ type, data }`, serialised by the server's
 * `#[serde(tag = "type", content = "data")] enum SyncEvent`). Of those, only
 * `file.starred` (`data: { id, is_starred }`) carries node state the tree
 * must mirror — every other realtime event already has a matching sync op
 * or no tree effect.
 */
export function classifyStreamFrame(frame: unknown): StreamFrame {
  if (!frame || typeof frame !== 'object') return { kind: 'ignore' }
  const f = frame as Record<string, unknown>
  if (typeof f.seq_id === 'number' && Number.isFinite(f.seq_id) && typeof f.op_type === 'string') {
    return { kind: 'op', op: f as unknown as SyncOp }
  }
  if (f.type === 'file.starred' && f.data && typeof f.data === 'object') {
    const d = f.data as Record<string, unknown>
    if (typeof d.id === 'string' && typeof d.is_starred === 'boolean') {
      // `timestamp` is the server's publish time (event_bus.rs
      // TimestampedEvent, RFC 3339). Absent/unparseable → no time ordering.
      const at = typeof f.timestamp === 'string' ? Date.parse(f.timestamp) : NaN
      return Number.isFinite(at)
        ? { kind: 'starred', id: d.id, isStarred: d.is_starred, at }
        : { kind: 'starred', id: d.id, isStarred: d.is_starred }
    }
  }
  return { kind: 'ignore' }
}
