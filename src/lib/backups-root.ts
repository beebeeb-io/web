/**
 * Backups-root detection — pure, testable guard (task 0838 / 0848).
 *
 * The "Backups" root folder is the device-backup root that the desktop and
 * mobile sync engines write to (`Backups/{device}/{category}/`). We must warn
 * the user before they trash it. Detection rules:
 *
 *   1. Must be a folder at the vault root (`is_folder && parent_id === null`).
 *   2. If the decrypted name has NOT yet resolved (`decryptedName === undefined`),
 *      treat any root folder conservatively as *potentially* Backups and return
 *      true.  This covers the ~500 ms first-load crypto-bootstrap window (task 0848)
 *      and yields at most a sub-second false-positive dialog for non-Backups root
 *      folders — far safer than silently trashing the real Backups root.
 *   3. Once the name is resolved, only an exact "Backups" match triggers it.
 *
 * The caller passes `decryptedName` explicitly (not a closure over component
 * state) so this function stays pure and unit-testable without a DOM or React
 * context.
 *
 * @param file          - The DriveFile (or any object with the same relevant fields).
 * @param decryptedName - The resolved name string, `null` when decryption
 *                        failed (treated as "known non-Backups"), or `undefined`
 *                        when decryption is still in progress (name pending).
 */
export function isBackupsRoot(
  file: { is_folder: boolean; parent_id: string | null | undefined },
  decryptedName: string | null | undefined,
): boolean {
  // Must be a root-level folder.
  if (!file.is_folder || (file.parent_id ?? null) !== null) return false
  // Name not yet resolved — treat conservatively as potential Backups root.
  if (decryptedName === undefined) return true
  // null means decryption failed; a failed-decrypt folder is not Backups.
  if (decryptedName === null) return false
  return decryptedName === 'Backups'
}

/**
 * LD-0113: the server-flagged Backups root. The server refuses to trash, delete,
 * rename or move it (`409 protected_folder`), so the web never offers those
 * actions on it. Only the server's flag counts, never the folder's name.
 */
export function isProtectedBackupsRoot(file: { system_role?: string | null }): boolean {
  return file.system_role === 'backups_root'
}

/** Core's words (beebeeb-core `backup::protect`), the same the server sends. */
export const BACKUPS_ROOT_REFUSAL = {
  trash: "Backups is a system folder and can't be deleted.",
  move: "Backups is a system folder and can't be moved.",
  rename: "Backups is a system folder and can't be renamed.",
} as const

/** Core's words for the whole Backups tree (beebeeb-core `MSG_READ_ONLY`). */
export const BACKUPS_READ_ONLY =
  "Backups are read-only: each device writes its own. Change the file on that device, or save a copy outside Backups."

/** The server's words for a folder share or link in the tree (LD-0113 Amendment 10). */
export const BACKUPS_NO_FOLDER_SHARE = "Folders in Backups can't be shared. You can share a single file."

/** Context-menu actions never offered on the protected root. */
export const BACKUPS_ROOT_HIDDEN_ACTIONS: readonly string[] = ['move', 'rename', 'trash', 'share', 'manage-shares']

/** Sort comparator prefix: the protected root before everything else, in every sort. 0 when neither or both are. */
export function backupsRootFirst(a: { system_role?: string | null }, b: { system_role?: string | null }): number {
  const pa = isProtectedBackupsRoot(a)
  const pb = isProtectedBackupsRoot(b)
  if (pa === pb) return 0
  return pa ? -1 : 1
}

/** The refusal for `action` on a protected root, or null when it is allowed. */
export function backupsRootRefusal(action: string): string | null {
  if (action === 'share' || action === 'manage-shares' || action === 'copy-link') return BACKUPS_NO_FOLDER_SHARE
  if (action === 'trash' || action === 'delete') return BACKUPS_ROOT_REFUSAL.trash
  if (action === 'move') return BACKUPS_ROOT_REFUSAL.move
  if (action === 'rename') return BACKUPS_ROOT_REFUSAL.rename
  return null
}

/** The server's words when a backup folder's delete needs a fresh password (LD-0113 Amendment 11). */
export const BACKUPS_STEP_UP = "Confirm it's you to delete this backup."

/**
 * How deep `id` sits under the server-flagged Backups root: 0 = the root, 1 = a device folder,
 * 2 = a category folder, and so on. null = not in Backups, or not known yet (a missing node):
 * the caller then lets the server decide. Walks parent ids in the sync tree.
 */
export function backupsDepth(
  id: string | null | undefined,
  getNode: (id: string) => { parent_id: string | null; system_role?: string | null } | undefined,
): number | null {
  let cur = id ?? null
  for (let d = 0; cur && d < 64; d++) {
    const n = getNode(cur)
    if (!n) return null
    if (n.system_role === 'backups_root') return d
    cur = n.parent_id
  }
  return null
}

/** True when the server refused a backup delete until the password is confirmed. */
export function isStepUpRequired(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'step_up_required'
}
