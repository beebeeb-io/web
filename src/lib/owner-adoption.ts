/**
 * Task 2237b — the owner's side of guest- and member-added files.
 *
 * A guest adding a file makes a random file key and wraps it under the shared
 * folder's key. The owner can therefore open it through the folder key, but
 * that wrap disappears if every link is revoked or the file leaves the folder.
 * Spec §6a closes that hole with "adoption": the first time an owner client
 * sees such a file it also stores `owner_wrapped_file_key`, a copy of the file
 * key wrapped to the owner's own master key. Adoption is write-once on the
 * server and best effort on the client: failing to adopt must never stop the
 * owner opening the file through the folder key.
 */
import { decryptChunk, readFileMetadata, deriveFileKey, encryptChunk, fromBase64, toBase64, zeroize } from './crypto'
import { ApiError, adoptOwnerFileKey, getFile, getSentInvites, getSharedFolder, type ShareInvite, type SharedFolderInfo } from './api'
import {
  activeFolderInvites,
  decryptChildFileKey,
  decryptOwnerFolderKey,
  findExistingFolderKey,
} from './folder-share-crypto'

// ─── Custody and root lookups (cached) ─────────────────────────────────────
//
// Every row in a shared folder asks "which shared root am I under?" and "what
// is that root's custody record?" on every decrypt pass. Uncached, a 200-row
// folder cost several hundred API calls per pass. A custody record is
// permanent once it exists, so a hit is kept for the session; a 404 (not a
// shared folder) and a parent lookup are re-checked after a short window,
// because a folder can become shared, or be moved, while the page is open.
// Other errors are never cached. Nothing here is plaintext key material.

/** How long a "not shared" answer or a parent lookup stays trusted. */
export const CUSTODY_RECHECK_MS = 10_000

type Timed<T> = { at: number; value: Promise<T> }
const custodyCache = new Map<string, Timed<SharedFolderInfo | null>>()
const parentCache = new Map<string, Timed<string | null>>()

function fresh<T>(entry: Timed<T> | undefined, keepForever: (value: T) => boolean): Promise<T> | null {
  if (!entry) return null
  return entry.value.then((value) =>
    keepForever(value) || Date.now() - entry.at < CUSTODY_RECHECK_MS ? value : Promise.reject(new Error('stale')),
  )
}

/** The folder's custody record, or null when it is not a shared folder. */
export async function sharedFolderCustody(folderId: string): Promise<SharedFolderInfo | null> {
  const cached = fresh(custodyCache.get(folderId), (value) => value !== null)
  if (cached) {
    try { return await cached } catch { /* stale: refetch below */ }
  }
  const value = getSharedFolder(folderId).then(
    (info) => info,
    (error: unknown) => {
      // Only a definite "no custody record" is remembered; anything else
      // (offline, 5xx, 429) is retried by the next caller.
      if (error instanceof ApiError && error.status === 404) return null
      if (custodyCache.get(folderId)?.value === value) custodyCache.delete(folderId)
      return null
    },
  )
  custodyCache.set(folderId, { at: Date.now(), value })
  return value
}

async function parentOf(id: string): Promise<string | null> {
  const cached = fresh(parentCache.get(id), () => false)
  if (cached) {
    try { return await cached } catch { /* stale: refetch below */ }
  }
  const value = getFile(id).then((row) => row.parent_id ?? null)
  parentCache.set(id, { at: Date.now(), value })
  value.catch(() => { if (parentCache.get(id)?.value === value) parentCache.delete(id) })
  return value
}

let sentInvitesCache: Timed<ShareInvite[]> | null = null

/**
 * The owner's sent invites, re-read after the same window. A folder shared
 * only with members (no link yet) has no custody record; its root is known
 * from an active folder invite instead, and its key from that invite.
 */
async function sentInvites(): Promise<ShareInvite[]> {
  const cached = fresh(sentInvitesCache ?? undefined, () => false)
  if (cached) {
    try { return await cached } catch { /* stale: refetch below */ }
  }
  const value = getSentInvites()
  sentInvitesCache = { at: Date.now(), value }
  value.catch(() => { if (sentInvitesCache?.value === value) sentInvitesCache = null })
  return value
}

/** Drop cached custody answers, e.g. right after this client shared a folder. */
export function forgetSharedFolderCustody(folderId?: string): void {
  if (folderId) custodyCache.delete(folderId)
  else custodyCache.clear()
  sentInvitesCache = null
}

/** Lock / sign-out: forget every cached lookup. */
export function clearSharedFolderLookups(): void {
  custodyCache.clear()
  parentCache.clear()
  sentInvitesCache = null
}

export interface AdoptableFile {
  id: string
  name_encrypted?: string
  parent_id: string | null
  /** Set on a file added through a folder link. */
  acted_via_share_id?: string | null
  /** Set on a file added by a signed-in member. */
  uploaded_by?: string | null
  /** Present once some owner client has adopted the file. */
  owner_wrapped_file_key?: string | null
}

/**
 * True when this row's key is not derivable from the master key, so the owner
 * needs the shared-folder path (or the owner wrap) to open it.
 */
export function needsOwnership(
  f: Pick<AdoptableFile, 'acted_via_share_id' | 'uploaded_by'>,
  viewerId?: string | null,
): boolean {
  return f.acted_via_share_id != null || (!!f.uploaded_by && f.uploaded_by !== viewerId)
}

/**
 * The wire form of an owner wrap: base64 of `nonce || ciphertext`, sealed
 * under `derive_file_key(master_key, file_id)` — the same derivation every
 * normal file key uses, so any owner client can open it without new core
 * support.
 */
export async function wrapFileKeyToMaster(
  masterKey: Uint8Array,
  fileId: string,
  fileKey: Uint8Array,
): Promise<string> {
  const derived = await deriveFileKey(masterKey, fileId)
  try {
    const { nonce, ciphertext } = await encryptChunk(derived, fileKey)
    const combined = new Uint8Array(nonce.length + ciphertext.length)
    combined.set(nonce, 0)
    combined.set(ciphertext, nonce.length)
    return toBase64(combined)
  } finally {
    zeroize(derived)
  }
}

/** Open an owner wrap. Returns null when it does not open with this master key. */
export async function unwrapOwnerFileKey(
  masterKey: Uint8Array,
  fileId: string,
  ownerWrappedFileKey: string | number[],
): Promise<Uint8Array | null> {
  try {
    const derived = await deriveFileKey(masterKey, fileId)
    try {
      const bytes = typeof ownerWrappedFileKey === 'string' ? fromBase64(ownerWrappedFileKey) : Uint8Array.from(ownerWrappedFileKey)
      if (bytes.length <= 12) return null
      const fileKey = await decryptChunk(derived, bytes.slice(0, 12), bytes.slice(12))
      return fileKey.length === 32 ? fileKey : null
    } finally {
      zeroize(derived)
    }
  } catch {
    return null
  }
}

/**
 * The shared folder's key, unwrapped from its permanent custody record
 * (`shared_folders.owner_wrapped_folder_key`), the key's one source (decision
 * L1). A folder shared only with members has no custody record yet; its key is
 * the one its active invites carry. Null when neither exists: the folder key is
 * minted at random and is NEVER derived from the master key, so there is
 * nothing to fall back to.
 */
export async function folderKeyForRoot(
  masterKey: Uint8Array,
  folderId: string,
): Promise<Uint8Array | null> {
  const custody = await sharedFolderCustody(folderId)
  const wrapped = custody?.owner_wrapped_folder_key
  if (wrapped) {
    try {
      const bytes = fromBase64(wrapped)
      if (bytes.length <= 12) return null
      return await decryptOwnerFolderKey(masterKey, folderId, bytes)
    } catch {
      return null
    }
  }
  try {
    const existing = await findExistingFolderKey(masterKey, folderId)
    return existing?.folderKey ?? null
  } catch {
    return null
  }
}

/** Files this client has already adopted in this session, so it never re-posts. */
const adoptedThisSession = new Set<string>()

/**
 * Store the owner's own copy of a guest file's key. Write-once: a row that
 * already carries a wrap, or that this client already adopted, is not posted
 * again. A server refusal (404/409) leaves `adopted` false and never throws —
 * the folder-key path still opens the file.
 */
export async function adoptGuestFile(args: {
  masterKey: Uint8Array
  folderId: string
  file: AdoptableFile
  encryptedFileKeyB64: string
}): Promise<{ adopted: boolean; fileKey: Uint8Array }> {
  const { masterKey, folderId, file, encryptedFileKeyB64 } = args
  const folderKey = await folderKeyForRoot(masterKey, folderId)
  if (!folderKey) throw new Error('The folder key is not available on this device.')
  let fileKey: Uint8Array
  try { fileKey = await decryptChildFileKey(folderKey, encryptedFileKeyB64) }
  finally { zeroize(folderKey) }
  // A write-once owner wrap must never preserve an unverified or stale key.
  try {
    const metadata = file.name_encrypted ?? (await getFile(file.id)).name_encrypted
    await readFileMetadata(fileKey, metadata)
  } catch (error) {
    zeroize(fileKey)
    throw error
  }

  if (file.owner_wrapped_file_key || adoptedThisSession.has(file.id)) {
    return { adopted: false, fileKey }
  }
  try {
    const ownerWrapped = await wrapFileKeyToMaster(masterKey, file.id, fileKey)
    const res = await adoptOwnerFileKey(file.id, ownerWrapped)
    if (res?.adopted) adoptedThisSession.add(file.id)
    return { adopted: res?.adopted === true, fileKey }
  } catch {
    return { adopted: false, fileKey }
  }
}

/**
 * The key for a file the owner did not upload: the owner wrap when this
 * client already has one, else the per-file key from the folder's key index.
 * Null when neither opens — the caller renders the "can't open" row.
 */
export async function resolveSharedFileKey(args: {
  masterKey: Uint8Array
  folderId: string
  file: AdoptableFile
  keyIndexPromise: Promise<Map<string, string>>
}): Promise<Uint8Array | null> {
  const { masterKey, folderId, file, keyIndexPromise } = args
  if (file.owner_wrapped_file_key) {
    const fromWrap = await unwrapOwnerFileKey(masterKey, file.id, file.owner_wrapped_file_key)
    if (fromWrap) return fromWrap
  }
  let index: Map<string, string>
  try {
    index = await keyIndexPromise
  } catch {
    return null
  }
  const encrypted = index.get(file.id)
  if (!encrypted) return null
  const folderKey = await folderKeyForRoot(masterKey, folderId)
  if (!folderKey) return null
  try {
    return await decryptChildFileKey(folderKey, encrypted)
  } catch {
    return null
  } finally { zeroize(folderKey) }
}

export type OwnerOpenResult =
  | { kind: 'ok'; fileKey: Uint8Array }
  | { kind: 'cannot_open'; shareLabel: string | null }
  | { kind: 'update_required' }

/**
 * Open a row the owner did not upload. On success the file is adopted (once)
 * so it survives the folder key going away. On failure the caller shows the
 * origin: "Can't open this file (added via {label})".
 */
export async function openOwnerFile(args: {
  masterKey: Uint8Array
  folderId: string
  file: AdoptableFile
  keyIndexPromise: Promise<Map<string, string>>
  labelFor: (shareId: string | null) => Promise<string | null>
}): Promise<OwnerOpenResult> {
  const { masterKey, folderId, file, keyIndexPromise, labelFor } = args
  const fileKey = await resolveSharedFileKey({ masterKey, folderId, file, keyIndexPromise })
  if (fileKey) {
    // Best effort and write-once; a refusal must not undo the open.
    try {
      let index: Map<string, string> | null = null
      if (!file.owner_wrapped_file_key) {
        index = await keyIndexPromise
      }
      const encrypted = index?.get(file.id)
      if (encrypted && !file.owner_wrapped_file_key) {
        const adopted = await adoptGuestFile({ masterKey, folderId, file, encryptedFileKeyB64: encrypted })
        zeroize(adopted.fileKey)
      }
    } catch {
      /* adoption is best effort */
    }
    return { kind: 'ok', fileKey }
  }

  const shareId = file.acted_via_share_id ?? null
  if (!shareId) return { kind: 'update_required' }
  let label: string | null = null
  try {
    label = await labelFor(shareId)
  } catch {
    label = null
  }
  return { kind: 'cannot_open', shareLabel: label }
}

/**
 * True when `folderId` is the root of a shared folder: it has a custody record
 * (shared through a link, or since), or an active folder invite (shared with
 * members only).
 */
async function isSharedRoot(folderId: string): Promise<boolean> {
  if ((await sharedFolderCustody(folderId)) !== null) return true
  try {
    return activeFolderInvites(await sentInvites(), folderId).length > 0
  } catch {
    return false
  }
}

/** Deepest folder nesting the walk follows before it gives up. */
const MAX_ROOT_WALK = 16

/** The nearest shared root at or above `folderId`, or null. */
async function rootFromFolder(folderId: string): Promise<string | null> {
  let cursor: string | null = folderId
  for (let depth = 0; depth < MAX_ROOT_WALK && cursor; depth++) {
    if (await isSharedRoot(cursor)) return cursor
    try {
      cursor = await parentOf(cursor)
    } catch {
      return null
    }
  }
  return null
}

/**
 * The shared folder a row lives in. A file added through a link can sit at any
 * depth under the folder that was shared, so this walks up from the folder the
 * viewer is in (or from the row's own parent). Null when no ancestor is a
 * shared folder — an ordinary vault file needs none of this. Every lookup on
 * the way is cached (see `sharedFolderCustody`), so a listing of N rows costs a
 * handful of requests, not N walks.
 */
export async function sharedRootFor(
  startFolderId: string | null,
  fileId: string,
): Promise<string | null> {
  if (startFolderId) {
    const root = await rootFromFolder(startFolderId)
    if (root) return root
  }
  let parent: string | null
  try {
    parent = await parentOf(fileId)
  } catch {
    return null
  }
  if (!parent || parent === startFolderId) return null
  return rootFromFolder(parent)
}
