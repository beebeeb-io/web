/**
 * Folder-link snapshot copy (2238 + 2326 review P2-2).
 *
 * A folder link is a snapshot of the files below it (bundle spec 0417), so the
 * panel says how many files it will cover, and names the ones it must leave
 * out -- a row received through a file request "can't be shared" (L15) and is
 * never a fatal scan error. Kept out of share-dialog.tsx to stay under the
 * file-size ratchet.
 */
import { FOLDER_BUNDLE_MAX_ITEMS, type FolderBundleScan } from '../../lib/folder-bundle'

export interface FolderSnapshotNotesProps {
  scan: FolderBundleScan | null
  error: string | null
}

export function FolderSnapshotNotes({ scan, error }: FolderSnapshotNotesProps) {
  return (
    <>
      <div
        className="border border-line-2 rounded-lg bg-paper-2 px-3.5 py-3 mb-3"
        role="status"
        data-testid="folder-snapshot-note"
      >
        <p className="text-[12px] text-ink-2 leading-relaxed">
          {error
            ? `Could not read this folder: ${error}`
            : scan === null
            ? 'Counting the files in this folder…'
            : scan.files.length === 0
            ? 'Nothing to share yet'
            : scan.overCap
            ? `This folder has more than ${FOLDER_BUNDLE_MAX_ITEMS} files. A link covers up to ${FOLDER_BUNDLE_MAX_ITEMS}; select the files you want and share them together.`
            : `Shares the ${scan.files.length} files in this folder and its subfolders as they are now. Files added later won't appear.`}
        </p>
      </div>

      {/* 2326/L15: rows that cannot go into the link are named with the same
          "can't be shared" sentence, never a fatal folder error. */}
      {(scan?.skipped.length ?? 0) > 0 && (
        <ul
          className="border border-line-2 rounded-lg bg-paper-2 px-3.5 py-2.5 mb-3 text-[12px] text-ink-2 leading-relaxed"
          role="status"
          data-testid="folder-skipped"
        >
          {scan!.skipped.map((skip) => (
            <li key={skip.fileId}>{skip.name ? `${skip.name}: ${skip.reason}` : skip.reason}</li>
          ))}
        </ul>
      )}
    </>
  )
}
