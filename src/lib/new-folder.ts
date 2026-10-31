/**
 * A folder the owner names in the UI: Drive's "New folder" and the move
 * dialog's new folder (SF-0001 round 2, E6).
 *
 * The name is sealed under the key derived from an id minted here, BEFORE
 * anything is sent. With the vault locked or crypto not ready, nothing is
 * sent at all. (Both sites used to start from the plain name and encrypt it
 * only when unlocked: the server refuses a non-envelope name with a 400, but
 * the plain name had already crossed the wire.)
 */
import { createOwnerFolder } from './owner-upload-key'
import { serializeEncryptedBlob, zeroize, type EncryptedMetadata } from './crypto'
import type { DriveFile } from './api'

/** What a folder create with a locked vault says (and nothing is sent). */
export const FOLDER_NEEDS_UNLOCK = 'Unlock your vault to create a folder.'

/** A folder create refused in the client: the vault is locked or crypto is not ready. */
export class VaultLockedFolderError extends Error {
  constructor() {
    super(FOLDER_NEEDS_UNLOCK)
    this.name = 'VaultLockedFolderError'
  }
}

export async function createNamedOwnerFolder(args: {
  /** The name as typed. Only its sealed form ever leaves this function. */
  name: string
  parentId?: string
  /** The vault is unlocked AND crypto is ready. */
  vaultReady: boolean
  getFileKey: (id: string) => Promise<Uint8Array>
  getMasterKey: () => Uint8Array
  /** The site's name sealer (`encryptFileMetadata` or `encryptFilename`). */
  seal: (nameKey: Uint8Array, name: string) => Promise<EncryptedMetadata>
}): Promise<DriveFile> {
  if (!args.vaultReady) throw new VaultLockedFolderError()
  const folderId = crypto.randomUUID()
  const nameKey = await args.getFileKey(folderId)
  try {
    const sealed = await args.seal(nameKey, args.name)
    // Inside a shared folder its name-key wrap is published too (guests and
    // members read the name through it).
    return await createOwnerFolder({
      nameEncrypted: serializeEncryptedBlob(sealed.nonce, sealed.ciphertext),
      parentId: args.parentId,
      folderId,
      nameKey,
      masterKey: args.getMasterKey(),
    })
  } finally {
    zeroize(nameKey)
  }
}
