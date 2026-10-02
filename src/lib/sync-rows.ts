// ─── Sync-derived drive rows: no-clobber + no-redraw decisions (task 1700) ───
//
// The drive list is re-derived from the sync tree on every treeVersion bump.
// Under a foreign bulk sync those bumps arrive for unrelated ops, and a tree
// that is temporarily incomplete must never be read as "the vault is empty".
// These pure decisions keep `refreshFromSync` (drive.tsx) from writing the
// list state when nothing changed, from clobbering a good list with a
// transient empty derive, and from flashing EmptyDrive on a delete+create
// burst.

import type { DriveFile } from './api'

/**
 * How long an all-empty derive waits for confirmation before it may be
 * applied. A delete op followed by a create op inside this window must not
 * flash the empty state (task 1700).
 */
export const EMPTY_CONFIRM_MS = 250

/**
 * Cheap row identity: id + the fields the list renders on
 * (id+name+size+updated_at+parent+flags). Two derivations with the same
 * signature are the same rows — the caller must not touch list state.
 */
export function rowsSignature(rows: DriveFile[]): string {
  const parts: string[] = []
  for (const f of rows) {
    parts.push([
      f.id,
      f.name_encrypted,
      String(f.size_bytes),
      f.updated_at,
      f.parent_id ?? '',
      f.is_trashed ? '1' : '0',
      f.is_starred ? '1' : '0',
      f.is_folder ? '1' : '0',
      f.has_thumbnail ? '1' : '0',
      f.has_large_thumbnail ? '1' : '0',
    ].join('\u0000'))
  }
  return parts.join('\u0001')
}

export interface SyncRowsDecisionInput {
  next: DriveFile[]
  current: DriveFile[]
  /** `sync.treeComplete` — a snapshot has merged and the stream is contiguous. */
  coverageComplete: boolean
  /** True when this run is the post-window confirmation of an empty derive. */
  emptyConfirmed: boolean
}

export interface SyncRowsDecision {
  /** Whether the caller may write `next` into the list state. */
  apply: boolean
  /** The caller must schedule a confirmation and re-run after `EMPTY_CONFIRM_MS`. */
  confirmEmpty: boolean
}

export function decideSyncRows(input: SyncRowsDecisionInput): SyncRowsDecision {
  const { next, current, coverageComplete, emptyConfirmed } = input
  if (next.length === 0) {
    if (current.length === 0) return { apply: false, confirmEmpty: false }
    if (!coverageComplete) {
      // Partial tree: an empty derive is not evidence of an empty folder.
      return { apply: false, confirmEmpty: false }
    }
    // Complete tree, but an empty derive may still be a transient point
    // between a delete and a create in the same burst — confirm first.
    if (!emptyConfirmed) return { apply: false, confirmEmpty: true }
    return { apply: true, confirmEmpty: false }
  }
  if (rowsSignature(next) === rowsSignature(current)) {
    return { apply: false, confirmEmpty: false }
  }
  return { apply: true, confirmEmpty: false }
}
