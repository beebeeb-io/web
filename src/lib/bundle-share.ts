/**
 * 2326 review P2-2 (L15): a multi-select "Share with Beebeeb" bundle must
 * never wrap an id-derived key for a row received through a FILE REQUEST.
 *
 * `prepareBundleShareItems` (crypto.ts) falls back to
 * `deriveFileKey(master, fileId)` when a selection carries no `fileKey`. For a
 * request row that key opens neither its sealed name nor its content, so the
 * link would publish an undecryptable item (no key leak — C is never wrapped —
 * but a dead item). The folder walk already skips such a row and lists it with
 * the "can't be shared" sentence; the flat multi-select bundle has no such
 * walk, so it REFUSES before any key is resolved.
 *
 * Every returned selection carries a `fileKey`, so the derivation fallback can
 * never run for a bundle built here.
 */
import type { DriveFile } from './api'
import { contentKeyBytes, isRequestUpload, type ContentKey } from './request-row'
import { cannotShareReason } from './share-missing-items'
import { FileCannotBeSharedError } from './share-file-key'

/** One row selected for a bundle: the listed file plus its display name/size. */
export interface BundleShareFile {
  id: string
  name: string
  size: number
  /** The listed row: `isRequestUpload` and the per-item key both read it. */
  file: DriveFile
}

/** One bundle item with the key its link must wrap. */
export interface BundleShareSelection {
  fileId: string
  /** 0-based ordered position in the bundle. */
  position: number
  /** The row's FileKey. The caller owns and zeroizes it. */
  fileKey: Uint8Array
}

/**
 * Resolve the ordered bundle selections, refusing the whole bundle when any
 * selected row is a request row. Resolution happens only after every row has
 * passed the request-row check, so no key is derived for a row that can never
 * be shared.
 */
export async function resolveBundleSelections(
  entries: Array<{ file: DriveFile }>,
  getFileKeyForFile: (file: DriveFile) => Promise<ContentKey>,
): Promise<BundleShareSelection[]> {
  if (entries.some((entry) => isRequestUpload(entry.file))) {
    throw new FileCannotBeSharedError(cannotShareReason('request_row')!)
  }
  return Promise.all(
    entries.map(async (entry, position) => ({
      fileId: entry.file.id,
      position,
      fileKey: contentKeyBytes(await getFileKeyForFile(entry.file)),
    })),
  )
}
