/**
 * SF-0002 round 2 (W8): the key a share of ONE file wraps (a link's K_c wrap,
 * or an invite's recipient wrap).
 *
 * With the row in hand it is the key that actually opens the row:
 * `getFileKeyForFile` resolves shared-folder rows and owner rows repaired from
 * the iOS Files-app convention. The plain lowercase derivation
 * (`getFileKey(id)`) does not open a repaired row, so a link or invite built on
 * it is dead on arrival.
 *
 * 2326 review P2-2 (L15): a row received through a FILE REQUEST has no key we
 * can wrap — core hands out a decrypt-only reader — so it is REFUSED with the
 * same "can't be shared" sentence the share panel uses, never wrapped under a
 * derived key that would publish an item nobody can open.
 *
 * Without a row (the Shared page forwarding a file someone else shared) the
 * dialog keeps its previous key; that flow is not an owner row and is out of
 * SF-0002's scope.
 */
import type { DriveFile } from './api'
import { contentKeyBytes, isRequestUpload, type ContentKey } from './request-row'
import { cannotShareReason } from './share-missing-items'

/** A row that cannot go into a link at all: the message is the L15 copy. */
export class FileCannotBeSharedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileCannotBeSharedError'
  }
}

export async function shareFileKey(
  fileId: string,
  deps: {
    file?: DriveFile
    getFileKey: (id: string) => Promise<Uint8Array>
    getFileKeyForFile: (file: DriveFile) => Promise<ContentKey>
  },
): Promise<Uint8Array> {
  if (deps.file && deps.file.id === fileId) {
    if (isRequestUpload(deps.file)) {
      throw new FileCannotBeSharedError(cannotShareReason('request_row')!)
    }
    return contentKeyBytes(await deps.getFileKeyForFile(deps.file))
  }
  return deps.getFileKey(fileId)
}
