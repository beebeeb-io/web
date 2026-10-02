/**
 * Task 1704 SLICE 2 — "Delete all data" orchestration for the honest
 * locked-state surface (VaultLockedNoKey).
 *
 * Server contract (verified on server main @ 1915063, files.rs):
 *  - POST /api/v1/files/trash (web `bulkTrashFiles`) trashes owned LIVE ids;
 *    capped at MAX_BULK_TRASH_IDS = 500 per request; folder children cascade.
 *  - POST /api/v1/files/permanent (web `bulkPermanentDelete`) erases owned ids
 *    that are ALREADY trashed (owned-but-live ids are skipped server-side);
 *    same 500 cap; gated by ONE single-use X-Confirm-Token per request
 *    (`ConfirmedTrashAction` — accepts the password step-up purpose the web's
 *    `confirmAction` mints, which works with the FRESH password).
 *
 * So a full wipe is: list everything → trash the live ids → erase in ≤500-id
 * batches, each with its OWN single-use token → RE-LIST and prove the server
 * holds nothing. A void response proves nothing (house evidence rule); the
 * verification pass is what the honest "done" state is built on.
 *
 * Everything here is pure orchestration over injected dependencies, so the
 * destructive sequence is unit-testable without a browser harness and the
 * component stays a thin shell (state + StepUpAuth + copy).
 */

/** The server's MAX_BULK_TRASH_IDS (files.rs) — never send larger batches. */
export const WIPE_BATCH_CAP = 500

/**
 * Split ids into cap-sized batches, preserving order, collapsing duplicates
 * (a folder and its child can both appear in a listing; the server dedups
 * too, but the batch plan must already count real requests).
 */
export function planFileWipe(ids: string[], cap: number = WIPE_BATCH_CAP): string[][] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id)
      unique.push(id)
    }
  }
  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += cap) {
    batches.push(unique.slice(i, i + cap))
  }
  return batches
}

export interface WipeResult {
  /** The server was RE-LISTED after erasing and holds no rows for the account. */
  verifiedEmpty: boolean
  /** Ids that were sent to the permanent-delete endpoint. */
  erased: number
  /** Rows still listed (live or trashed) after the erase pass. */
  remaining: number
}

export interface WipeDeps {
  /** List every file id on the server. `trashed=true` = the trash listing. */
  listFileIds: (trashed: boolean) => Promise<string[]>
  /** POST /files/trash (bulkTrashFiles) — no step-up token needed. */
  trashFiles: (ids: string[]) => Promise<unknown>
  /** POST /files/permanent (bulkPermanentDelete) — consumes one token. */
  permanentDelete: (ids: string[], confirmToken: string) => Promise<unknown>
  /** The single-use X-Confirm-Token for the FIRST erase batch. */
  initialToken: string
  /**
   * Token source for every erase batch beyond the first: tokens are
   * single-use, so batches >1 need a fresh step-up. The component implements
   * this by re-opening the step-up dialog ("continue erasing, batch i of n").
   */
  nextToken: () => Promise<string>
  onProgress?: (message: string) => void
  cap?: number
}

export async function executeDeleteAllData(deps: WipeDeps): Promise<WipeResult> {
  const cap = deps.cap ?? WIPE_BATCH_CAP
  const report = deps.onProgress ?? (() => {})

  // 1. Ground truth: what does the server actually hold?
  const [live, trashed] = await Promise.all([deps.listFileIds(false), deps.listFileIds(true)])
  const union: string[] = []
  const seen = new Set<string>()
  for (const id of [...live, ...trashed]) {
    if (!seen.has(id)) {
      seen.add(id)
      union.push(id)
    }
  }
  if (union.length === 0) {
    return { verifiedEmpty: true, erased: 0, remaining: 0 }
  }

  // 2. Trash the LIVE ids (the erase endpoint refuses live ids). Already-
  //    trashed ids skip this step. No token needed for trashing.
  const liveBatches = planFileWipe(live, cap)
  for (let i = 0; i < liveBatches.length; i++) {
    report(`Preparing deletion (${i + 1} of ${liveBatches.length})…`)
    await deps.trashFiles(liveBatches[i])
  }

  // 3. Erase everything in batches, ONE single-use token per request.
  const eraseBatches = planFileWipe(union, cap)
  for (let i = 0; i < eraseBatches.length; i++) {
    const token = i === 0 ? deps.initialToken : await deps.nextToken()
    report(`Erasing files (${i + 1} of ${eraseBatches.length})…`)
    await deps.permanentDelete(eraseBatches[i], token)
  }

  // 4. Verify — re-list and count what is left. Honest, not optimistic.
  const [liveAfter, trashedAfter] = await Promise.all([
    deps.listFileIds(false),
    deps.listFileIds(true),
  ])
  const remaining = liveAfter.length + trashedAfter.length
  return {
    verifiedEmpty: remaining === 0,
    erased: union.length,
    remaining,
  }
}