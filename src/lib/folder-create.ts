/**
 * Creating a folder, the only safe way: a vault-locked client REFUSES and sends
 * nothing, and an unlocked one seals the name under a key derived from the id
 * THIS client minted.
 *
 * Both "New folder" sites (drive.tsx and the move modal) used to fall back to
 * `nameEncrypted = name` when the vault was locked or crypto was not ready,
 * putting the plaintext folder name on the wire (SF-0001 L13 round 2, E6).
 * There is no plaintext fallback any more: the create is refused in the client.
 */
import { encryptFileMetadata, serializeEncryptedBlob } from './crypto'
import { createOwnerFolder } from './owner-upload-key'
import type { DriveFile } from './api'

/** The one sentence shown when a folder create is refused locally. */
export const FOLDER_VAULT_LOCKED_COPY = 'Unlock your vault to create a folder.'

/** The vault is locked (or its crypto is not ready): nothing was sent. */
export class VaultLockedFolderCreateError extends Error {
  readonly code = 'vault_locked_folder_create'

  constructor() {
    super(FOLDER_VAULT_LOCKED_COPY)
    this.name = 'VaultLockedFolderCreateError'
  }
}

export interface CreateSealedFolderArgs {
  /** The plaintext folder name. Never sent as-is. */
  name: string
  parentId?: string
  isUnlocked: boolean
  /** Optional: false while the vault's crypto is still warming up. */
  cryptoReady?: boolean
  /** Derives the folder's own name key from the id this client minted. */
  folderKey: (folderId: string) => Promise<Uint8Array>
  /** Present when a name-key wrap must be published (shared parent). */
  masterKey?: Uint8Array
  /** Id minter, injectable for tests. */
  mintId?: () => string
  /** Create call, injectable so a test can prove nothing reaches the wire. */
  create?: typeof createOwnerFolder
}

/**
 * Mint an id, seal the name under the key derived from it, and create the
 * folder. `createFolder`/`createOwnerFolder` abort on an answer naming another
 * id (L13), so the caller can never index, move into, or navigate to a folder
 * whose key it does not hold.
 */
export async function createSealedFolder(args: CreateSealedFolderArgs): Promise<DriveFile> {
  if (!args.isUnlocked || args.cryptoReady === false) throw new VaultLockedFolderCreateError()

  const folderId = (args.mintId ?? (() => crypto.randomUUID()))()
  const nameKey = await args.folderKey(folderId)
  const sealed = await encryptFileMetadata(nameKey, args.name)
  const nameEncrypted = serializeEncryptedBlob(sealed.nonce, sealed.ciphertext)

  const create = args.create ?? createOwnerFolder
  return create({
    nameEncrypted,
    parentId: args.parentId,
    folderId,
    nameKey,
    masterKey: args.masterKey,
  })
}
