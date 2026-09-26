// Recipient-side recovery of a shared folder's random folder key.
//
// P0 (flow "web-core", 2026-09-25): a recipient of an auto-approved folder
// invite saw every child as "Encrypted file". The owner's share dialog
// creates the invite with `encrypted_folder_key: ''` (the recipient's public
// key is not known yet), then — when the server auto-claims for an existing
// account — seals the folder key for the recipient and POSTs it to
// `/approve`. Server `approve_invite` wrote that blob to
// `share_invites.encrypted_file_key` only, so `encrypted_folder_key` stayed
// the empty bytea from creation and the recipient had nothing to decrypt.
// Server PR #100 (task 1549) routes the blob to `encrypted_folder_key` for
// NEW approvals; this module makes the recipient able to open invites that
// were approved BEFORE that fix, without any stored-data migration:
//
//   1. `encrypted_folder_key`, when it is non-empty (the correct column).
//   2. `encrypted_file_key` of a folder invite (where the pre-fix server put
//      the auto-approve blob). It is the same format: the folder key sealed
//      with the sender↔recipient X25519 share key, bound to the folder id.
//
// A candidate is accepted only when it opens one of the folder's child key
// wrappings (`shared_folder_keys`). AES-GCM authenticates, so a wrong key is
// rejected rather than silently used — this matters for folder invites that
// were approved manually before web 1545, whose `encrypted_file_key` wraps
// deriveFileKey(folder id) instead of the folder key. Those resolve to
// `missing`, and the UI tells the recipient the owner has to share again.
//
// No new crypto format: both candidates are read with the existing
// decryptFolderKey / decryptChildFileKey. Every crypto call is injected so
// the logic is testable under `bun test` (the WASM worker is not loadable
// there — see test/1545-approve-folder-share-key.test.ts).
import type { ShareInvite } from './api'
import {
  decryptFolderKey as realDecryptFolderKey,
  decryptChildFileKey as realDecryptChildFileKey,
} from './folder-share-crypto'
import { fromBase64 as realFromBase64, zeroize as realZeroize } from './crypto'

export interface RecipientFolderKeyPorts {
  decryptFolderKey: typeof realDecryptFolderKey
  decryptChildFileKey: typeof realDecryptChildFileKey
  fromBase64: typeof realFromBase64
  zeroize: typeof realZeroize
}

export const REAL_RECIPIENT_FOLDER_KEY_PORTS: RecipientFolderKeyPorts = {
  decryptFolderKey: realDecryptFolderKey,
  decryptChildFileKey: realDecryptChildFileKey,
  fromBase64: realFromBase64,
  zeroize: realZeroize,
}

export type FolderKeySource = 'encrypted_folder_key' | 'encrypted_file_key'

export type RecipientFolderKeyResult =
  | { status: 'ok'; folderKey: Uint8Array; source: FolderKeySource }
  /** No stored blob opens this folder: the owner has to share it again. */
  | { status: 'missing' }

export type RecipientFolderKeyInvite = Pick<
  ShareInvite,
  'file_id' | 'is_folder_share' | 'sender_public_key' | 'encrypted_folder_key' | 'encrypted_file_key'
>

/**
 * @param folderKeys the invite's child key wrappings (GET
 *   /shares/invites/:id/folder-keys). Used to authenticate a candidate key.
 *   When it is empty there is nothing to check against, and the first
 *   candidate that decrypts is accepted.
 */
export async function resolveRecipientFolderKey(
  invite: RecipientFolderKeyInvite,
  masterKey: Uint8Array,
  folderKeys: ReadonlyArray<{ file_id: string; encrypted_file_key: string }>,
  ports: RecipientFolderKeyPorts = REAL_RECIPIENT_FOLDER_KEY_PORTS,
): Promise<RecipientFolderKeyResult> {
  if (!invite.sender_public_key) return { status: 'missing' }

  const candidates: { source: FolderKeySource; b64: string }[] = []
  if (invite.encrypted_folder_key) {
    candidates.push({ source: 'encrypted_folder_key', b64: invite.encrypted_folder_key })
  }
  if (invite.is_folder_share && invite.encrypted_file_key) {
    candidates.push({ source: 'encrypted_file_key', b64: invite.encrypted_file_key })
  }

  // Prefer the folder's own entry as the verifier; any child works.
  const verifier =
    folderKeys.find(k => k.file_id === invite.file_id && k.encrypted_file_key) ??
    folderKeys.find(k => k.encrypted_file_key)

  for (const candidate of candidates) {
    let blob: Uint8Array
    try {
      blob = ports.fromBase64(candidate.b64)
    } catch {
      continue
    }
    if (blob.length === 0) continue

    let folderKey: Uint8Array
    try {
      folderKey = await ports.decryptFolderKey(
        masterKey,
        ports.fromBase64(invite.sender_public_key),
        invite.file_id,
        blob,
      )
    } catch {
      continue
    }

    if (verifier) {
      try {
        const childKey = await ports.decryptChildFileKey(folderKey, verifier.encrypted_file_key)
        ports.zeroize(childKey)
      } catch {
        ports.zeroize(folderKey)
        continue
      }
    }
    return { status: 'ok', folderKey, source: candidate.source }
  }

  return { status: 'missing' }
}
