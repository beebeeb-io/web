// ─── Sync wire shapes ───────────────────────────────
// What `/sync/stream` and the op log put on the wire, turned into the shapes the
// client reasons about: a classified stream frame, an op's user_seq, and a node
// built from a create op's payload.

import type { SyncNode, SyncOp, UserSeqSyncOp } from '../api'

/**
 * Task 1973: the op's number in its user's own gap-free sequence, or null when
 * the server did not number it (an op recorded before server#233, or a frame
 * from an older node during a rolling deploy).
 */
export function userSeqOf(op: { user_seq?: number | null }): number | null {
  const n = op.user_seq
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

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

/**
 * Build the tree node a create op describes. A create op carries everything the
 * node needs, so the tree can show it before the next snapshot.
 */
export function payloadToNode(
  payload: Record<string, unknown>,
  isFolder: boolean,
): SyncNode | null {
  const id = payload.id as string | undefined
  if (!id) return null
  const now = new Date().toISOString()
  return {
    id,
    name_encrypted: (payload.name_encrypted as string | undefined) ?? '',
    file_request_id: (payload.file_request_id as string | null | undefined) ?? null,
    sender_ephemeral_pubkey: (payload.sender_ephemeral_pubkey as string | null | undefined) ?? null,
    wrapped_content_key: (payload.wrapped_content_key as string | null | undefined) ?? null,
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
    system_role: (payload.system_role as string | null | undefined) ?? null,
    created_at: now,
    updated_at: now,
  }
}

/** The key a held op is ordered by in the current mode; null = not orderable. */
export function opOrderKey(op: SyncOp, userSeqMode: boolean): number | null {
  return userSeqMode ? userSeqOf(op as UserSeqSyncOp) : op.seq_id
}
