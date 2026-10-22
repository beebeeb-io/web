import {
  encryptChunk,
  decryptChunk,
  deriveFileKey,
  deriveX25519Private,
  x25519SharedSecret,
  deriveShareKey,
  fromBase64,
  toBase64,
  zeroize,
} from './crypto'
import { listFilesPage, getSentInvites, getFolderKeys, FILE_LIST_HARD_CAP } from './api'
import type { ShareInvite } from './api'

export async function generateFolderKey(): Promise<Uint8Array> {
  const key = new Uint8Array(32)
  crypto.getRandomValues(key)
  return key
}

export async function encryptFolderKeyForRecipient(
  masterKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  folderId: string,
  folderKey: Uint8Array,
): Promise<Uint8Array> {
  const myPrivate = await deriveX25519Private(masterKey)
  let sharedSecret: Uint8Array | undefined
  let shareKey: Uint8Array | undefined
  let result: Awaited<ReturnType<typeof encryptChunk>>
  try {
    sharedSecret = await x25519SharedSecret(myPrivate, recipientPublicKey)
    const fileIdBytes = new TextEncoder().encode(folderId)
    shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
    result = await encryptChunk(shareKey, folderKey)
  } finally {
    zeroize(myPrivate)
    if (sharedSecret) zeroize(sharedSecret)
    if (shareKey) zeroize(shareKey)
  }
  const combined = new Uint8Array(result.nonce.length + result.ciphertext.length)
  combined.set(result.nonce, 0)
  combined.set(result.ciphertext, result.nonce.length)
  return combined
}

export async function decryptFolderKey(
  masterKey: Uint8Array,
  senderPublicKey: Uint8Array,
  folderId: string,
  encryptedFolderKey: Uint8Array,
): Promise<Uint8Array> {
  const myPrivate = await deriveX25519Private(masterKey)
  const sharedSecret = await x25519SharedSecret(myPrivate, senderPublicKey)
  const fileIdBytes = new TextEncoder().encode(folderId)
  const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
  const nonce = encryptedFolderKey.slice(0, 12)
  const ciphertext = encryptedFolderKey.slice(12)
  const folderKey = await decryptChunk(shareKey, nonce, ciphertext)
  zeroize(myPrivate)
  zeroize(sharedSecret)
  zeroize(shareKey)
  return folderKey
}

export async function encryptOwnerFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  folderKey: Uint8Array,
): Promise<Uint8Array> {
  const folderDerivedKey = await deriveFileKey(masterKey, folderId)
  const result = await encryptChunk(folderDerivedKey, folderKey)
  zeroize(folderDerivedKey)
  const combined = new Uint8Array(result.nonce.length + result.ciphertext.length)
  combined.set(result.nonce, 0)
  combined.set(result.ciphertext, result.nonce.length)
  return combined
}

export async function decryptOwnerFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  encryptedOwnerFolderKey: Uint8Array,
): Promise<Uint8Array> {
  const folderDerivedKey = await deriveFileKey(masterKey, folderId)
  const nonce = encryptedOwnerFolderKey.slice(0, 12)
  const ciphertext = encryptedOwnerFolderKey.slice(12)
  const folderKey = await decryptChunk(folderDerivedKey, nonce, ciphertext)
  zeroize(folderDerivedKey)
  return folderKey
}

const ACTIVE_STATUSES = new Set(['invited', 'claimed', 'approved'])

/** Active folder invites of this folder: invited/claimed/approved and not past expires_at, newest first. */
export function activeFolderInvites(
  invites: ShareInvite[],
  folderId: string,
  now: number = Date.now(),
): ShareInvite[] {
  return invites
    .filter((i) => i.is_folder_share && i.file_id === folderId && ACTIVE_STATUSES.has(i.status))
    .filter((i) => !i.expires_at || new Date(i.expires_at).getTime() > now)
    .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
}

/** Owner-key blobs of the ACTIVE invites for this folder, newest first, de-duplicated (task 2133). */
export function ownerFolderKeyBlobs(
  invites: ShareInvite[],
  folderId: string,
  now: number = Date.now(),
): string[] {
  const blobs = activeFolderInvites(invites, folderId, now)
    .map((i) => i.encrypted_owner_folder_key)
    .filter((b): b is string => !!b)
  return [...new Set(blobs)]
}

export interface ExistingFolderKeyPorts {
  getSentInvites: () => Promise<ShareInvite[]>
  getFolderKeys: (inviteId: string) => Promise<{ file_id: string; encrypted_file_key: string }[]>
  deriveFileKey: typeof deriveFileKey
  decryptChunk: typeof decryptChunk
  fromBase64: typeof fromBase64
  decryptChildFileKey: (folderKey: Uint8Array, encryptedFileKeyB64: string) => Promise<Uint8Array>
  zeroize: typeof zeroize
  now: () => number
}

export const REAL_EXISTING_FOLDER_KEY_PORTS: ExistingFolderKeyPorts = {
  getSentInvites,
  getFolderKeys,
  deriveFileKey,
  decryptChunk,
  fromBase64,
  decryptChildFileKey: (k, b) => decryptChildFileKey(k, b),
  zeroize,
  now: () => Date.now(),
}

// Must stay <= 80 characters so userFriendlyError shows it (SHORT_MESSAGE_MAX).
export const FOLDER_KEY_UNVERIFIED =
  "This folder's sharing key couldn't be checked. Nothing was sent."

/**
 * Task 2133: the folder's key is minted at its first invite, and every later
 * invite while the folder has an active invite reuses it. The server keeps
 * one wrapped child key per (folder, file) and upserts on every invite, so a
 * fresh key per invite re-wraps every child under a key the earlier members
 * never received and locks them out.
 *
 * The rule: reuse the folder's key (from ACTIVE invites: invited/claimed/
 * approved, not past expires_at, verified against a stored child wrap); mint
 * only when the folder has no active invite. Denied/expired rows never supply
 * a key. (Rotation on revoke is a separate design decision, not done here.)
 *
 * The owner's own copy of the key travels with every folder invite
 * (`encrypted_owner_folder_key`, sealed under the owner's master key).
 * Candidates are tried newest first; the first that opens AND opens a stored
 * child wrap (GET /shares/invites/:id/folder-keys, the way
 * resolveRecipientFolderKey authenticates; that endpoint serves approved
 * invites only) wins. If there is no approved invite, or no stored wraps at
 * all, there is nothing to verify against, so the newest openable key is
 * accepted.
 *
 * Returns the blob to send again verbatim plus the unwrapped key, or null
 * when the folder has no active invite (the caller mints). If active
 * candidates exist and none verifies, throws: minting then would lock out
 * the members who hold the key that opens the stored wraps. The caller owns
 * (and must zeroize) the returned key.
 */
export async function findExistingFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  ports: ExistingFolderKeyPorts = REAL_EXISTING_FOLDER_KEY_PORTS,
): Promise<{ folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null> {
  const invites = await ports.getSentInvites()
  const now = ports.now()
  const blobs = ownerFolderKeyBlobs(invites, folderId, now)
  if (blobs.length === 0) return null

  // One verifier: a stored child wrap. The wraps belong to the folder (the
  // server returns the same rows for every invite of it) and the endpoint only
  // serves APPROVED invites (400 otherwise), so ask the newest approved one,
  // once. With no approved invite there is no verifier: the newest openable
  // key is accepted (nothing can be checked, and every holder is pending).
  const approved = activeFolderInvites(invites, folderId, now).find((i) => i.status === 'approved')
  let verifier: string | undefined
  if (approved) {
    const keys = await ports.getFolderKeys(approved.id)
    verifier = keys.find((x) => x.encrypted_file_key)?.encrypted_file_key
  }

  const wrappingKey = await ports.deriveFileKey(masterKey, folderId)
  try {
    for (const b64 of blobs) {
      let folderKey: Uint8Array
      try {
        const blob = ports.fromBase64(b64)
        folderKey = await ports.decryptChunk(wrappingKey, blob.slice(0, 12), blob.slice(12))
      } catch {
        continue
      }
      if (verifier) {
        try {
          ports.zeroize(await ports.decryptChildFileKey(folderKey, verifier))
        } catch {
          ports.zeroize(folderKey)
          continue
        }
      }
      return { folderKey, encryptedOwnerFolderKeyB64: b64 }
    }
  } finally {
    ports.zeroize(wrappingKey)
  }
  throw new Error(FOLDER_KEY_UNVERIFIED)
}

export async function encryptChildFileKey(
  folderKey: Uint8Array,
  fileKey: Uint8Array,
): Promise<string> {
  const result = await encryptChunk(folderKey, fileKey)
  const combined = new Uint8Array(result.nonce.length + result.ciphertext.length)
  combined.set(result.nonce, 0)
  combined.set(result.ciphertext, result.nonce.length)
  return toBase64(combined)
}

export async function decryptChildFileKey(
  folderKey: Uint8Array,
  encryptedFileKeyB64: string,
): Promise<Uint8Array> {
  const bytes = fromBase64(encryptedFileKeyB64)
  const nonce = bytes.slice(0, 12)
  const ciphertext = bytes.slice(12)
  return decryptChunk(folderKey, nonce, ciphertext)
}

export async function encryptAllChildrenKeys(
  masterKey: Uint8Array,
  folderKey: Uint8Array,
  folderId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ file_id: string; encrypted_file_key: string }[]> {
  const allChildren = await collectAllChildren(folderId)
  const result: { file_id: string; encrypted_file_key: string }[] = []

  for (let i = 0; i < allChildren.length; i++) {
    const childId = allChildren[i]
    const fileKey = await deriveFileKey(masterKey, childId)
    let encrypted: string
    try {
      encrypted = await encryptChildFileKey(folderKey, fileKey)
    } finally {
      zeroize(fileKey)
    }
    result.push({ file_id: childId, encrypted_file_key: encrypted })
    onProgress?.(i + 1, allChildren.length)
  }

  return result
}

/**
 * A folder share is transactional only if we encrypt a key for EVERY descendant
 * before the single createInvite call — a partial enumeration would silently
 * produce a half-shared folder (some children undecryptable to the recipient).
 *
 * Task 0739 gives the server keyset pagination, so we follow `next_cursor` to
 * enumerate each folder IN FULL (no more first-page-only). The page guard is
 * written to be CORRECT regardless of deploy order with the server half:
 *  - paginated server → a full page carries a `next_cursor` we follow → no false
 *    refusal, full enumeration;
 *  - pre-0739 server (no cursor) → a FULL page with NO cursor means there may be
 *    more children we can't reach → refuse loudly (the prior interim behaviour),
 *    never half-share.
 * Outer bound: encrypting a key for >`FILE_LIST_HARD_CAP` descendants in one link
 * is impractical → refuse rather than build an unbounded per-recipient key set.
 */
const SHARE_PAGE_LIMIT = 500
const TOO_LARGE_TO_SHARE =
  'This folder is too large to share in one link right now. Share a smaller subfolder, or contact support.'

export async function collectAllChildren(folderId: string): Promise<string[]> {
  const ids: string[] = []
  const queue: string[] = [folderId]

  while (queue.length > 0) {
    const parentId = queue.shift()!
    let cursor: string | undefined
    do {
      const page = await listFilesPage({ parentId, limit: SHARE_PAGE_LIMIT, cursor })
      // Pre-0739 server with no keyset pagination: a full page and no cursor
      // means there may be unreachable children → refuse rather than half-share.
      if (!page.next_cursor && page.files.length >= SHARE_PAGE_LIMIT) {
        throw new Error(TOO_LARGE_TO_SHARE)
      }
      for (const child of page.files) {
        ids.push(child.id)
        if (child.is_folder) queue.push(child.id)
        if (ids.length > FILE_LIST_HARD_CAP) throw new Error(TOO_LARGE_TO_SHARE)
      }
      cursor = page.next_cursor ?? undefined
    } while (cursor)
  }

  return ids
}
