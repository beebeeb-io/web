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
