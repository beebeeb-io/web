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
import { getFile, updateFile, type DriveFile } from './api'
import { encryptFilename, serializeEncryptedBlob } from './crypto'
import { contentKeyBytes, isRequestUpload, RENAME_KEY_UNAVAILABLE, type ContentKey } from './request-row'
export { RENAME_KEY_UNAVAILABLE } from './request-row'
import { needsOwnership } from './owner-adoption'
import { assertOwnerRepairWritable } from './owner-repair'
import { assertCurrentVersionWritable } from './owner-write-guard'

export interface RenameKeyArgs {
  fileId: string
  /** The listed row, when the page has it. */
  file: DriveFile | undefined
  /** null where the page does not know it: any row a guest or member could have added is then verified. */
  viewerId: string | null
  getFileKey: (fileId: string) => Promise<Uint8Array>
  getFileKeyForFile: (file: DriveFile) => Promise<ContentKey>
  /** Opens a stored name with a key; throws when it does not open. */
  readName: (fileKey: Uint8Array, nameEncrypted: string) => Promise<unknown>
  /**
   * §15: seal a request row's new name through core (`sealRequestRename`), the
   * only path that exists — it derives the string-convention key from the id
   * and keeps the recorded pin, so a name is never sealed under C. Refuses an
   * upper-repair (read-only) row.
   */
  sealRequestRename?: (file: DriveFile, newName: string) => Promise<string>
}

export async function renameKeyFor(args: RenameKeyArgs): Promise<Uint8Array> {
  const { file } = args
  if (!file) return args.getFileKey(args.fileId)
  // SF-0002 review: an OWNER row is renamed under the key that authenticated
  // its name (the resolved key), not the plain string derivation. A binary-
  // convention row therefore stays on its binary key and no mixed-key row is
  // created. Foreign rows keep the proven-name check below.
  const key = contentKeyBytes(await args.getFileKeyForFile(file))
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
 *
 * Round 3 (X1): the read-only mark is checked on the id first, whatever the
 * page has, and a row the page does not have in its listing (reached from the
 * sidebar tree, search, a breadcrumb, or a list that refreshed) is read from
 * the server. The write check and the resolved key then both use that row, so
 * nothing falls back to the plain derivation.
 */
export async function renameOwnerRow(
  args: RenameKeyArgs & {
    newName: string
    masterKey: Uint8Array | undefined
    /** The account the resident key belongs to (`useKeys().getResidentUserId()`). */
    residentUserId: string | null
  },
): Promise<void> {
  assertOwnerRepairWritable(args.fileId)
  const file = args.file && args.file.id === args.fileId ? args.file : await getFile(args.fileId)
  await assertCurrentVersionWritable(file, args.masterKey, { viewerId: args.residentUserId })
  // §15: a request row has no key of ours to seal with. Its rename goes only
  // through core's string-convention seal (never C); an upper-repair row has no
  // rename target and is refused by the resolver.
  if (isRequestUpload(file)) {
    if (!args.sealRequestRename) throw new Error(RENAME_KEY_UNAVAILABLE)
    const sealed = await args.sealRequestRename(file, args.newName)
    await updateFile(args.fileId, { name_encrypted: sealed })
    return
  }
  const fileKey = await renameKeyFor({ ...args, file })
  const enc = await encryptFilename(fileKey, args.newName)
  await updateFile(args.fileId, { name_encrypted: await serializeEncryptedBlob(enc.nonce, enc.ciphertext) })
}
