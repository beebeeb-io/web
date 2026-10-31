/**
 * rv-web198c P2-4: an owner renaming a row a guest or member added.
 *
 * Such a row's name is sealed under ITS OWN key (random for a guest file),
 * reached through the shared folder (or the owner's adoption copy), not under
 * the key derived from the owner's master key. Sealing the new name under the
 * derived key destroyed it for the owner, every member and every guest.
 *
 * The key returned here is the row's real key, and it is proven by opening the
 * row's CURRENT name before anything is sealed. A key that does not open it
 * (the shared path fell through) refuses the rename: a name is never destroyed.
 */
import { updateFile, type DriveFile } from './api'
import { encryptFilename, serializeEncryptedBlob } from './crypto'
import { needsOwnership } from './owner-adoption'
import { assertCurrentVersionWritable } from './owner-write-guard'

export const RENAME_KEY_UNAVAILABLE = "This file's key isn't available, so it can't be renamed here."

export interface RenameKeyArgs {
  fileId: string
  /** The listed row, when the page has it. */
  file: DriveFile | undefined
  /** null where the page does not know it: any row a guest or member could have added is then verified. */
  viewerId: string | null
  getFileKey: (fileId: string) => Promise<Uint8Array>
  getFileKeyForFile: (file: DriveFile) => Promise<Uint8Array>
  /** Opens a stored name with a key; throws when it does not open. */
  readName: (fileKey: Uint8Array, nameEncrypted: string) => Promise<unknown>
}

export async function renameKeyFor(args: RenameKeyArgs): Promise<Uint8Array> {
  const { file } = args
  if (!file) return args.getFileKey(args.fileId)
  // SF-0002 review: an OWNER row is renamed under the key that authenticated
  // its name (the resolved key), not the plain string derivation. A binary-
  // convention row therefore stays on its binary key and no mixed-key row is
  // created. Foreign rows keep the proven-name check below.
  const key = await args.getFileKeyForFile(file)
  if (!needsOwnership(file, args.viewerId)) return key
  try {
    await args.readName(key, file.name_encrypted)
  } catch {
    key.fill(0)
    throw new Error(RENAME_KEY_UNAVAILABLE)
  }
  return key
}

/**
 * SF-0002 round 2 (W4): the ONE rename every surface uses (the Drive, Recent
 * and Starred dialogs and the inline rename in the file list). The write-time
 * read-only check runs before any key is resolved or name sealed, so a row
 * whose current version is upper_repair-sealed is refused even when it was
 * never opened, and nothing is PATCHed.
 */
export async function renameOwnerRow(
  args: RenameKeyArgs & {
    newName: string
    masterKey: Uint8Array | undefined
    /** The account the resident key belongs to (`useKeys().getResidentUserId()`). */
    residentUserId: string | null
  },
): Promise<void> {
  if (args.file) {
    await assertCurrentVersionWritable(args.file, args.masterKey, { viewerId: args.residentUserId })
  }
  const fileKey = await renameKeyFor(args)
  const enc = await encryptFilename(fileKey, args.newName)
  await updateFile(args.fileId, { name_encrypted: serializeEncryptedBlob(enc.nonce, enc.ciphertext) })
}
