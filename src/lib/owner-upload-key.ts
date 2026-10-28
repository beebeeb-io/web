/**
 * Task 2237b — an owner upload into an already-shared folder.
 *
 * Members and guests open a file through its wrap in `shared_folder_keys`
 * (file key sealed under the shared root's folder key). Files that existed when
 * the folder was shared got theirs at share time; a file the owner adds later
 * needs one too, including in a folder shared only through links, which has no
 * invite to hang it on (`POST /shared-folders/:id/keys`, owner only,
 * insert-only).
 */
import { ApiError, createFolder, publishSharedFolderKeys, updateFile, type DriveFile } from './api'
import { collectAllChildItems, sealChildKey } from './folder-share-crypto'
import { assertNoSeenCustodyAbove, folderKeyForRoot, folderWrapFormat, needsOwnership, sharedRootFor } from './owner-adoption'
import { deriveFileKey, zeroize } from './crypto'
import { sharedFoldersEnabled } from './use-feature-flag'

/**
 * Publish the wrap of an item the owner just added under its shared root: a
 * file's content key, or a new folder's own name key. No-op outside a shared
 * folder, and for a folder without a custody record (L7b: a flag-off
 * invite-only share, whose route answers 404 anyway). With custody the wrap is
 * L7, bound to (root, this item, file or folder).
 */
export async function publishOwnerUploadKey(
  masterKey: Uint8Array,
  parentId: string,
  fileId: string,
  fileKey: Uint8Array,
  isFolder = false,
): Promise<void> {
  // rv-web198c P2-1: with the flag off there is nothing to publish to, and the
  // walk below must not run (or fail) after an upload already committed.
  // rv-web198d N2: except under a folder this client has seen with custody,
  // where "off" (a failed read, a rollback) must fail loudly, never skip.
  if (!(await sharedFoldersEnabled())) {
    await assertNoSeenCustodyAbove(parentId)
    return
  }
  const root = await sharedRootFor(parentId, parentId)
  if (!root) return
  if ((await folderWrapFormat(root, parentId)) !== 'l7') return
  const folderKey = await folderKeyForRoot(masterKey, root)
  if (!folderKey) throw new Error('The shared folder key is not available on this device.')
  try {
    await publishSharedFolderKeys(root, [{
      file_id: fileId,
      encrypted_file_key: await sealChildKey(folderKey, { rootId: root, itemId: fileId, isFolder }, fileKey),
    }])
  } catch (error) {
    // A server without the route (405) or without the custody row (404) cannot
    // take the wrap; the upload itself succeeded and the owner can open it.
    // Any other failure is real and fails the upload, like an invite's wrap.
    if (error instanceof ApiError && (error.status === 405 || error.status === 404)) {
      console.warn('[upload] shared-folder key not published', { status: error.status })
      return
    }
    throw error
  } finally {
    zeroize(folderKey)
  }
}

/**
 * Create a folder the owner names, and publish its name-key wrap when it lands
 * inside a shared folder. Without that wrap a guest or member cannot read the
 * new folder's name (its name is sealed under its own key, derived from the
 * owner's master key). `nameKey` is that key; omit it for a folder created
 * while the vault is locked (its name is not encrypted, so there is nothing
 * to publish).
 */
export async function createOwnerFolder(args: {
  nameEncrypted: string
  parentId?: string
  folderId: string
  nameKey?: Uint8Array
  masterKey?: Uint8Array
}): Promise<DriveFile> {
  const created = await createFolder(args.nameEncrypted, args.parentId, args.folderId)
  if (args.parentId && args.nameKey && args.masterKey) {
    await publishOwnerUploadKey(args.masterKey, args.parentId, created.id, args.nameKey, true)
  }
  return created
}

/** The server takes at most this many key rows per publish call. */
const PUBLISH_BATCH = 1000

/** Thrown after the move itself succeeded, when its wraps could not be published. */
export const MOVED_BUT_UNPUBLISHED = "Moved, but it isn't readable in the shared folder yet. Try moving it again."

/** A moved row: enough to know its kind and who added it. */
export type MovableRow = Pick<DriveFile, 'id'> & Partial<Pick<DriveFile, 'is_folder' | 'uploaded_by' | 'acted_via_share_id'>>

/**
 * rv-web198c P2-5: move items (the drive's "copy" is a move too) and, when the
 * destination is inside a custody folder, publish the wrap of every moved item
 * and everything under it, as an upload or a folder create does. Without it a
 * moved-in item stayed unreadable to the folder's guests and members.
 *
 * Only rows the owner created are sealed: their key is derived from the master
 * key. A row a guest or member added keeps the wrap it already has; it is never
 * re-sealed under a derived key that is not its key. The one route that moves
 * a row in the web client: a guard test pins it.
 */
export async function moveOwnerItems(args: {
  ids: string[]
  destinationId: string | null
  /** The listed rows by id, for their kind and uploader. */
  rows?: ReadonlyMap<string, MovableRow> | MovableRow[]
  masterKey?: Uint8Array
  viewerId?: string | null
}): Promise<void> {
  await Promise.all(args.ids.map((id) => updateFile(id, { parent_id: args.destinationId })))
  if (!args.destinationId || !args.masterKey) return
  try {
    await publishMovedItems(args.masterKey, args.destinationId, args.ids, args.rows, args.viewerId ?? null)
  } catch (error) {
    console.warn('[move] shared-folder keys not published after a move', {
      status: error instanceof ApiError ? error.status : undefined,
    })
    throw new Error(MOVED_BUT_UNPUBLISHED)
  }
}

async function publishMovedItems(
  masterKey: Uint8Array,
  destinationId: string,
  ids: string[],
  rows: ReadonlyMap<string, MovableRow> | MovableRow[] | undefined,
  viewerId: string | null,
): Promise<void> {
  if (!(await sharedFoldersEnabled())) {
    // rv-web198d N2, as for an upload: never a silent skip under custody.
    await assertNoSeenCustodyAbove(destinationId)
    return
  }
  const root = await sharedRootFor(destinationId, destinationId)
  if (!root) return
  if ((await folderWrapFormat(root, destinationId)) !== 'l7') return
  const byId: ReadonlyMap<string, MovableRow> = Array.isArray(rows)
    ? new Map(rows.map((row) => [row.id, row]))
    : (rows ?? new Map())

  // The moved rows, then every descendant of a moved folder.
  const items: { id: string; isFolder: boolean; foreign: boolean }[] = []
  for (const id of ids) {
    const row = byId.get(id)
    const isFolder = !!row?.is_folder
    // A row the caller did not list is treated as someone else's: never sealed.
    items.push({ id, isFolder, foreign: !row || needsOwnership(row, viewerId) })
    if (isFolder) {
      for (const child of await collectAllChildItems(id)) {
        items.push({
          id: child.id,
          isFolder: child.isFolder,
          foreign: needsOwnership({ acted_via_share_id: child.actedViaShareId, uploaded_by: child.uploadedBy }, viewerId),
        })
      }
    }
  }

  const folderKey = await folderKeyForRoot(masterKey, root)
  if (!folderKey) throw new Error('The shared folder key is not available on this device.')
  try {
    const entries: { file_id: string; encrypted_file_key: string }[] = []
    for (const item of items) {
      if (item.foreign) continue
      const key = await deriveFileKey(masterKey, item.id)
      try {
        entries.push({
          file_id: item.id,
          encrypted_file_key: await sealChildKey(folderKey, { rootId: root, itemId: item.id, isFolder: item.isFolder }, key),
        })
      } finally {
        zeroize(key)
      }
    }
    for (let start = 0; start < entries.length; start += PUBLISH_BATCH) {
      await publishSharedFolderKeys(root, entries.slice(start, start + PUBLISH_BATCH))
    }
  } finally {
    zeroize(folderKey)
  }
}
