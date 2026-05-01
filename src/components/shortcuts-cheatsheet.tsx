import { modLabel } from '../hooks/use-keyboard-shortcuts'

interface ShortcutsCheatsheetProps {
  open: boolean
  onClose: () => void
}

// Keep this list in sync with src/hooks/use-keyboard-shortcuts.ts —
// don't list shortcuts here that aren't actually bound, otherwise users
// press them and nothing happens.
const groups = [
  {
    label: 'Navigation',
    items: [
      ['Open command palette', `${modLabel} K`],
      ['Search', `${modLabel} F`],
      ['Show this cheatsheet', '?'],
    ],
  },
  {
    label: 'File actions',
    items: [
      ['Upload', `${modLabel} U`],
      ['New folder', `${modLabel} N`],
      ['Download selection', `${modLabel} D`],
      ['Move to trash', 'Del'],
    ],
  },
  {
    label: 'Selection',
    items: [
      ['Select all', `${modLabel} A`],
      ['Star / unstar selection', `${modLabel} S`],
      ['Close modal / clear', 'Esc'],
    ],
  },
]

export function ShortcutsCheatsheet({ open, onClose }: ShortcutsCheatsheetProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-full max-w-[720px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-xl py-md border-b border-line">
          <span className="text-sm font-semibold text-ink">
            Keyboard shortcuts
          </span>
          <span className="ml-auto inline-flex items-center px-sm py-xs text-xs font-medium bg-paper-2 text-ink-2 border border-line rounded-sm">
            Press{' '}
            <kbd className="ml-1 font-mono">?</kbd>{' '}
            anywhere
          </span>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-xl p-xl">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                {group.label}
              </div>
              {group.items.map(([desc, shortcut], i) => (
                <div
                  key={i}
                  className={`flex items-center py-1.5 ${
                    i < group.items.length - 1 ? 'border-b border-line' : ''
                  }`}
                >
                  <span className="text-[12.5px] text-ink">{desc}</span>
                  <kbd className="ml-auto text-[11px] font-mono px-2 py-0.5 bg-paper-2 border border-line-2 rounded text-ink-3">
                    {shortcut}
                  </kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
