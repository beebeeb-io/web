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
  wrapFolderChild,
  unwrapFolderChild,
  wrapFolderCustody,
  unwrapFolderCustody,
  FOLDER_CHILD_FILE,
  FOLDER_CHILD_FOLDER,
  type FolderChildKind,
} from './crypto'
import { listFilesPage, getSentInvites, getSharedFolder, FILE_LIST_HARD_CAP } from './api'
import { assertNeverSawCustody, markCustodySeen } from './custody-memory'
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

// ─── Decision L6: the folder key's custody record ────────────────────────────
// `shared_folders.owner_wrapped_folder_key` is sealed by core under a purpose
// key HKDF(master, "beebeeb-folder-custody-v1" || folder_id) with that context
// as AAD. It is never the folder-name key, so a server cannot pass a name blob
// off as custody, and the reader refuses the legacy unbound owner copy.

/** L6: seal a custody record for `folderId` (nonce || ct). */
export async function sealFolderCustody(
  masterKey: Uint8Array,
  folderId: string,
  folderKey: Uint8Array,
): Promise<Uint8Array> {
  return wrapFolderCustody(masterKey, folderId, folderKey)
}

/** L6: open a custody record for `folderId`. A legacy owner copy does not open. */
export async function openFolderCustody(
  masterKey: Uint8Array,
  folderId: string,
  custody: Uint8Array,
): Promise<Uint8Array> {
  return unwrapFolderCustody(masterKey, folderId, custody)
}

// ─── Decision L7b: the legacy invite format ──────────────────────────────────
// A folder shared only by a flag-off invite (the 2238 bundle path) has NO
// custody record. Its invite's owner copy (`encrypted_owner_folder_key`) and its
// child wraps were sealed before L6/L7: the owner copy under
// derive_file_key(master, folder_id), the children with an empty AAD. Those
// rows stay readable, and the flag-off path keeps writing them, ONLY through
// the four functions below. A folder with custody never reaches them (test:
// folder-wrap-format.test.ts). The owner copy also seeds custody (L6).

/** Legacy invite owner copy (`encrypted_owner_folder_key`), flag-off path only. */
export async function legacyInviteOwnerWrap(
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

/** Open a legacy invite owner copy: to seed custody, or for a flag-off folder. */
export async function legacyInviteOwnerKey(
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
  deriveFileKey: typeof deriveFileKey
  decryptChunk: typeof decryptChunk
  fromBase64: typeof fromBase64
  zeroize: typeof zeroize
}

export const REAL_EXISTING_FOLDER_KEY_PORTS: ExistingFolderKeyPorts = {
  getSentInvites,
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
 * Task 2133: the folder's key is minted at its first invite, and every later
 * invite while the folder has an active invite reuses it. The server keeps
 * one wrapped child key per (folder, file) and upserts on every invite, so a
 * fresh key per invite re-wraps every child under a key the earlier members
 * never received and locks them out.
 *
 * The rule: reuse the NEWEST owner blob that opens, among this folder's
 * invites that are active by status only (invited/claimed/approved; denied
 * excluded, expires_at ignored); mint a new key only when the folder has no
 * active invite. We do NOT trial-decrypt stored child wraps: the server
 * returns them unordered and keeps rows of trashed/moved-out children under
 * older keys, so an arbitrary row can pick an older key and lock out the
 * current member. Exact verification arrives with the server-side key
 * fingerprint (task 2133, design K: folder_key_id, refused on mismatch).
 * (Rotation on revoke is a separate design decision, not done here.)
 *
 * The owner's own copy of the key travels with every folder invite
 * (`encrypted_owner_folder_key`, sealed under the owner's master key).
 *
 * These owner blobs are the LEGACY invite format (L7b): this reader is the
 * custody seed for a folder that has no custody record yet, never a custody
 * reader (that is `openFolderCustody`).
 *
 * Returns the blob to send again verbatim plus the unwrapped key, or null
 * when the folder has no active invite (the caller mints). Throws, never
 * mints, when the folder has active invites but no blob opens: none of them
 * carries an owner blob, or every blob fails authentication. Only an
 * authentication failure counts as "does not open"; any other error (the
 * worker crashed, a malformed blob) propagates as an abort. Minting would lock
 * out the members who hold the existing key. The caller owns (and must
 * zeroize) the returned key.
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

  const wrappingKey = await ports.deriveFileKey(masterKey, folderId)
  try {
    for (const b64 of blobs) {
      try {
        const blob = ports.fromBase64(b64)
        const folderKey = await ports.decryptChunk(wrappingKey, blob.slice(0, 12), blob.slice(12))
        return { folderKey, encryptedOwnerFolderKeyB64: b64 }
      } catch (e) {
        if (!isAuthenticationFailure(e)) throw e
      }
    }
  } finally {
    ports.zeroize(wrappingKey)
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

/**
 * True when a custody lookup definitely found no record the caller can see:
 * 404 (no record), 405 (a server without the route) or 501 (the
 * `shared_folders_v1` gate is off, which is how every flag-off client sees
 * it). Any other failure is not an answer and must abort, never mint or pick
 * the legacy format.
 */
export function noCustodyRecord(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status
  return status === 404 || status === 405 || status === 501
}

/**
 * The folder key from its custody record (`shared_folders`), when one exists:
 * decision L1 makes that record the key's one source, so an invite made after
 * a link reuses the link's key instead of minting a second one (members and
 * guests must open the same files). A 404 means "no record"; any other failure
 * aborts, because minting on a transient error would split the folder's key.
 */
export async function custodyFolderKey(
  masterKey: Uint8Array,
  folderId: string,
): Promise<{ folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null> {
  let wrapped: string | null
  try {
    wrapped = (await getSharedFolder(folderId)).owner_wrapped_folder_key
  } catch (e) {
    // L7c: "no record" means legacy only for a folder never seen with custody.
    if (noCustodyRecord(e)) {
      assertNeverSawCustody(folderId)
      return null
    }
    throw e
  }
  if (!wrapped) {
    assertNeverSawCustody(folderId)
    return null
  }
  const folderKey = await openFolderCustody(masterKey, folderId, fromBase64(wrapped))
  markCustodySeen(folderId)
  return { folderKey, encryptedOwnerFolderKeyB64: wrapped }
}

export interface FolderInvitePorts {
  /** Optional so a test can leave the custody record out; the real ports read it first. */
  custodyFolderKey?: (masterKey: Uint8Array, folderId: string) => ReturnType<typeof custodyFolderKey>
  findExistingFolderKey: (masterKey: Uint8Array, folderId: string) => ReturnType<typeof findExistingFolderKey>
  generateFolderKey: () => Promise<Uint8Array>
  encryptAllChildrenKeys: typeof encryptAllChildrenKeys
  /** The legacy owner copy, for a folder with no custody record (flag-off invite). */
  legacyInviteOwnerWrap: typeof legacyInviteOwnerWrap
  /** The root's own name key, published under the folder key for a custody folder (L7). */
  deriveFileKey: typeof deriveFileKey
  /** L7: the root's name-key wrap, bound to (root, root, folder). */
  sealChildKey: (folderKey: Uint8Array, ref: FolderChildRef, childKey: Uint8Array) => Promise<string>
  folderKeyId: (folderKey: Uint8Array) => Promise<string>
}

export const REAL_FOLDER_INVITE_PORTS: FolderInvitePorts = {
  custodyFolderKey: (m, f) => custodyFolderKey(m, f),
  findExistingFolderKey: (m, f) => findExistingFolderKey(m, f),
  generateFolderKey,
  encryptAllChildrenKeys: (...a) => encryptAllChildrenKeys(...a),
  legacyInviteOwnerWrap,
  deriveFileKey,
  sealChildKey: (k, ref, child) => sealChildKey(k, ref, child),
  folderKeyId: (k) => folderKeyId(k),
}

/**
 * Everything a folder invite carries (task 2133): the folder's key (reused
 * from an earlier invite, minted only when none is active), every child's key
 * wrapped under it, the owner's own sealed copy, and the key's id for the
 * server's mismatch check. The caller owns the returned `folderKey` and must
 * zeroize it (also needed for the recipient wrap on auto-approve); on a throw
 * the key made here is already zeroized.
 *
 * L7b: the folder's format follows its custody record. A folder WITH custody
 * (shared under the flag; a flag-on invite registers custody before calling
 * this) gets L7 child wraps, the root's own name-key wrap, and the custody
 * record as the owner copy. A folder WITHOUT custody is a flag-off invite-only
 * share and keeps the legacy format, through the named legacy functions.
 */
export async function buildFolderInvite(
  masterKey: Uint8Array,
  folderId: string,
  onProgress?: (stage: 'children', done: number, total: number) => void,
  ports: FolderInvitePorts = REAL_FOLDER_INVITE_PORTS,
): Promise<{ folderKey: Uint8Array; payload: FolderInvitePayload }> {
  // L1: the custody record first, then an active invite's key; mint (at
  // random) only when the folder has neither.
  const custody = ports.custodyFolderKey ? await ports.custodyFolderKey(masterKey, folderId) : null
  const format: FolderWrapFormat = custody ? 'l7' : 'legacy_invite'
  const existing = custody ?? (await ports.findExistingFolderKey(masterKey, folderId))
  const folderKey = existing?.folderKey ?? (await ports.generateFolderKey())
  try {
    const folderKeys = await ports.encryptAllChildrenKeys(masterKey, folderKey, folderId, format, (d, t) =>
      onProgress?.('children', d, t),
    )
    if (format === 'l7') {
      // The root's own name key, so a member can read the folder's name.
      const rootNameKey = await ports.deriveFileKey(masterKey, folderId)
      try {
        folderKeys.unshift({
          file_id: folderId,
          encrypted_file_key: await ports.sealChildKey(folderKey, { rootId: folderId, itemId: folderId, isFolder: true }, rootNameKey),
        })
      } finally {
        zeroize(rootNameKey)
      }
    }
    const encOwner =
      existing?.encryptedOwnerFolderKeyB64 ??
      toBase64(await ports.legacyInviteOwnerWrap(masterKey, folderId, folderKey))
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

// ─── Decision L7: child wraps bound to (shared root, item, kind) ──────────────
// Every child key sealed under a folder key (a file key, or a folder's name key)
// goes through core's wrapFolderChild / unwrapFolderChild, with AAD
// "beebeeb-folder-child-v1" || shared ROOT id || item id || kind. A server can no
// longer move item A's wrap onto item B's row, under another shared folder, or
// as the other kind. `rootId` is the SHARED folder's id, never the item's
// current parent: a move inside the tree keeps the wrap.

/** Where a child wrap sits: the shared root, the item, and whether it is a folder. */
export interface FolderChildRef {
  rootId: string
  itemId: string
  isFolder: boolean
}

export function childKind(isFolder: boolean): FolderChildKind {
  return isFolder ? FOLDER_CHILD_FOLDER : FOLDER_CHILD_FILE
}

/** L7: base64 of core's child wrap. Strict: there is no other format here. */
export async function sealChildKey(
  folderKey: Uint8Array,
  ref: FolderChildRef,
  childKey: Uint8Array,
): Promise<string> {
  return toBase64(await wrapFolderChild(folderKey, ref.rootId, ref.itemId, childKind(ref.isFolder), childKey))
}

/** L7: open a child wrap for exactly this (root, item, kind). No fallback. */
export async function openChildKey(
  folderKey: Uint8Array,
  ref: FolderChildRef,
  wrappedB64: string,
): Promise<Uint8Array> {
  return unwrapFolderChild(folderKey, ref.rootId, ref.itemId, childKind(ref.isFolder), fromBase64(wrappedB64))
}

/** Legacy invite child wrap (empty AAD). L7b: a folder with no custody record only. */
export async function legacyInviteChildWrap(
  folderKey: Uint8Array,
  childKey: Uint8Array,
): Promise<string> {
  const result = await encryptChunk(folderKey, childKey)
  const combined = new Uint8Array(result.nonce.length + result.ciphertext.length)
  combined.set(result.nonce, 0)
  combined.set(result.ciphertext, result.nonce.length)
  return toBase64(combined)
}

/** Open a legacy invite child wrap. L7b: a folder with no custody record only. */
export async function legacyInviteChildKey(
  folderKey: Uint8Array,
  encryptedFileKeyB64: string,
): Promise<Uint8Array> {
  const bytes = fromBase64(encryptedFileKeyB64)
  const nonce = bytes.slice(0, 12)
  const ciphertext = bytes.slice(12)
  return decryptChunk(folderKey, nonce, ciphertext)
}

/**
 * L7b: a folder's wrap format is a fact about the folder, read before any key
 * work: `l7` when it has a custody record, `legacy_invite` when it is a
 * flag-off invite-only share. It is never chosen by trying one and falling back.
 */
export type FolderWrapFormat = 'l7' | 'legacy_invite'

/** Seal a child key in the folder's format. */
export async function sealFolderChild(
  format: FolderWrapFormat,
  folderKey: Uint8Array,
  ref: FolderChildRef,
  childKey: Uint8Array,
): Promise<string> {
  if (format === 'l7') return sealChildKey(folderKey, ref, childKey)
  if (format === 'legacy_invite') return legacyInviteChildWrap(folderKey, childKey)
  // A missing or unknown format is a bug, never a reason to write legacy.
  throw new Error(`unknown folder wrap format: ${String(format)}`)
}

/** Open a child wrap in the folder's format. An L7 folder never opens a legacy wrap. */
export async function openFolderChild(
  format: FolderWrapFormat,
  folderKey: Uint8Array,
  ref: FolderChildRef,
  wrappedB64: string,
): Promise<Uint8Array> {
  if (format === 'l7') return openChildKey(folderKey, ref, wrappedB64)
  if (format === 'legacy_invite') return legacyInviteChildKey(folderKey, wrappedB64)
  throw new Error(`unknown folder wrap format: ${String(format)}`)
}

export async function encryptAllChildrenKeys(
  masterKey: Uint8Array,
  folderKey: Uint8Array,
  folderId: string,
  format: FolderWrapFormat,
  onProgress?: (done: number, total: number) => void,
): Promise<{ file_id: string; encrypted_file_key: string }[]> {
  const allChildren = await collectAllChildItems(folderId)
  const result: { file_id: string; encrypted_file_key: string }[] = []

  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i]
    const fileKey = await deriveFileKey(masterKey, child.id)
    let encrypted: string
    try {
      encrypted = await sealFolderChild(format, folderKey, { rootId: folderId, itemId: child.id, isFolder: child.isFolder }, fileKey)
    } finally {
      zeroize(fileKey)
    }
    result.push({ file_id: child.id, encrypted_file_key: encrypted })
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
  return (await collectAllChildItems(folderId)).map((child) => child.id)
}

/** Every descendant of `folderId`, with whether it is a folder (the L7 kind). */
export async function collectAllChildItems(folderId: string): Promise<{ id: string; isFolder: boolean }[]> {
  const ids: { id: string; isFolder: boolean }[] = []
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
        ids.push({ id: child.id, isFolder: !!child.is_folder })
        if (child.is_folder) queue.push(child.id)
        if (ids.length > FILE_LIST_HARD_CAP) throw new Error(TOO_LARGE_TO_SHARE)
      }
      cursor = page.next_cursor ?? undefined
    } while (cursor)
  }

  return ids
}

// ─── Task 2237b: link helpers for the Share panel ───────────────────────────
// The dialog imports from this module (folder-share crypto is its home); the
// link-specific derivation lives in shared-folder-link-crypto.ts.
export {
  generateLinkKey,
  linkKeyFragment,
  ownerWrappedLinkKey,
  wrapFolderKeyForLink,
} from './shared-folder-link-crypto'
