/**
 * SF-0002 round 2 (W8): the key a share of ONE file wraps (a link's K_c wrap,
 * or an invite's recipient wrap).
 *
 * With the row in hand it is the key that actually opens the row:
 * `getFileKeyForFile` resolves request uploads, shared-folder rows and owner
 * rows repaired from the iOS Files-app convention. The plain lowercase
 * derivation (`getFileKey(id)`) does not open a repaired row, so a link or
 * invite built on it is dead on arrival.
 *
 * Without a row (the Shared page forwarding a file someone else shared) the
 * dialog keeps its previous key; that flow is not an owner row and is out of
 * SF-0002's scope.
 */
import type { DriveFile } from './api'
import { contentKeyBytes, type ContentKey } from './request-row'

export async function shareFileKey(
  fileId: string,
  deps: {
    file?: DriveFile
    getFileKey: (id: string) => Promise<Uint8Array>
    getFileKeyForFile: (file: DriveFile) => Promise<ContentKey>
  },
): Promise<Uint8Array> {
  if (deps.file && deps.file.id === fileId) return contentKeyBytes(await deps.getFileKeyForFile(deps.file))
  return deps.getFileKey(fileId)
}
