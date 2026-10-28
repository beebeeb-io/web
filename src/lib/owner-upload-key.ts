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
import { ApiError, createFolder, publishSharedFolderKeys, type DriveFile } from './api'
import { sealChildKey } from './folder-share-crypto'
import { folderKeyForRoot, folderWrapFormat, sharedRootFor } from './owner-adoption'
import { zeroize } from './crypto'

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
  const root = await sharedRootFor(parentId, parentId)
  if (!root) return
  if ((await folderWrapFormat(root)) !== 'l7') return
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
