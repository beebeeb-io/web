/**
 * Task 2237b — member writes inside a shared folder.
 *
 * The server enforces the level (files.rs turn-away for read-only members); this
 * module makes the client send exactly what the level allows and seal it the way
 * the folder expects:
 *
 *  - a member upload records every file key wrapped under the member's folder
 *    key (`SharedFolderUploadContext`), so the owner and every other member can
 *    open the file;
 *  - a rename re-seals the name with the item's EXISTING file key, never with
 *    the folder key (the folder key only wraps the file key);
 *  - no write carries `actor_name_encrypted`: a signed-in member is identified
 *    by `uploaded_by`, unlike an anonymous link guest.
 */
import type { DriveFile } from './api'
import { ApiError, bulkTrashFiles, updateFile } from './api'
import { deriveFileKey, encryptFilename, serializeEncryptedBlob } from './crypto'
import { encryptedUpload, type SharedFolderUploadContext, type UploadProgress } from './encrypted-upload'
import { canAdd, canEdit, type FolderAccessLevel } from './folder-link-types'
import { decryptChildFileKey } from './folder-share-crypto'

export interface MemberContext {
  folderId: string
  inviteId: string
  /** The member's copy of the shared folder key. */
  folderKey: Uint8Array
  level: FolderAccessLevel
  /** The signed-in member's own display name, for the editing strip. */
  displayName: string
  /** Needed for a file key that is not in `fileKeys` (the member's own rows). */
  masterKey?: Uint8Array
  /** `file_id -> encrypted_file_key` from `getFolderKeys(inviteId)`. */
  fileKeys?: Record<string, string>
}

export interface MemberPermissions {
  canUpload: boolean
  canCreateFolder: boolean
  canRename: boolean
  canDelete: boolean
}

/**
 * `add` may put new items into the tree (including a new folder, which is just
 * an upload of a folder); only `edit` may touch what is already there.
 */
export function memberPermissions(level: FolderAccessLevel): MemberPermissions {
  return {
    canUpload: canAdd(level),
    canCreateFolder: canAdd(level),
    canRename: canEdit(level),
    canDelete: canEdit(level),
  }
}

/**
 * A refused write is not retried: the level the page believes may be stale, so
 * a 403 re-reads `getSharedFolder` and the UI drops what the member may no
 * longer do. Anything else is just reported.
 */
export function writeErrorAction(err: unknown): 'refetch' | 'report' {
  return err instanceof ApiError && err.status === 403 ? 'refetch' : 'report'
}

/** The item's own key: the wrapped child key when we have it, else our derive. */async function itemFileKey(ctx: MemberContext, item: DriveFile): Promise<Uint8Array> {
  const wrapped = ctx.fileKeys?.[item.id]
  if (wrapped) return decryptChildFileKey(ctx.folderKey, wrapped)
  throw new Error("This file's key isn't available, so it can't be changed here.")
}

export async function memberUploadFiles(
  ctx: MemberContext,
  parentId: string | null,
  files: File[],
  onProgress: (name: string, p: UploadProgress) => void,
): Promise<{ added: number; failed: number }> {
  if (!memberPermissions(ctx.level).canUpload) {
    throw new Error("This link can't add files.")
  }
  if (!ctx.masterKey) throw new Error('The vault must be unlocked to upload.')

  const sharedFolderContext: SharedFolderUploadContext = {
    folderKey: ctx.folderKey,
    sharedFolderId: ctx.folderId,
    inviteId: ctx.inviteId,
  }

  let added = 0
  let failed = 0
  for (const file of files) {
    try {
      const fileId = crypto.randomUUID()
      const fileKey = await deriveFileKey(ctx.masterKey, fileId)
      await encryptedUpload(
        file,
        fileId,
        fileKey,
        ctx.masterKey,
        // The shared folder's own id is the root parent: a member uploading at
        // the top level must land inside the folder, never in their own drive.
        parentId ?? ctx.folderId,
        (p) => onProgress(file.name, p),
        undefined,
        sharedFolderContext,
        undefined,
        async (id: string) => deriveFileKey(ctx.masterKey!, id),
      )
      added += 1
    } catch {
      failed += 1
    }
  }
  return { added, failed }
}

export async function memberRename(
  ctx: MemberContext,
  item: DriveFile,
  newName: string,
): Promise<DriveFile> {
  if (!memberPermissions(ctx.level).canRename) {
    throw new Error("This link can't rename files.")
  }
  const fileKey = await itemFileKey(ctx, item)
  const enc = await encryptFilename(fileKey, newName)
  return updateFile(item.id, { name_encrypted: serializeEncryptedBlob(enc.nonce, enc.ciphertext) })
}

export async function memberTrash(
  ctx: MemberContext,
  item: DriveFile,
): Promise<{ trashed: number }> {
  if (!memberPermissions(ctx.level).canDelete) {
    throw new Error("This link can't delete files.")
  }
  const result = await bulkTrashFiles([item.id])
  return { trashed: result.trashed.length }
}
