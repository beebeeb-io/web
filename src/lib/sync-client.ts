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
import type { SyncOp, SyncNode } from './api'

const LAST_SEQ_KEY = 'bb_sync_last_seq'
const PENDING_OPS_KEY = 'bb_sync_pending_ops'
const DEVICE_ID_KEY = 'bb_sync_device_id'

const RECONNECT_DELAY_MS = 1500
const RECONNECT_MAX_DELAY_MS = 30_000

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
  type: 'snapshot' | 'op' | 'status' | 'error'
  status?: ConnectionStatus
  error?: Error
  op?: SyncOp
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

  /** Boot. Idempotent — calling twice is a no-op. */
  async start(): Promise<void> {
    if (this.started || this.destroyed) return
    this.started = true
    this.setStatus('connecting')

    try {
      if (this.lastSeq === 0) {
        // Fresh device — load full snapshot.
        const snap = await getSnapshot()
        this.applySnapshot(snap)
      } else {
        // Returning device — catch up on missed ops.
        try {
          const ops = await getSyncOps(this.lastSeq)
          for (const op of ops) {
            this.applyRemoteOp(op)
          }
          // If catch-up returned no ops and tree is empty (page refresh
          // cleared in-memory state but lastSeq persisted), reload the
          // full snapshot so we don't show an empty drive.
          if (this.tree.size === 0) {
            const snap = await getSnapshot()
            this.applySnapshot(snap)
          }
        } catch (err) {
          // Catch-up failed — fall back to full snapshot to recover.
          console.warn('[SyncClient] catch-up failed, fetching snapshot', err)
          const snap = await getSnapshot()
          this.tree.clear()
          this.applySnapshot(snap)
        }
      }

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

  /** Tear down. Stream closed, last_seq persisted, pending ops kept. */
  stop(): void {
    this.destroyed = true
    this.started = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.setStatus('idle')
    this.listeners.clear()
  }

  private applySnapshot(snap: { seq_id: number; nodes: SyncNode[] }): void {
    for (const node of snap.nodes) {
      this.tree.set(node.id, node)
    }
    this.lastSeq = snap.seq_id
    saveLastSeq(this.lastSeq)
    this.emit({ type: 'snapshot' })
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
    const es = new EventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus('connected')
    }

    es.onmessage = (msg: MessageEvent<string>) => {
      try {
        const op = JSON.parse(msg.data) as SyncOp
        this.applyRemoteOp(op)
      } catch (err) {
        console.error('[SyncClient] Failed to parse SSE message', err)
      }
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
    // After a long disconnect, fetch any ops we missed before re-opening
    // the stream — gapless resume.
    try {
      const ops = await getSyncOps(this.lastSeq)
      for (const op of ops) {
        this.applyRemoteOp(op)
      }
    } catch (err) {
      console.warn('[SyncClient] reconnect catch-up failed', err)
    }
    void this.openStream()
  }

  /**
   * Apply a remote op (from SSE or catch-up) to the tree. If the op was
   * originally submitted by this client (echo), the optimistic update is
   * already in place — we just confirm it.
   */
  private applyRemoteOp(op: SyncOp): void {
    if (op.seq_id <= this.lastSeq) return // already applied

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

    this.applyOpToTree(op.op_type, op.payload)
    this.lastSeq = op.seq_id
    saveLastSeq(this.lastSeq)
    this.emit({ type: 'op', op })
  }

  /** Mutate the in-memory tree based on op type + payload. */
  private applyOpToTree(opType: string, payload: Record<string, unknown>): void {
    switch (opType) {
      case 'file_create':
      case 'folder_create': {
        const node = payloadToNode(payload, opType === 'folder_create')
        if (node) this.tree.set(node.id, node)
        break
      }
      case 'file_update': {
        const id = payload.id as string | undefined
        if (!id) return
        const existing = this.tree.get(id)
        if (!existing) return
        this.tree.set(id, {
          ...existing,
          size_bytes: (payload.size_bytes as number | undefined) ?? existing.size_bytes,
          version_number:
            (payload.version_number as number | undefined) ?? existing.version_number,
          content_hash:
            (payload.content_hash as string | undefined) ?? existing.content_hash,
          updated_at: new Date().toISOString(),
        })
        break
      }
      case 'file_move':
      case 'folder_move': {
        const id = payload.id as string | undefined
        if (!id) return
        const existing = this.tree.get(id)
        if (!existing) return
        this.tree.set(id, {
          ...existing,
          parent_id: (payload.new_parent_id as string | null | undefined) ?? null,
          updated_at: new Date().toISOString(),
        })
        break
      }
      case 'file_rename':
      case 'folder_rename': {
        const id = payload.id as string | undefined
        if (!id) return
        const existing = this.tree.get(id)
        if (!existing) return
        this.tree.set(id, {
          ...existing,
          name_encrypted:
            (payload.new_name_encrypted as string | undefined) ?? existing.name_encrypted,
          updated_at: new Date().toISOString(),
        })
        break
      }
      case 'file_trash': {
        const id = payload.id as string | undefined
        if (!id) return
        const existing = this.tree.get(id)
        if (existing) this.tree.set(id, { ...existing, is_trashed: true })
        break
      }
      case 'file_restore': {
        const id = payload.id as string | undefined
        if (!id) return
        const existing = this.tree.get(id)
        if (existing) this.tree.set(id, { ...existing, is_trashed: false })
        break
      }
      case 'file_delete': {
        const id = payload.id as string | undefined
        if (id) this.tree.delete(id)
        break
      }
      case 'share_create':
      case 'share_revoke':
        // Notification-only — UI listens for these to refresh share state.
        break
      default:
        // Unknown op type — keep going. Future protocol versions may add
        // new types and we don't want to crash on them.
        break
    }
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
    has_thumbnail: false,
    storage_pool_id: (payload.storage_pool_id as string | null | undefined) ?? null,
    is_trashed: false,
    is_starred: false,
    chunk_count: (payload.chunk_count as number | undefined) ?? 1,
    created_at: now,
    updated_at: now,
  }
}
