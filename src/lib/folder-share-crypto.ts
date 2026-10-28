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
  folderKeyId as coreFolderKeyId,
  wrapInviteOwnerCopy,
  unwrapInviteOwnerCopy,
  verifyLegacyFolderKey,
} from './crypto'
import { listFilesPage, getSentInvites, getFolderKeys, FILE_LIST_HARD_CAP } from './api'
import type { ShareInvite } from './api'

/**
 * The wire form of a folder key's id (task 2133, design K): standard base64
 * (with padding) of core's 32-byte `folder_key_id`. No JS HKDF: the id is
 * derived by the core WASM export. The server compares it to refuse a second,
 * different key for a folder that is already keyed.
 */
export async function folderKeyId(
  folderKey: Uint8Array,
  derive: (key: Uint8Array) => Promise<Uint8Array> = coreFolderKeyId,
): Promise<string> {
  return toBase64(await derive(folderKey))
}

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
  return wrapInviteOwnerCopy(masterKey, folderId, folderKey)
}

export async function decryptOwnerFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  encryptedOwnerFolderKey: Uint8Array,
  ports: ExistingFolderKeyPorts = REAL_EXISTING_FOLDER_KEY_PORTS,
): Promise<Uint8Array> {
  try {
    return await ports.unwrapInviteOwnerCopy(masterKey, folderId, encryptedOwnerFolderKey)
  } catch (e) {
    if (!isAuthenticationFailure(e)) throw e
  }
  // Approval must prove THIS invite's legacy copy, never substitute another key.
  const b64 = toBase64(encryptedOwnerFolderKey)
  const existing = await findExistingFolderKey(masterKey, folderId, {
    ...ports,
    getSentInvites: async () => (await ports.getSentInvites()).filter((i) => i.encrypted_owner_folder_key === b64),
  })
  if (!existing) throw new Error(FOLDER_KEY_UNVERIFIED)
  return existing.folderKey
}

const ACTIVE_STATUSES = new Set(['invited', 'claimed', 'approved'])

/**
 * Active folder invites of this folder, newest first. "Active" is by STATUS
 * only (invited/claimed/approved; denied excluded). expires_at is deliberately
 * ignored: a skewed device clock must never decide to mint a new key.
 */
export function activeFolderInvites(invites: ShareInvite[], folderId: string): ShareInvite[] {
  return invites
    .filter((i) => i.is_folder_share && i.file_id === folderId && ACTIVE_STATUSES.has(i.status))
    .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
}

function uniqueOwnerBlobs(active: ShareInvite[]): string[] {
  const blobs = active.map((i) => i.encrypted_owner_folder_key).filter((b): b is string => !!b)
  return [...new Set(blobs)]
}

/** Owner-key blobs of the ACTIVE invites for this folder, newest first, de-duplicated (task 2133). */
export function ownerFolderKeyBlobs(invites: ShareInvite[], folderId: string): string[] {
  return uniqueOwnerBlobs(activeFolderInvites(invites, folderId))
}

export interface ExistingFolderKeyPorts {
  getSentInvites: () => Promise<ShareInvite[]>
  getFolderKeys: typeof getFolderKeys
  listFilesPage: typeof listFilesPage
  unwrapInviteOwnerCopy: typeof unwrapInviteOwnerCopy
  verifyLegacyFolderKey: typeof verifyLegacyFolderKey
  deriveFileKey: typeof deriveFileKey
  decryptChunk: typeof decryptChunk
  fromBase64: typeof fromBase64
  zeroize: typeof zeroize
}

export const REAL_EXISTING_FOLDER_KEY_PORTS: ExistingFolderKeyPorts = {
  getSentInvites,
  getFolderKeys,
  listFilesPage,
  unwrapInviteOwnerCopy,
  verifyLegacyFolderKey,
  deriveFileKey,
  decryptChunk,
  fromBase64,
  zeroize,
}

// Must stay <= 80 characters so userFriendlyError shows it (SHORT_MESSAGE_MAX).
// It tells the owner the one way out: with no active invite the key is minted
// fresh, so removing the pending invites lets the next share start clean.
export const FOLDER_KEY_UNVERIFIED =
  "Can't check this folder's key. Remove its pending invites, then share again."

/** core's authentication failure ("decryption failed: ciphertext is invalid or key is wrong"). */
function isAuthenticationFailure(e: unknown): boolean {
  return e instanceof Error && /decryption failed/i.test(e.message)
}

/**
 * L9 (task 2255) supersedes 2133's unverified owner-copy reuse. New copies
 * authenticate their purpose and folder in core. Legacy copies additionally
 * require a stored wrap that opens to an owner's master-derived child key.
 * Missing proof returns null (the caller mints). Operational errors abort.
 * The caller owns and must zeroize the returned key.
 */
export async function findExistingFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  ports: ExistingFolderKeyPorts = REAL_EXISTING_FOLDER_KEY_PORTS,
): Promise<{ folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null> {
  const active = activeFolderInvites(await ports.getSentInvites(), folderId)
  let wrappingKey: Uint8Array | undefined
  let children: Set<string> | undefined
  try {
    for (const b64 of uniqueOwnerBlobs(active)) {
      const blob = ports.fromBase64(b64)
      try {
        const folderKey = await ports.unwrapInviteOwnerCopy(masterKey, folderId, blob)
        return { folderKey, encryptedOwnerFolderKeyB64: b64 }
      } catch (e) {
        if (!isAuthenticationFailure(e)) throw e
      }

      wrappingKey ??= await ports.deriveFileKey(masterKey, folderId)
      let candidate: Uint8Array
      try {
        candidate = await ports.decryptChunk(wrappingKey, blob.slice(0, 12), blob.slice(12))
      } catch (e) {
        if (!isAuthenticationFailure(e)) throw e
        continue
      }
      let verified = false
      try {
        if (candidate.length !== 32) continue
        // Use current direct children, excluding request-upload keys. Ignore
        // stale wraps for children that moved out or were trashed (2133).
        if (!children) {
          children = new Set<string>()
          let cursor: string | undefined
          const seenCursors = new Set<string>()
          do {
            const page = await ports.listFilesPage({ parentId: folderId, limit: SHARE_PAGE_LIMIT, cursor })
            if (!page.next_cursor && page.files.length >= SHARE_PAGE_LIMIT) throw new Error(TOO_LARGE_TO_SHARE)
            for (const child of page.files) {
              if (child.parent_id === folderId && !child.is_trashed && !child.file_request_id && !child.wrapped_content_key) children.add(child.id)
              if (children.size > FILE_LIST_HARD_CAP) throw new Error(TOO_LARGE_TO_SHARE)
            }
            cursor = page.next_cursor ?? undefined
            if (cursor && seenCursors.has(cursor)) throw new Error(TOO_LARGE_TO_SHARE)
            if (cursor) seenCursors.add(cursor)
          } while (cursor)
        }
        if (children.size === 0) continue
        // Duplicate owner blobs may occur on several invites; a missing or
        // stale proof on one invite must not hide a valid proof on another.
        for (const invite of active.filter((i) => i.encrypted_owner_folder_key === b64)) {
          for (const row of await ports.getFolderKeys(invite.id)) {
            if (!children.has(row.file_id)) continue
            if (await ports.verifyLegacyFolderKey(masterKey, folderId, candidate, row.file_id, ports.fromBase64(row.encrypted_file_key))) {
              verified = true
              return { folderKey: candidate, encryptedOwnerFolderKeyB64: b64 }
            }
          }
        }
      } finally {
        if (!verified) ports.zeroize(candidate)
      }
    }
    return null
  } finally {
    if (wrappingKey) ports.zeroize(wrappingKey)
  }
}

export interface FolderInvitePayload {
  is_folder_share: true
  encrypted_folder_key: ''
  encrypted_owner_folder_key: string
  folder_keys: { file_id: string; encrypted_file_key: string }[]
  /** base64 of core's folder_key_id for the key used (task 2133, design K). */
  folder_key_id: string
}

export interface FolderInvitePorts {
  findExistingFolderKey: (masterKey: Uint8Array, folderId: string) => ReturnType<typeof findExistingFolderKey>
  generateFolderKey: () => Promise<Uint8Array>
  encryptAllChildrenKeys: typeof encryptAllChildrenKeys
  encryptOwnerFolderKey: typeof encryptOwnerFolderKey
  folderKeyId: (folderKey: Uint8Array) => Promise<string>
}

export const REAL_FOLDER_INVITE_PORTS: FolderInvitePorts = {
  findExistingFolderKey: (m, f) => findExistingFolderKey(m, f),
  generateFolderKey,
  encryptAllChildrenKeys: (...a) => encryptAllChildrenKeys(...a),
  encryptOwnerFolderKey,
  folderKeyId: (k) => folderKeyId(k),
}

/**
 * Everything a folder invite carries (task 2133): the folder's key (reused
 * from an authenticated earlier invite, otherwise minted fresh), every child's key
 * wrapped under it, the owner's own sealed copy, and the key's id for the
 * server's mismatch check. The caller owns the returned `folderKey` and must
 * zeroize it (also needed for the recipient wrap on auto-approve); on a throw
 * the key made here is already zeroized.
 */
export async function buildFolderInvite(
  masterKey: Uint8Array,
  folderId: string,
  onProgress?: (stage: 'children', done: number, total: number) => void,
  ports: FolderInvitePorts = REAL_FOLDER_INVITE_PORTS,
): Promise<{ folderKey: Uint8Array; payload: FolderInvitePayload }> {
  const existing = await ports.findExistingFolderKey(masterKey, folderId)
  const folderKey = existing?.folderKey ?? (await ports.generateFolderKey())
  try {
    const folderKeys = await ports.encryptAllChildrenKeys(masterKey, folderKey, folderId, (d, t) =>
      onProgress?.('children', d, t),
    )
    const encOwner = toBase64(await ports.encryptOwnerFolderKey(masterKey, folderId, folderKey))
    return {
      folderKey,
      payload: {
        is_folder_share: true,
        encrypted_folder_key: '',
        encrypted_owner_folder_key: encOwner,
        folder_keys: folderKeys,
        folder_key_id: await ports.folderKeyId(folderKey),
      },
    }
  } catch (e) {
    zeroize(folderKey)
    throw e
  }
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
