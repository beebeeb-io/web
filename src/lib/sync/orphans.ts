// Orphaned pending-op lookup (task 1973 r2).
//
// A pending op with no recorded server position may still have been recorded
// by the server (the answer was lost). Before a snapshot merge, look it up in
// the op log by `client_op_id` so the merge confirms it instead of re-applying
// it over the snapshot or resubmitting it.

import type { SyncSnapshot, UserSeqSyncOp } from '../api'
import { SYNC_OPS_PAGE_CAP } from './coverage'
import { userSeqOf } from './protocol'
import type { SyncQueue } from './queue'
import { SYNC_REQUEST_TIMEOUT_MS, type SyncTransport } from './transport'

/**
 * Task 1973 r2: most `GET /sync/ops?since=` pages one orphan lookup reads
 * (server page = 1,000 ops). Past that the op is resubmitted, as before.
 */
const ORPHAN_SCAN_MAX_PAGES = 5

/**
 * Look orphaned pending ops up in the op log, from the global cursor at their
 * submission up to the snapshot about to merge. One found there was recorded
 * by the server, so it gets its position and the merge confirms it. Bounded:
 * past ORPHAN_SCAN_MAX_PAGES, or on an error, the op stays pending and is
 * resubmitted. Never applies anything to the tree.
 */
export async function locateOrphanedPending(
  transport: SyncTransport,
  queue: SyncQueue,
  snap: SyncSnapshot,
): Promise<void> {
  if (!queue.hasOrphans) return
  const orphans = queue.orphanCandidates()
  if (orphans.length === 0) {
    queue.clearOrphans()
    return
  }
  let since = queue.orphanLookupFloor(orphans)
  let found = false
  let complete = false
  try {
    for (let page = 0; page < ORPHAN_SCAN_MAX_PAGES; page++) {
      const ops = await transport.opsSince(since, SYNC_REQUEST_TIMEOUT_MS)
      for (const op of ops) {
        if (op.client_op_id && queue.isOrphaned(op.client_op_id)) {
          found = queue.recordPosition(op.client_op_id, op.seq_id, userSeqOf(op as UserSeqSyncOp)) || found
        }
      }
      const last = ops.length > 0 ? ops[ops.length - 1].seq_id : since
      if (ops.length < SYNC_OPS_PAGE_CAP || last >= snap.seq_id || !queue.hasOrphans) {
        complete = true
        break
      }
      since = last
    }
  } catch (err) {
    console.warn('[SyncClient] orphaned pending-op lookup failed; they will be resubmitted', err)
  }
  if (found) queue.persist()
  if (!complete && queue.hasOrphans) {
    console.warn('[SyncClient] orphaned pending-op lookup stopped early; the rest will be resubmitted')
  }
  // One lookup per orphan: what is left was not found and stays a plain
  // pending op (optimistic state kept, resubmitted on the next boot).
  queue.clearOrphans()
}
