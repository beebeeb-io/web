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
  openLegacyInviteOwnerCopy,
} from './crypto'
import { listFilesPage, getSentInvites, getFolderKeys, FILE_LIST_HARD_CAP } from './api'
import type { ShareInvite } from './api'

/**
 * The wire form of a folder key's id (task 2133, design K): standard base64
 * (with padding) of core's 32-byte `folder_key_id`. No JS HKDF: the id is
 * derived by the core WASM export. Design K has the server compare it and
 * refuse a second, different key for a folder that is already keyed; server
 * main does not check it yet (found in the task 2255 review), so today only
 * the client rules in `findExistingFolderKey` keep one key per folder.
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

/**
 * The folder key behind one invite's owner copy, for approving that invite.
 * The same L9 rule as `findExistingFolderKey`: the purpose-bound format, or a
 * legacy copy only with core's proof. It never substitutes another invite's
 * key, and it throws FOLDER_KEY_UNVERIFIED when the copy can't be proven.
 */
export async function decryptOwnerFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  encryptedOwnerFolderKey: Uint8Array,
  ports: ExistingFolderKeyPorts = REAL_EXISTING_FOLDER_KEY_PORTS,
): Promise<Uint8Array> {
  const folderKey = await openOwnerCopy(masterKey, folderId, encryptedOwnerFolderKey, ports, async () => {
    const active = activeFolderInvites(await ports.getSentInvites(), folderId)
    return active.length > 0 ? ports.getFolderKeys(active[0].id) : []
  })
  if (!folderKey) throw new Error(FOLDER_KEY_UNVERIFIED)
  return folderKey
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
  unwrapInviteOwnerCopy: typeof unwrapInviteOwnerCopy
  openLegacyInviteOwnerCopy: typeof openLegacyInviteOwnerCopy
  fromBase64: typeof fromBase64
}

export const REAL_EXISTING_FOLDER_KEY_PORTS: ExistingFolderKeyPorts = {
  getSentInvites,
  getFolderKeys,
  unwrapInviteOwnerCopy,
  openLegacyInviteOwnerCopy,
  fromBase64,
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
 * Open one owner copy (task 2255, L9 as corrected 2026-10-28): the
 * purpose-bound format opens on its own; a LEGACY copy opens only when core
 * proves it over the folder's rows, in one bounded call (a text candidate is
 * refused, any row counts, each id once, at most 64). Null when neither
 * opens with proof. Only an authentication failure of the purpose-bound open
 * falls through to the legacy path; any other error aborts.
 * Residual (attack B): a server that knows the folder's own name key (a
 * pre-2238 folder link, a colluding member of an enclosing shared folder) can
 * forge a legacy copy that passes. P3-3: no key version is bound either.
 */
async function openOwnerCopy(
  masterKey: Uint8Array,
  folderId: string,
  blob: Uint8Array,
  ports: ExistingFolderKeyPorts,
  folderRows: () => Promise<{ file_id: string; encrypted_file_key: string }[]>,
): Promise<Uint8Array | null> {
  try {
    return await ports.unwrapInviteOwnerCopy(masterKey, folderId, blob)
  } catch (e) {
    if (!isAuthenticationFailure(e)) throw e
  }
  return ports.openLegacyInviteOwnerCopy(masterKey, folderId, blob, await folderRows())
}

/**
 * Task 2133: the folder's key is minted at its first invite, and every later
 * invite while the folder has an active invite reuses it. The server keeps
 * the FIRST wrapped child key per (folder, file), so a second key would
 * silently and permanently split the folder between earlier and later members.
 *
 * The rule: reuse the NEWEST owner blob that opens (see `openOwnerCopy`),
 * among this folder's invites that are active by status only
 * (invited/claimed/approved; denied excluded, expires_at ignored). Mint a new
 * key only when the folder has no active invite (null). Throws, never mints,
 * when the folder has active invites but no blob opens with proof: none of
 * them carries an owner blob, or every blob fails. The folder's rows are
 * fetched once, and only when a legacy blob needs proof (the server keeps one
 * row set per folder). (Rotation on revoke is a separate decision.)
 *
 * Returns the blob that opened plus its key. The caller owns (and must
 * zeroize) the key.
 */
export async function findExistingFolderKey(
  masterKey: Uint8Array,
  folderId: string,
  ports: ExistingFolderKeyPorts = REAL_EXISTING_FOLDER_KEY_PORTS,
): Promise<{ folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null> {
  const active = activeFolderInvites(await ports.getSentInvites(), folderId)
  if (active.length === 0) return null
  const blobs = uniqueOwnerBlobs(active)
  if (blobs.length === 0) throw new Error(FOLDER_KEY_UNVERIFIED)

  let rows: ReturnType<typeof ports.getFolderKeys> | undefined
  const folderRows = () => (rows ??= ports.getFolderKeys(active[0].id))
  for (const b64 of blobs) {
    const folderKey = await openOwnerCopy(masterKey, folderId, ports.fromBase64(b64), ports, folderRows)
    if (folderKey) return { folderKey, encryptedOwnerFolderKeyB64: b64 }
  }
  throw new Error(FOLDER_KEY_UNVERIFIED)
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
 * from an earlier invite, minted only when none is active), every child's key
 * wrapped under it, the owner's own copy (always written in the purpose-bound
 * format, so a proven legacy key is upgraded), and the key's id (see
 * `folderKeyId`). The caller owns the returned `folderKey` and must
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
