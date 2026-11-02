// Coverage bookkeeping (task 1700): when may consumers trust an empty
// `children()` result? Only once a snapshot merged and no recovery path is
// still holding or fetching ops.

/**
 * Server op-log page cap (`GET /sync/ops`, server sync.rs). A response this
 * long means the backlog was truncated — only a snapshot merge can restore
 * full coverage (task 1700).
 */
export const SYNC_OPS_PAGE_CAP = 1000

export interface CoverageState {
  /** A snapshot merged in this process; before that nothing is complete. */
  snapshotMerged: boolean
  /** Out-of-order ops still held below the cursor. */
  reorderDepth: number
  /** A gap fill is scheduled or in flight. */
  gapFillPending: boolean
  /** A coverage resync is scheduled, queued, or in flight. */
  resyncPending: boolean
}

export function coverageComplete(state: CoverageState): boolean {
  return (
    state.snapshotMerged &&
    state.reorderDepth === 0 &&
    !state.gapFillPending &&
    !state.resyncPending
  )
}
