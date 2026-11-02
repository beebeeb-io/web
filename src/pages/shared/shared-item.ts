import type { DriveFile } from '../../lib/api'

/**
 * What the Shared page lists: a file or a folder (the server marks folders
 * with `is_folder`). The page maps every invite/share onto one of these so
 * the kind is a union, not a boolean flag.
 */
export type SharedItem =
  | { kind: 'file'; file: DriveFile }
  | { kind: 'folder'; file: DriveFile }

export function sharedItemOf(file: DriveFile): SharedItem {
  return file.is_folder ? { kind: 'folder', file } : { kind: 'file', file }
}

export function isSharedFolder(item: SharedItem): boolean {
  return item.kind === 'folder'
}

/** The `DriveFile` a `FileList` renders for this item. */
export function sharedItemFile(item: SharedItem): DriveFile {
  return item.file
}
