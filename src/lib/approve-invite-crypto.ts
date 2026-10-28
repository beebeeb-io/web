// Pure key-material logic for approving a pending share invite (task 1545,
// finding 1). Split out of share-approve.tsx so it is testable without a
// browser Worker: every crypto call is injected via `ApproveKeyCryptoPorts`
// (defaulting to the real implementations for production use).
import type { ShareInvite } from './api'
import {
  custodyFolderKey as realCustodyFolderKey,
  legacyInviteOwnerKey as realLegacyInviteOwnerKey,
  encryptFolderKeyForRecipient as realEncryptFolderKeyForRecipient,
} from './folder-share-crypto'
import {
  encryptFileKeyForSharing as realEncryptFileKeyForSharing,
  fromBase64 as realFromBase64,
  zeroize as realZeroize,
} from './crypto'

export interface ApproveKeyCryptoPorts {
  /** L6: the folder key from its custody record, or null when it has none. */
  custodyFolderKey: typeof realCustodyFolderKey
  /** The legacy invite owner copy, for a folder with no custody record (L7b). */
  legacyInviteOwnerKey: typeof realLegacyInviteOwnerKey
  encryptFolderKeyForRecipient: typeof realEncryptFolderKeyForRecipient
  encryptFileKeyForSharing: typeof realEncryptFileKeyForSharing
  fromBase64: typeof realFromBase64
  zeroize: typeof realZeroize
}

export const REAL_APPROVE_KEY_CRYPTO_PORTS: ApproveKeyCryptoPorts = {
  custodyFolderKey: realCustodyFolderKey,
  legacyInviteOwnerKey: realLegacyInviteOwnerKey,
  encryptFolderKeyForRecipient: realEncryptFolderKeyForRecipient,
  encryptFileKeyForSharing: realEncryptFileKeyForSharing,
  fromBase64: realFromBase64,
  zeroize: realZeroize,
}

/**
 * Build the (nonce || ciphertext) key blob to send to `approveInvite()` for a
 * pending share invite awaiting the owner's manual approval.
 *
 * Finding 1545#1: the previous implementation (inline in
 * share-approve.tsx's handleApprove) ALWAYS wrapped
 * `getFileKey(invite.file_id)` — a deterministic `deriveFileKey(masterKey,
 * fileId)` — even for folder-share invites, instead of the random
 * `folderKey` generated at invite-creation time that every child file's key
 * is actually wrapped under (see sealFolderChild / openFolderChild
 * in folder-share-crypto.ts). That made a manually-approved folder share
 * permanently undecryptable for the recipient.
 *
 * This function branches on `invite.is_folder_share`: for a folder share it
 * recovers the REAL folder key from `encrypted_owner_folder_key` (written at
 * invite-creation time, decryptable by the owner via their own masterKey —
 * see the legacy invite owner copy in folder-share-crypto.ts) and wraps THAT for the
 * recipient, exactly like the auto-approve branch in share-dialog.tsx does.
 *
 * NOTE — known remaining gap (server-side, out of scope for the web repo):
 * the server's `approve_invite` endpoint (repos/server .../invites.rs)
 * currently stores whatever this function returns into the
 * `share_invites.encrypted_file_key` column only. The recipient reads
 * `encrypted_folder_key` for folder shares (a separate column that
 * `approve_invite` never writes — see shared-folder.tsx's
 * decryptFolderKeyFromInvite). Fixing this function alone corrects the
 * CLIENT's key material but does not by itself make the recipient able to
 * decrypt; a companion server-side fix is required. See task 1545 notes.
 */
export async function buildApprovalKeyBlob(
  invite: Pick<ShareInvite, 'file_id' | 'is_folder_share' | 'encrypted_owner_folder_key'>,
  masterKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  getFileKey: (fileId: string) => Promise<Uint8Array>,
  ports: ApproveKeyCryptoPorts = REAL_APPROVE_KEY_CRYPTO_PORTS,
): Promise<Uint8Array> {
  if (invite.is_folder_share) {
    // L1/L6: a folder with a custody record has exactly one key, read from
    // that record. Only a flag-off invite-only folder (no record) falls to its
    // invite's legacy owner copy (L7b).
    const custody = await ports.custodyFolderKey(masterKey, invite.file_id)
    if (!custody && !invite.encrypted_owner_folder_key) {
      throw new Error(
        'This folder share is missing its owner folder key and cannot be approved. Ask the recipient to request a new share.',
      )
    }
    const folderKey =
      custody?.folderKey ??
      (await ports.legacyInviteOwnerKey(
        masterKey,
        invite.file_id,
        ports.fromBase64(invite.encrypted_owner_folder_key as string),
      ))
    const combined = await ports.encryptFolderKeyForRecipient(
      masterKey,
      recipientPublicKey,
      invite.file_id,
      folderKey,
    )
    ports.zeroize(folderKey)
    return combined
  }

  const fileKey = await getFileKey(invite.file_id)
  const { encryptedFileKey, nonce } = await ports.encryptFileKeyForSharing(
    masterKey,
    recipientPublicKey,
    invite.file_id,
    fileKey,
  )
  ports.zeroize(fileKey)
  const combined = new Uint8Array(nonce.length + encryptedFileKey.length)
  combined.set(nonce, 0)
  combined.set(encryptedFileKey, nonce.length)
  return combined
}
