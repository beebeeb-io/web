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
import type { DriveFile } from './api'
import { needsOwnership } from './owner-adoption'

export const RENAME_KEY_UNAVAILABLE = "This file's key isn't available, so it can't be renamed here."

export async function renameKeyFor(args: {
  fileId: string
  /** The listed row, when the page has it. */
  file: DriveFile | undefined
  /** null where the page does not know it: any row a guest or member could have added is then verified. */
  viewerId: string | null
  getFileKey: (fileId: string) => Promise<Uint8Array>
  getFileKeyForFile: (file: DriveFile) => Promise<Uint8Array>
  /** Opens a stored name with a key; throws when it does not open. */
  readName: (fileKey: Uint8Array, nameEncrypted: string) => Promise<unknown>
}): Promise<Uint8Array> {
  const { file } = args
  if (!file || !needsOwnership(file, args.viewerId)) return args.getFileKey(args.fileId)
  const key = await args.getFileKeyForFile(file)
  try {
    await args.readName(key, file.name_encrypted)
  } catch {
    key.fill(0)
    throw new Error(RENAME_KEY_UNAVAILABLE)
  }
  return key
}
