/**
 * Save-conflict dialog (task 1563, design/editor-1563.html screen 04).
 *
 * Shown when `getFile()` reports the server's version has moved past the
 * version this edit session opened from — i.e. another device/tab saved
 * first. Nothing is ever overwritten silently: the user picks one of three
 * actions (editor-conflict.ts holds the pure decision logic these buttons
 * drive) — Keep both / Save as a new version / Show differences.
 */

import { useState } from 'react'
import { Icon, BBButton } from '@beebeeb/shared'
import { diffLines, MAX_DIFF_LINES, type DiffLine } from '../../lib/line-diff'
import type { ConflictAction } from '../../lib/editor-conflict'

interface ConflictDialogProps {
  /** The version number that raced this edit session's save. */
  latestVersionNumber: number
  /** The version this edit session started from. */
  openedVersionNumber: number
  /** Decrypted plaintext of the racing (latest) version, once loaded. */
  latestText: string | null
  /** This session's current (unsaved) editor text. */
  localText: string
  onAction: (action: ConflictAction) => void
  onCancel: () => void
}

export function ConflictDialog({
  latestVersionNumber,
  openedVersionNumber,
  latestText,
  localText,
  onAction,
  onCancel,
}: ConflictDialogProps) {
  // 'show-differences' is itself one of the three offered actions (not just
  // a display toggle) — resolveConflictAction() deliberately returns null
  // for it: nothing uploads, the caller (this component) just reveals the
  // diff it already has the data for.
  const [differencesShown, setDifferencesShown] = useState(false)

  const diff: DiffLine[] | null = latestText !== null ? diffLines(latestText, localText) : null
  const changedLines = diff?.filter((l) => l.type !== 'same') ?? []

  function handleShowDifferences() {
    setDifferencesShown(true)
    onAction('show-differences')
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        className="flex w-full max-w-[640px] max-h-[80%] flex-col overflow-hidden rounded-lg border border-line bg-paper shadow-3"
        data-testid="editor-conflict-dialog"
      >
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-bg text-amber-deep">
            <Icon name="shield" size={15} />
          </span>
          <div className="min-w-0">
            <h4 id="conflict-dialog-title" className="text-[14px] font-semibold text-ink">
              A newer version was saved elsewhere
            </h4>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              Version {latestVersionNumber} · you started from version {openedVersionNumber}.
              Your changes are still here, and both versions stay in history.
            </p>
          </div>
        </div>

        {differencesShown && (
          <>
            <div className="flex items-center justify-between border-b border-line bg-paper-2 px-4 py-1.5 text-[11px] font-medium text-ink-3">
              <span>Version {latestVersionNumber} · saved elsewhere</span>
              <span>Your edit · this browser · not saved</span>
            </div>

            <div
              className="flex-1 overflow-auto font-mono text-[11px] leading-[1.6]"
              data-testid="editor-conflict-diff"
            >
              {latestText === null ? (
                <div className="flex items-center gap-2 p-4 text-ink-3">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-amber" />
                  Loading the other version…
                </div>
              ) : diff === null ? (
                <div className="p-4 text-ink-3">
                  These files are too large to show a line-by-line difference here
                  (over {MAX_DIFF_LINES.toLocaleString()} lines on one side). Choose an option
                  below — nothing is overwritten either way.
                </div>
              ) : changedLines.length === 0 ? (
                <div className="p-4 text-ink-3">
                  No line differences — the content is identical.
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <tbody>
                    {diff.map((l, i) => (
                      <tr
                        key={i}
                        style={{
                          backgroundColor:
                            l.type === 'add'
                              ? 'color-mix(in oklab, var(--color-green) 12%, transparent)'
                              : l.type === 'del'
                                ? 'color-mix(in oklab, var(--color-red) 10%, transparent)'
                                : undefined,
                        }}
                      >
                        <td className="w-4 select-none px-2 text-ink-4">
                          {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}
                        </td>
                        <td className="whitespace-pre-wrap break-all px-2 text-ink-2">
                          {l.text || '​'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {!differencesShown && (
          <div className="px-4 py-3 text-[12px] text-ink-3">
            {diff === null
              ? 'Both versions are too large to diff line-by-line here.'
              : changedLines.length === 0
                ? 'No line differences — the content is identical.'
                : `${changedLines.length} line${changedLines.length === 1 ? '' : 's'} differ between the two versions.`}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <Icon name="lock" size={11} />
            Encrypted on this device before saving
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!differencesShown && (
              <BBButton size="sm" variant="ghost" onClick={handleShowDifferences}>
                Show differences
              </BBButton>
            )}
            <BBButton size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </BBButton>
            <BBButton size="sm" onClick={() => onAction('keep-both')}>
              Keep both
            </BBButton>
            <BBButton size="sm" variant="amber" onClick={() => onAction('save-as-new-version')}>
              Save as version {latestVersionNumber + 1}
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
