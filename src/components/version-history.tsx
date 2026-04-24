import { useState, useEffect } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'

export interface FileVersion {
  id: string
  version: string
  who: string
  when: string
  bytes: string
  delta: string
  current?: boolean
  milestone?: string
}

interface VersionHistoryProps {
  open: boolean
  onClose: () => void
  fileName: string
  versions: FileVersion[]
  onRestore: (versionId: string) => void
  onDownload: (versionId: string) => void
}

// Mock diff lines for display
interface DiffLine {
  type: ' ' | '+' | '-'
  content: string
}

const MOCK_DIFF: DiffLine[] = [
  { type: ' ', content: '> Source B was a mid-level compliance officer. They remember the' },
  { type: ' ', content: '> call because it was unusual in two respects: it came from a' },
  { type: ' ', content: '> number outside the organisation, and the person on the line' },
  { type: '-', content: '> asked them something strange.' },
  { type: '+', content: '> asked them to do something they had never been asked to do in' },
  { type: '+', content: '> fourteen years on the job.' },
  { type: ' ', content: '' },
  { type: '+', content: "> The caller didn't identify themselves, but they knew things" },
  { type: '+', content: "> that, in B's recollection, only three other people should have" },
  { type: '+', content: '> known. "I thought it was a test," B told me later. "I almost' },
  { type: '+', content: '> hung up."' },
]

export function VersionHistory({
  open,
  onClose,
  fileName,
  versions,
  onRestore,
  onDownload,
}: VersionHistoryProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  // Reset selection when opened
  useEffect(() => {
    if (open) setSelectedIdx(0)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || versions.length === 0) return null

  const selected = versions[selectedIdx]
  const prevVersion = versions[selectedIdx + 1]
  const diffLabel = prevVersion
    ? `${prevVersion.version} -> ${selected.version}`
    : selected.version

  // Diff stats
  const addedLines = MOCK_DIFF.filter((l) => l.type === '+').length
  const removedLines = MOCK_DIFF.filter((l) => l.type === '-').length

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Slide-over panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[860px] h-full bg-paper border-l border-line-2 shadow-3 overflow-hidden flex"
      >
        {/* Timeline sidebar */}
        <div className="w-[300px] shrink-0 border-r border-line bg-paper-2 flex flex-col">
          <div className="px-lg py-lg border-b border-line">
            <div className="text-sm font-semibold text-ink">Version history</div>
            <div className="text-[11px] text-ink-3 mt-0.5">
              {fileName} -- {versions.length} version{versions.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1 relative">
            {/* Vertical timeline line */}
            <div
              className="absolute bg-line-2"
              style={{ left: 28, top: 14, bottom: 14, width: 1 }}
            />

            {versions.map((v, i) => {
              const isSelected = i === selectedIdx
              return (
                <button
                  key={v.id}
                  type="button"
                  className="w-full text-left relative cursor-pointer transition-colors"
                  style={{
                    padding: '10px 16px 10px 40px',
                    background: isSelected ? 'var(--color-paper)' : 'transparent',
                    borderLeft: isSelected
                      ? '3px solid var(--color-amber-deep)'
                      : '3px solid transparent',
                  }}
                  onClick={() => setSelectedIdx(i)}
                >
                  {/* Timeline dot */}
                  <div
                    className="absolute rounded-full border-2"
                    style={{
                      left: 23,
                      top: 14,
                      width: 11,
                      height: 11,
                      background: isSelected ? 'var(--color-amber)' : 'var(--color-paper)',
                      borderColor: isSelected ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
                    }}
                  />

                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[11.5px] font-semibold">{v.version}</span>
                    <span className="text-[11px] text-ink-3">-- {v.when}</span>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5">{v.who}</div>
                  <div className="text-[11.5px] text-ink-2 mt-1">{v.delta}</div>
                  {v.milestone && (
                    <div className="mt-1">
                      <BBChip variant="amber">
                        <span className="text-[9px]">{v.milestone}</span>
                      </BBChip>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Diff pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Diff header */}
          <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
            <span className="font-mono text-[11.5px] text-ink-3">{diffLabel}</span>
            <span className="text-[11px] text-ink-4">-- {selected.when}</span>
            <div className="ml-auto flex gap-1.5">
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => onDownload(selected.id)}
              >
                Download {selected.version}
              </BBButton>
              <BBButton
                size="sm"
                variant="amber"
                onClick={() => onRestore(selected.id)}
              >
                Restore this version
              </BBButton>
            </div>
          </div>

          {/* Diff content */}
          <div className="flex-1 overflow-y-auto px-xl py-lg font-mono text-[11.5px] leading-[1.7]">
            {/* Diff header info */}
            <div className="text-ink-3 mb-md">
              <div>@@ {fileName} -- section II. The call</div>
              <div className="text-[11px] mt-0.5">
                +{addedLines} lines -- -{removedLines} lines -- {selected.bytes} total
              </div>
            </div>

            {/* Diff lines */}
            {MOCK_DIFF.map((ln, i) => {
              let bgColor = 'transparent'
              let borderColor = 'transparent'
              let textColor = 'var(--color-ink-2)'

              if (ln.type === '+') {
                bgColor = 'oklch(0.96 0.04 155 / 0.5)'
                borderColor = 'oklch(0.72 0.16 155)'
                textColor = 'oklch(0.3 0.1 155)'
              } else if (ln.type === '-') {
                bgColor = 'oklch(0.97 0.02 25 / 0.5)'
                borderColor = 'var(--color-red)'
                textColor = 'oklch(0.45 0.08 25)'
              }

              return (
                <div
                  key={i}
                  style={{
                    padding: '1px 10px',
                    background: bgColor,
                    borderLeft: `2px solid ${borderColor}`,
                    color: textColor,
                  }}
                >
                  <span className="text-ink-4 mr-2">{ln.type}</span>
                  {ln.content}
                </div>
              )
            })}
          </div>

          {/* Close button at top-right */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-md bg-paper-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
