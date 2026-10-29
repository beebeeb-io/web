import { useCallback, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { deleteVersion, ApiError } from '../lib/api'
import { useToast } from './toast'
import { useDriveData } from '../lib/drive-data-context'
import {
  versionContentBytes,
  versionDeleteCopy,
  type DeletableVersion,
  type VersionDeleteCopy,
} from '../lib/version-delete-copy'

/**
 * The delete flow for one kept version (task 1809), shared by the file-details
 * Versions tab and the full version-history drawer so both say the same thing and
 * both give the storage meter the new number.
 *
 * `pendingId` is the version whose inline confirmation is open; `confirm` runs the
 * delete, toasts, refreshes the shared usage and calls `onDeleted` so the caller
 * can drop the row. A failure keeps the confirmation open and says why.
 */
export function useVersionDelete(fileId: string, countsTowardQuota: boolean, onDeleted: (versionId: string) => void) {
  const { showToast } = useToast()
  const { refreshUsage } = useDriveData()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const request = useCallback((versionId: string) => setPendingId(versionId), [])
  const cancel = useCallback(() => {
    if (!busy) setPendingId(null)
  }, [busy])

  const confirm = useCallback(
    async (version: DeletableVersion & { id: string }) => {
      const copy = versionDeleteCopy({
        versionNumber: version.version_number,
        contentBytes: versionContentBytes(version),
        countsTowardQuota,
      })
      setBusy(true)
      try {
        await deleteVersion(fileId, version.id)
        setPendingId(null)
        showToast({ icon: 'check', title: copy.doneTitle })
        void refreshUsage()
        onDeleted(version.id)
      } catch (err) {
        const gone = err instanceof ApiError && err.status === 404
        showToast({
          icon: 'x',
          title: gone ? 'Version already gone' : 'Could not delete the version',
          description:
            gone || !(err instanceof ApiError) || !err.message ? undefined : err.message,
          danger: !gone,
        })
        if (gone) {
          setPendingId(null)
          onDeleted(version.id)
        }
      } finally {
        setBusy(false)
      }
    },
    [fileId, countsTowardQuota, showToast, refreshUsage, onDeleted],
  )

  return { pendingId, busy, request, cancel, confirm }
}

/** The inline, two-step confirmation shown under a version row. */
export function VersionDeleteConfirm({
  copy,
  busy,
  onConfirm,
  onCancel,
}: {
  copy: VersionDeleteCopy
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="group"
      aria-label={copy.title}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 rounded-md border border-line-2 bg-paper-2 px-3 py-2.5"
    >
      <div className="text-[12px] font-semibold text-ink">{copy.title}</div>
      <p className="mt-1 text-[11px] leading-snug text-ink-3">{copy.body}</p>
      <div className="mt-2.5 flex gap-1.5">
        <BBButton size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </BBButton>
        <BBButton size="sm" variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Deleting...' : copy.confirmLabel}
        </BBButton>
      </div>
    </div>
  )
}
