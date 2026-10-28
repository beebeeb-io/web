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
import { decryptChunk, deriveFileKey, encryptChunk, fromBase64, toBase64, zeroize } from './crypto'
import { adoptOwnerFileKey, getFile, getSharedFolder } from './api'
import { decryptChildFileKey, decryptOwnerFolderKey } from './folder-share-crypto'

export interface AdoptableFile {
  id: string
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
export function needsOwnership(f: AdoptableFile): boolean {
  return f.acted_via_share_id != null || f.uploaded_by != null
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
  ownerWrappedFileKey: string,
): Promise<Uint8Array | null> {
  try {
    const derived = await deriveFileKey(masterKey, fileId)
    try {
      const bytes = fromBase64(ownerWrappedFileKey)
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
 * (`shared_folders.owner_wrapped_folder_key`). Null when this client has no
 * copy — a member before the owner has registered one, or a folder that is
 * gone.
 */
export async function folderKeyForRoot(
  masterKey: Uint8Array,
  folderId: string,
): Promise<Uint8Array | null> {
  try {
    const custody = await getSharedFolder(folderId)
    const wrapped = custody?.owner_wrapped_folder_key
    if (!wrapped) return null
    const bytes = fromBase64(wrapped)
    if (bytes.length <= 12) return null
    return await decryptOwnerFolderKey(masterKey, folderId, bytes)
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
  const fileKey = await decryptChildFileKey(folderKey, encryptedFileKeyB64)

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
  }
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
        await adoptGuestFile({ masterKey, folderId, file, encryptedFileKeyB64: encrypted })
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

/** True when `folderId` has a permanent custody record (it is a shared folder). */
async function hasCustody(folderId: string): Promise<boolean> {
  try {
    await getSharedFolder(folderId)
    return true
  } catch {
    return false
  }
}

/**
 * The shared folder a row lives in. A file added through a link can sit at any
 * depth under the folder that was shared, so this walks up from the row (or
 * checks the folder the viewer is in first). Null when no ancestor is a shared
 * folder — an ordinary vault file needs none of this.
 */
export async function sharedRootFor(
  startFolderId: string | null,
  fileId: string,
): Promise<string | null> {
  if (startFolderId && (await hasCustody(startFolderId))) return startFolderId
  let cursor: string | null = fileId
  for (let depth = 0; depth < 16 && cursor; depth++) {
    let row
    try {
      row = await getFile(cursor)
    } catch {
      return null
    }
    const parent = row.parent_id
    if (!parent) return null
    if (await hasCustody(parent)) return parent
    cursor = parent
  }
  return null
}
