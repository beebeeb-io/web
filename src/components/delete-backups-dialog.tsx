import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton, Icon } from '@beebeeb/shared'

interface DeleteBackupsDialogProps {
  open: boolean
  /** Best-effort summary computed from the local sync tree. */
  deviceCount: number
  itemCount: number
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Extra guard shown before trashing the root "Backups" folder — the destination
 * the desktop (Windows) and mobile (iOS) backup engines write to
 * (`Backups/{device}/{category}/`). Deleting it moves every device's backup to
 * Trash, so this requires an explicit, clearly-worded confirmation rather than
 * the silent one-tap trash path. Honest copy, red danger styling, Cancel
 * focused by default.
 */
export function DeleteBackupsDialog({
  open,
  deviceCount,
  itemCount,
  onCancel,
  onConfirm,
}: DeleteBackupsDialogProps) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)

  if (!open) return null

  const itemLabel = itemCount === 1 ? '1 item' : `${itemCount.toLocaleString()} items`
  const deviceLabel = deviceCount === 1 ? '1 device folder' : `${deviceCount} device folders`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} />

      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete the Backups folder"
        className="relative w-[520px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-[22px] py-3.5 border-b border-line">
          <Icon name="info" size={16} className="text-red shrink-0" />
          <h3 className="text-base font-bold">Delete your device backups?</h3>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="ml-auto text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-[22px] space-y-4">
          <div className="text-[13px] text-ink-2 leading-relaxed space-y-2">
            <p>
              <strong className="text-ink">Backups</strong> is where your devices store
              their backups automatically — Windows and iOS save photos, contacts and
              calendars here. It is not an ordinary folder.
            </p>
            {itemCount > 0 && (
              <p>
                It currently holds{' '}
                <strong className="text-ink font-mono">{itemLabel}</strong>
                {deviceCount > 0 && (
                  <>
                    {' '}across <strong className="text-ink font-mono">{deviceLabel}</strong>
                  </>
                )}
                .
              </p>
            )}
          </div>

          <div className="rounded-md border border-red/30 bg-red/5 p-3.5">
            <ul className="space-y-1.5 text-[12.5px] text-ink-2">
              <li className="flex gap-2">
                <Icon name="trash" size={12} className="text-red mt-0.5 shrink-0" />
                <span>Everything inside moves to Trash, including backups you can’t re-create.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="info" size={12} className="text-red mt-0.5 shrink-0" />
                <span>Your devices may lose their backup history and re-upload from scratch.</span>
              </li>
            </ul>
          </div>

          <p className="text-[13px] font-semibold text-ink">
            Deleting the Backups folder is not recommended.
          </p>

          <div className="flex items-center gap-2.5">
            <BBButton size="lg" className="flex-1 justify-center" onClick={onCancel} autoFocus>
              Keep Backups
            </BBButton>
            <BBButton
              variant="danger"
              size="lg"
              className="flex-1 justify-center"
              onClick={onConfirm}
            >
              Delete anyway
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
