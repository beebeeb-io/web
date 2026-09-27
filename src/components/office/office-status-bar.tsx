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
  /** App-specific status segments (task 1567, Calc lane: Sum/Average/Count of
   *  the selection) rendered in the same slot as pageLabel/wordCount/
   *  language, before the flex spacer. Undefined/null renders nothing --
   *  zero visual change for apps that don't pass it. */
  extra?: React.ReactNode
  /** CRITIQUE.md finding #5 (task 1567): while the engine is still booting,
   *  the approved "firstload" mockup screen's status bar shows an amber dot
   *  + "Preparing the editor on this device…" in place of the normal page/
   *  word-count cluster, and "read-only for now" instead of the save state.
   *  Set/unset only — never combined with the normal fields. */
  loadingLabel?: string | null
  /** Task 1585: the Licenses/About control, last on the bar in every state. */
  about?: React.ReactNode
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
  extra,
  loadingLabel,
  about,
}: OfficeStatusBarProps) {
  if (loadingLabel) {
    return (
      <div
        className="flex h-[30px] shrink-0 items-center gap-2 whitespace-nowrap border-t border-line bg-paper-2 px-4 font-mono text-[11px] text-ink-3"
        data-testid="office-status-bar"
      >
        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-amber" />
        <span className="min-w-0 truncate">{loadingLabel}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-amber-deep">
          <Icon name="lock" size={11} />
          Encrypted
        </span>
        <span className="hidden sm:inline">read-only for now</span>
        {about}
      </div>
    )
  }

  const statusRight = conflict
    ? 'not saved · conflict'
    : dirty
      ? 'unsaved changes'
      : lastSavedAt
        ? `saved as version ${versionNumber} · ${formatClock(lastSavedAt)}`
        : `version ${versionNumber}`

  return (
    <div
      // whitespace-nowrap + a tighter gap below `sm` (task 1585): at phone
      // width the segments wrapped onto two lines inside the 30 px bar.
      className="flex h-[30px] shrink-0 items-center gap-3 whitespace-nowrap border-t border-line bg-paper-2 px-4 font-mono text-[11px] text-ink-3 sm:gap-4"
      data-testid="office-status-bar"
    >
      {pageLabel && <span>{pageLabel}</span>}
      {wordCount !== null && <span>{wordCount.toLocaleString()} words</span>}
      {/* The least important segment; dropped at phone width (task 1585). */}
      {language && <span className="hidden sm:inline">{language}</span>}
      {extra}
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 text-amber-deep">
        <Icon name="lock" size={11} />
        Encrypted
      </span>
      <span data-testid="office-status-saved">{statusRight}</span>
      {about}
    </div>
  )
}
