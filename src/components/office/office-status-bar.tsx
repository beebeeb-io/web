/**
 * Status bar (task 1567) — "Page x of y · N words · language · Encrypted ·
 * saved as version N · HH:MM", matching design/office-editor.html and the
 * SAME encryption-state language as the text editor's status bar
 * (editor.tsx's `editor-status-bar`). The lock glyph is the app's own amber
 * lock icon — never an emoji, per brand rules.
 */

import { Icon } from '@beebeeb/shared'

export interface OfficeStatusBarProps {
  pageLabel: string | null
  wordCount: number | null
  language?: string
  dirty: boolean
  conflict: boolean
  versionNumber: number
  lastSavedAt: Date | null
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function OfficeStatusBar({
  pageLabel,
  wordCount,
  language,
  dirty,
  conflict,
  versionNumber,
  lastSavedAt,
}: OfficeStatusBarProps) {
  const statusRight = conflict
    ? 'not saved · conflict'
    : dirty
      ? 'unsaved changes'
      : lastSavedAt
        ? `saved as version ${versionNumber} · ${formatClock(lastSavedAt)}`
        : `version ${versionNumber}`

  return (
    <div
      className="flex h-[30px] shrink-0 items-center gap-4 border-t border-line bg-paper-2 px-4 font-mono text-[11px] text-ink-3"
      data-testid="office-status-bar"
    >
      {pageLabel && <span>{pageLabel}</span>}
      {wordCount !== null && <span>{wordCount.toLocaleString()} words</span>}
      {language && <span>{language}</span>}
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 text-amber-deep">
        <Icon name="lock" size={11} />
        Encrypted
      </span>
      <span data-testid="office-status-saved">{statusRight}</span>
    </div>
  )
}
