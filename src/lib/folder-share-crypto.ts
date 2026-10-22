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
import { listFilesPage, getSentInvites, FILE_LIST_HARD_CAP } from './api'
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
  const sharedSecret = await x25519SharedSecret(myPrivate, recipientPublicKey)
  const fileIdBytes = new TextEncoder().encode(folderId)
  const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
  const result = await encryptChunk(shareKey, folderKey)
  zeroize(myPrivate)
  zeroize(sharedSecret)
  zeroize(shareKey)
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

/** Owner-key blobs for this folder from the owner's sent invites, newest first (task 2133). */
export function ownerFolderKeyBlobs(invites: ShareInvite[], folderId: string): string[] {
  return invites
    .filter((i) => i.is_folder_share && i.file_id === folderId && !!i.encrypted_owner_folder_key)
    .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
    .map((i) => i.encrypted_owner_folder_key as string)
}

/**
 * Task 2133: the folder's key is minted ONCE, at its first invite, and every
 * later invite reuses it. The server keeps one wrapped child key per
 * (folder, file) and upserts on every invite, so a fresh key per invite
 * re-wraps every child under a key the earlier members never received and
 * locks them out.
 *
 * The owner's own copy of that key travels with every folder invite
 * (`encrypted_owner_folder_key`, sealed under the owner's master key) and
 * `GET /shares/invites/sent` returns it. Newest first: any copy of this
 * folder's key is the same key.
 *
 * Returns the base64 blob to send again verbatim, plus the unwrapped key, or
 * null when this owner has never invited anyone to the folder (the caller
 * then mints the key). A copy that exists but does NOT open throws: minting a
 * new key then is exactly the lock-out this guards against.
 */
export async function findExistingFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  invites?: ShareInvite[],
): Promise<{ folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null> {
  const blobs = ownerFolderKeyBlobs(invites ?? (await getSentInvites()), folderId)
  if (blobs.length === 0) return null
  for (const b64 of blobs) {
    try {
      const folderKey = await decryptOwnerFolderKey(masterKey, folderId, fromBase64(b64))
      return { folderKey, encryptedOwnerFolderKeyB64: b64 }
    } catch {
      // try the next copy
    }
  }
  throw new Error(
    "This folder is already shared, but we couldn't open its key, so a new invite would lock out the people who have it. Nothing was sent.",
  )
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
    const encrypted = await encryptChildFileKey(folderKey, fileKey)
    zeroize(fileKey)
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
