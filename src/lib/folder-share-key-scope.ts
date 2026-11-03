/**
 * Review F10 (P3) — the owner folder key lives for one use, then goes.
 *
 * The Share panel needs R's custody key to list what has no L14-passing wrap
 * and to publish the wraps the owner confirms. Neither needs the key again
 * after it returns, so it is opened here, handed to one callback, and zeroized
 * in the same frame — it is never left in React state (or anywhere else) for
 * the life of the panel.
 */
import { getSharedFolder } from './api'
import { fromBase64, zeroize } from './crypto'
import { openFolderCustody } from './folder-share-crypto'

/** The fields of the custody record the key scope reads. */
export interface FolderCustodyFields {
  owner_wrapped_folder_key?: string | null
  role?: string | null
}

/**
 * Open the owner's folder key and run `use` with it, zeroizing it whatever
 * `use` does. Returns null when this folder has no owner custody key (a member
 * view, or a folder not shared yet): `use` is then never called.
 */
export async function withOwnerFolderKey<T>(
  args: { folderId: string; masterKey: Uint8Array; custody?: FolderCustodyFields | null },
  use: (folderKey: Uint8Array) => Promise<T>,
): Promise<T | null> {
  const custody = args.custody ?? (await getSharedFolder(args.folderId).catch(() => null))
  const wrapped = custody?.owner_wrapped_folder_key
  if (!wrapped) return null
  const folderKey = await openFolderCustody(args.masterKey, args.folderId, fromBase64(wrapped))
  try {
    return await use(folderKey)
  } finally {
    zeroize(folderKey)
  }
}
