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
import {
  readFileMetadata,
  fromBase64,
  toBase64,
  zeroize,
  unwrapOwnerFileKey as coreUnwrapOwnerFileKey,
  wrapOwnerFileKey as coreWrapOwnerFileKey,
} from './crypto'
import { adoptOwnerFileKey, getFile, getSentInvites, getSharedFolder, type ShareInvite, type SharedFolderInfo } from './api'
import { listSharedFolderKeys } from './api-folder-links'
import { collectAllChildItems } from './folder-share-crypto'
import { assertNeverSawCustody, assertNoSeenAncestor, markCustodySeen } from './custody-memory'
import { forgetFeatureFlags, sharedFoldersEnabled } from './use-feature-flag'
import { ownedItem } from './owned-item'
import {
  activeFolderInvites,
  noCustodyRecord,
  openFolderChild,
  openFolderCustody,
  type FolderWrapFormat,
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

/**
 * The folder's custody record, or null when it definitely has none.
 *
 * STRICT (rv-web198c P1-1): only a definitive "no record" (404 / 405 / 501) is
 * null. Anything else (5xx, 429, offline) THROWS: read as "no custody" it put a
 * custody folder on the legacy unbound reader. A null answer is cached for
 * CUSTODY_RECHECK_MS, a record for the session; a failure is never cached.
 * With the flag off no request is made at all (rv-web198c P2-1): null.
 */
export async function sharedFolderCustody(folderId: string): Promise<SharedFolderInfo | null> {
  if (!(await sharedFoldersEnabled())) return null
  const cached = fresh(custodyCache.get(folderId), (value) => value !== null)
  if (cached) {
    try { return await cached } catch { /* stale or failed: refetch below */ }
  }
  const value = getSharedFolder(folderId).then(
    (info) => info,
    (error: unknown) => {
      // By status, not by class: only 404 / 405 / 501 mean "no record".
      if (noCustodyRecord(error)) return null
      throw error
    },
  )
  custodyCache.set(folderId, { at: Date.now(), value })
  value.catch(() => {
    if (custodyCache.get(folderId)?.value === value) custodyCache.delete(folderId)
  })
  return value
}

/**
 * Decision L7b: the folder's wrap format, from its custody record: `l7` when
 * it has one, `legacy_invite` when it definitely has none (a flag-off
 * invite-only share, or a server without the route). STRICT: any other failure
 * throws, so a write never falls back to the legacy format by accident.
 *
 * L7c/L7d: legacy only when neither the root nor ANY ancestor of `fromFolderId`
 * (the item's folder; the root by default) was seen with custody.
 */
export async function folderWrapFormat(rootId: string, fromFolderId: string = rootId): Promise<FolderWrapFormat> {
  // sharedFolderCustody is strict (a non-definitive failure throws) and caches
  // the definitive answers, so a flag-off or legacy folder is not re-asked on
  // every upload.
  if (await sharedFolderCustody(rootId)) return 'l7'
  assertNeverSawCustody(rootId)
  await assertNoSeenAncestor(fromFolderId, parentOf)
  return 'legacy_invite'
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

/**
 * Lock, sign-out, sign-in and an account switch (key-context): forget this
 * session's shared-folder lookups and the per-user flag. The custody memory is
 * deliberately NOT part of it (L7d): it belongs to the device and only grows.
 */
export function forgetSharedFolderSession(): void {
  clearSharedFolderLookups()
  forgetFeatureFlags()
}

/** Forget every cached lookup. */
export function clearSharedFolderLookups(): void {
  custodyCache.clear()
  parentCache.clear()
  sentInvitesCache = null
  // rv-web198c P3: the adoption bookkeeping is per account too.
  adoptedThisSession.clear()
}

export interface AdoptableFile {
  id: string
  name_encrypted?: string
  parent_id: string | null
  /** A folder's wrap is bound as kind folder (L7); a guest can add folders too. */
  is_folder?: boolean
  /** Set on a file added through a folder link. */
  acted_via_share_id?: string | null
  /** Set on a file added by a signed-in member. */
  uploaded_by?: string | null
  /** Present once some owner client has adopted the file. */
  owner_wrapped_file_key?: string | null
}

/**
 * L12 (contract 2275): the id class decides whose key path a row is on, never
 * attribution columns — a server fills those in and can lie about them. This
 * is core's answer for one id.
 */
export async function itemIsForeign(itemId: string): Promise<boolean> {
  return ownedItem.isForeign(itemId)
}

/**
 * Session memory of the id class, so list rendering can mark a row without an
 * async call per row. Filled by `classifyItemIds` (core); a row that was never
 * classified is NOT treated as foreign by the synchronous readers below.
 */
const foreignIds = new Set<string>()
const ownerIds = new Set<string>()

/** Ask core for these ids' class and remember it. Non-canonical ids are skipped. */
export async function classifyItemIds(ids: Iterable<string>): Promise<void> {
  for (const id of ids) {
    if (foreignIds.has(id) || ownerIds.has(id)) continue
    try {
      ;(await ownedItem.isForeign(id)) ? foreignIds.add(id) : ownerIds.add(id)
    } catch {
      /* not a canonical id: never an F item, and never displayed as one */
    }
  }
}

/** Sync view of `classifyItemIds`' answer; false until the id has been classified. */
export function isForeignItemById(itemId: string): boolean {
  return foreignIds.has(itemId)
}

/**
 * True when the owner must open this row through the shared-folder path. The
 * class is authoritative; the attribution fields are only a hint used until
 * this client has classified the row (a listing render), because they are
 * server-supplied and must never decide key handling.
 */
export function needsOwnership(
  f: Pick<AdoptableFile, 'acted_via_share_id' | 'uploaded_by'> & { id?: string },
  viewerId?: string | null,
): boolean {
  if (f.id && foreignIds.has(f.id)) return true
  if (f.id && ownerIds.has(f.id)) return false
  return f.acted_via_share_id != null || (!!f.uploaded_by && f.uploaded_by !== viewerId)
}

/**
 * The wire form of an owner wrap (`owner_wrapped_file_key`): base64 of core's
 * L8 record, sealed under its own purpose key and AAD bound to the item id
 * (core wrapOwnerFileKey). Not the derive_file_key seal it once was: under
 * that key a folder's own name blob or an item's v1 content frame opened as
 * an "owner wrap" (rv-web198c).
 */
export async function wrapFileKeyToMaster(
  masterKey: Uint8Array,
  fileId: string,
  fileKey: Uint8Array,
): Promise<string> {
  // L12: core's wrap refuses an O id. Refuse here first so the caller sees the
  // reason, not a generic wasm error.
  if (!(await itemIsForeign(fileId))) {
    throw new Error('an owner wrap is written for a foreign (F) item id only (L12)')
  }
  return toBase64(await coreWrapOwnerFileKey(masterKey, fileId, fileKey))
}

/** Open an L8 owner wrap. Null when it does not open (any other blob is refused by core). */
export async function unwrapOwnerFileKey(
  masterKey: Uint8Array,
  fileId: string,
  ownerWrappedFileKey: string | number[],
): Promise<Uint8Array | null> {
  try {
    const bytes = typeof ownerWrappedFileKey === 'string' ? fromBase64(ownerWrappedFileKey) : Uint8Array.from(ownerWrappedFileKey)
    return await coreUnwrapOwnerFileKey(masterKey, fileId, bytes)
  } catch {
    return null
  }
}

/**
 * The shared folder's key, unwrapped from its permanent custody record
 * (`shared_folders.owner_wrapped_folder_key`), the key's one source (decision
 * L1). Null when the folder has no custody record: the folder key is minted at
 * random and is NEVER derived from the master key, and the owner has no legacy
 * read (below), so there is nothing to fall back to.
 */
export async function folderKeyForRoot(
  masterKey: Uint8Array,
  folderId: string,
): Promise<Uint8Array | null> {
  return (await rootKeyAndFormat(masterKey, folderId))?.folderKey ?? null
}

/**
 * The root's folder key and its wrap format (L7b), for the OWNER. With a
 * custody record the key comes from it (L6) and every child wrap is L7.
 *
 * Without one (a flag-off invite-only share) this is null (rv-web198d R1). The
 * only owner copy such a folder has is its invite's legacy
 * `encrypted_owner_folder_key`, sealed under the folder-NAME key: a server can
 * pass the folder's own name blob off as one, forge an unbound child row under
 * that server-known key, and adoption would store the forged key for good.
 * Main never read it on the owner side either. Task 2255 brings a legacy
 * opener with proof of possession (L9); until then there is no owner-side
 * legacy read. Members keep reading legacy folders with the key their own
 * invite carries.
 */
export async function rootKeyAndFormat(
  masterKey: Uint8Array,
  folderId: string,
): Promise<{ folderKey: Uint8Array; format: FolderWrapFormat } | null> {
  const custody = await sharedFolderCustody(folderId)
  if (!custody) return null
  const wrapped = custody.owner_wrapped_folder_key
  if (!wrapped) return null
  try {
    const folderKey = await openFolderCustody(masterKey, folderId, fromBase64(wrapped))
    markCustodySeen(folderId)
    return { folderKey, format: 'l7' }
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
  // L12: adoption writes an L8 envelope for an F id only. An O row's key is
  // derived from the master, so there is nothing to adopt — and core's wrap
  // refuses an O id anyway. Never post a key for a row the server made to look
  // foreign.
  if (!(await itemIsForeign(file.id))) {
    throw new Error('owner adoption is for a foreign (F) item id only (L12)')
  }
  const root = await rootKeyAndFormat(masterKey, folderId)
  if (!root) throw new Error('The folder key is not available on this device.')
  let fileKey: Uint8Array
  try {
    fileKey = await openFolderChild(root.format, root.folderKey, { rootId: folderId, itemId: file.id, isFolder: !!file.is_folder }, encryptedFileKeyB64)
  } finally { zeroize(root.folderKey) }
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
  const root = await rootKeyAndFormat(masterKey, folderId)
  if (!root) return null
  try {
    return await openFolderChild(root.format, root.folderKey, { rootId: folderId, itemId: file.id, isFolder: !!file.is_folder }, encrypted)
  } catch {
    return null
  } finally { zeroize(root.folderKey) }
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
    // Best effort and write-once; a refusal must not undo the open. The
    // adoption route is a flag-on route: with the flag off nothing is posted.
    try {
      let index: Map<string, string> | null = null
      if (!file.owner_wrapped_file_key) {
        index = await keyIndexPromise
      }
      const encrypted = index?.get(file.id)
      if (encrypted && !file.owner_wrapped_file_key && (await sharedFoldersEnabled())) {
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

/** Deepest folder nesting the walk follows before it gives up. */
const MAX_ROOT_WALK = 16

/**
 * getFileKeyForFile's half for a row the owner did not create (a guest's or
 * another member's): its L8 owner wrap, else its wrap in the shared folder it
 * sits in. Null for the owner's own rows, when nothing opens, and for EVERY row
 * with the flag off (rv-web198d R1): then no shared-folder request is made and
 * the caller derives the key, as the app before shared folders did. A
 * server-supplied owner wrap is never tried on the owner's own rows
 * (rv-web198c P2-2).
 */
export async function foreignRowKey(args: {
  masterKey: Uint8Array
  file: AdoptableFile
  viewerId: string | null
  keyIndexFor: (rootId: string, fileId: string) => Promise<Map<string, string>>
}): Promise<Uint8Array | null> {
  const { masterKey, file, viewerId, keyIndexFor } = args
  if (!needsOwnership(file, viewerId)) return null
  // The server's columns are a hint only (L12): an id that is not foreign is
  // the owner's own row, and its wrap path is never taken for it.
  if (!(await itemIsForeign(file.id))) return null
  if (!(await sharedFoldersEnabled())) return null
  if (file.owner_wrapped_file_key) {
    const owned = await unwrapOwnerFileKey(masterKey, file.id, file.owner_wrapped_file_key)
    if (owned) return owned
  }
  const root = await sharedRootFor(file.parent_id ?? null, file.id)
  if (!root) return null
  const opened = await openOwnerFile({
    masterKey,
    folderId: root,
    file,
    keyIndexPromise: keyIndexFor(root, file.id),
    labelFor: async () => null,
  })
  return opened.kind === 'ok' ? opened.fileKey : null
}

/**
 * rv-web198d N2: with the flag reading off (a failed read, or a rollback), an
 * owner write under a folder this client has seen with custody must not be
 * skipped as "not shared": its wrap would never be published and the write
 * would report success. This walks up from `folderId` through the custody
 * memory only (no custody request) and throws for such a folder (L7d: any
 * ancestor). With nothing in the memory, which is every flag-off device today,
 * it asks nothing.
 */
export async function assertNoSeenCustodyAbove(folderId: string): Promise<void> {
  await assertNoSeenAncestor(folderId, parentOf)
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

/** A refused move-out: F items under the folder could not be adopted first. */
export class MoveNeedsAdoptionError extends Error {
  constructor(readonly itemIds: string[]) {
    super('This folder has items added by someone else that could not be saved to your account first, so it was not moved.')
    this.name = 'MoveNeedsAdoptionError'
  }
}

/** L12 bound: at most this many F items are adopted for one move. */
export const ADOPTION_MAX_ITEMS = 10_000

/** A move that would sweep more than `ADOPTION_MAX_ITEMS` F items. */
export class AdoptionTooLargeError extends Error {
  constructor(readonly total: number) {
    super(
      `This folder holds more than ${ADOPTION_MAX_ITEMS} items added by someone else, so it was not moved.`,
    )
    this.name = 'AdoptionTooLargeError'
  }
}

/** Two core-resolved keys are the same key (the check, not a crypto step). */
function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

/** The wraps a custody root holds, by item id (owner or member read). */
async function keysUnderRoot(rootId: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  let cursor: string | null = null
  do {
    const page = await listSharedFolderKeys(rootId, { cursor })
    for (const row of page.keys) index.set(row.file_id, row.encrypted_file_key)
    cursor = page.next_cursor
  } while (cursor)
  return index
}

/**
 * L12 (2275): before an owner moves an F item, or a folder with F descendants,
 * out of its shared root, every one of those F items is adopted under the
 * owner's master and READ BACK. Anything that cannot be adopted refuses the
 * move (`MoveNeedsAdoptionError`); a move that quietly dropped someone else's
 * key would strand their item.
 */
export async function adoptForeignTreeBeforeMove(args: {
  masterKey: Uint8Array
  rootId: string
  itemIds: string[]
  /** The moved rows' kinds, when the caller has them (F4): a folder's
   * descendants are only adopted when it is known to be a folder. */
  items?: ReadonlyArray<{ id: string; is_folder: boolean }>
}): Promise<{ adopted: number }> {
  const { masterKey, rootId, itemIds } = args
  // L12 bound: a move that would adopt more than the cap is refused outright,
  // before a single key is written.
  if (itemIds.length > ADOPTION_MAX_ITEMS) throw new AdoptionTooLargeError(itemIds.length)
  const index = await keysUnderRoot(rootId)
  const kinds = new Map((args.items ?? []).map((item) => [item.id, item.is_folder]))
  const queue: { id: string; isFolder: boolean }[] = []
  for (const id of itemIds) {
    const known = kinds.get(id)
    // F4: a moved folder seeded as a file never had its contents adopted. Take
    // the kind from the caller's row, else from the server row for this id.
    const isFolder = known ?? !!(await getFile(id).catch(() => null))?.is_folder
    queue.push({ id, isFolder })
  }
  const seen = new Set<string>()
  const failed: string[] = []
  let adopted = 0
  while (queue.length) {
    const item = queue.shift()!
    if (seen.has(item.id)) continue
    seen.add(item.id)
    if (item.isFolder) {
      for (const child of await collectAllChildItems(item.id)) {
        queue.push({ id: child.id, isFolder: child.isFolder })
      }
      if (seen.size + queue.length > ADOPTION_MAX_ITEMS) {
        throw new AdoptionTooLargeError(seen.size + queue.length)
      }
    }
    if (!(await itemIsForeign(item.id))) continue
    const row = await getFile(item.id).catch(() => null)
    if (row?.owner_wrapped_file_key) {
      const opened = await unwrapOwnerFileKey(masterKey, item.id, row.owner_wrapped_file_key)
      if (opened) {
        zeroize(opened)
        continue
      }
    }
    const wrapped = index.get(item.id)
    if (!wrapped) {
      failed.push(item.id)
      continue
    }
    try {
      const res = await adoptGuestFile({
        masterKey,
        folderId: rootId,
        file: { id: item.id, parent_id: row?.parent_id ?? null, is_folder: item.isFolder, name_encrypted: row?.name_encrypted },
        encryptedFileKeyB64: wrapped,
      })
      if (!res.adopted) {
        zeroize(res.fileKey)
        // Write-once: a wrap another owner client stored is proof enough.
        const readBack = row?.owner_wrapped_file_key ?? null
        if (!readBack || !(await unwrapOwnerFileKey(masterKey, item.id, readBack))) failed.push(item.id)
        continue
      }
      adopted += 1
      // F13: the stored wrap must hold the key this client just adopted, not
      // merely open for this item — a server that accepted the adoption could
      // store a wrap of its own. Both sides come from core; compare the keys.
      const readBack = await getFile(item.id).catch(() => null)
      const stored = await unwrapOwnerFileKey(masterKey, item.id, readBack?.owner_wrapped_file_key ?? '')
      const holdsAdopted = !!stored && keysEqual(stored, res.fileKey)
      if (stored) zeroize(stored)
      zeroize(res.fileKey)
      if (!holdsAdopted) failed.push(item.id)
    } catch {
      failed.push(item.id)
    }
  }
  if (failed.length) throw new MoveNeedsAdoptionError(failed)
  return { adopted }
}
