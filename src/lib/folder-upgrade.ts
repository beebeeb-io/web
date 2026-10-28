/**
 * Frozen contract 2237 §2 (lead, 2026-10-28): a folder that already holds
 * shared_folder_keys rows and has NO custody record cannot get fresh custody.
 * Its rows are in the legacy (unbound) format, and keep-first inserts would
 * leave every existing child unreadable under a new key (rv-web198d P1-3).
 * The server answers the custody PUT and a link create on such a folder with
 * 409 `upgrade_required`; rows from cancelled or denied invites count, since
 * cancel and deny never delete them.
 *
 * The client treats that answer as exactly one thing: "this folder needs the
 * upgrade". Never a generic error, and never a fallback to a legacy write. The
 * upgrade itself (server #353, client web #199) re-wraps every row in L7 and
 * registers custody in one call; until it is wired in, the owner is told so.
 */

/**
 * Shown wherever a share is refused for this reason. It says what happened,
 * that nothing was lost, and that there is no action for the owner yet.
 */
export const FOLDER_NEEDS_UPGRADE =
  "This folder was shared with an older version of folder sharing. New links and invites need its keys upgraded first, and this version of Beebeeb can't do that yet. Everyone who already has access keeps it."

/** The typed form of 409 `upgrade_required`, so no caller has to match a string. */
export class FolderNeedsUpgradeError extends Error {
  readonly folderId: string

  constructor(folderId: string) {
    super(FOLDER_NEEDS_UPGRADE)
    this.name = 'FolderNeedsUpgradeError'
    this.folderId = folderId
  }
}

/** The server's 409 `upgrade_required` (contract §1 and §2), by status and code. */
export function isUpgradeRequired(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null | undefined
  return e?.status === 409 && e?.code === 'upgrade_required'
}

/** True for the typed error and for the raw server answer alike. */
export function needsFolderUpgrade(err: unknown): boolean {
  return err instanceof FolderNeedsUpgradeError || isUpgradeRequired(err)
}

/**
 * The hook web #199 fills in: run the custody upgrade for `folderId` (list the
 * legacy rows, open every one, re-seal each as L7, register custody with the
 * re-wrap), then resolve to the folder key, which the caller zeroizes. It
 * throws FolderNeedsUpgradeError when the folder can't be upgraded. Nothing in
 * this PR provides one, so the refusal stands.
 */
export type FolderUpgradeRunner = (folderId: string, masterKey: Uint8Array) => Promise<Uint8Array>
