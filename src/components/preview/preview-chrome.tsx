import type { ReactNode } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'

interface PreviewChromeProps {
  filename: string
  kind: string
  size: string
  onClose: () => void
  children: ReactNode
  rightRail?: ReactNode
  /** True once decryption finished — drives the trust line below the title. */
  decrypted?: boolean
  /** Optional content rendered between the top bar and the body (e.g. version scrubber). */
  belowTopBar?: ReactNode
}

export function PreviewChrome({
  filename,
  kind,
  size,
  onClose,
  children,
  rightRail,
  decrypted = false,
  belowTopBar,
}: PreviewChromeProps) {
  const kindIcon = kind.startsWith('image') ? 'file' : 'file' as const

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-paper text-ink">
      {/* Top bar — auto-height to fit two-line title + trust subtitle */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-3.5 py-2">
        {/* Back button */}
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-ink transition-colors hover:bg-paper-3"
        >
          <Icon name="chevron-right" size={13} className="rotate-180" />
        </button>

        {/* File info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-paper-2">
              <Icon name={kindIcon} size={12} />
            </span>
            <span className="truncate text-[13px] font-medium text-ink">
              {filename}
            </span>
            <span className="font-mono text-[11px] text-ink-3">{size}</span>
            <BBChip variant="amber">
              <Icon name="lock" size={9} className="mr-1" />
              <span className="text-[9px]">Decrypted locally</span>
            </BBChip>
          </div>
          {decrypted && (
            <div
              key={filename}
              className="decrypt-fade-in font-mono text-[10.5px] text-ink-3 mt-0.5 ml-[30px] flex items-center gap-1.5"
            >
              <span className="inline-block h-1 w-1 rounded-full bg-amber-deep" />
              <span>Decrypted locally · key never left this device</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5">
          {(['download', 'share', 'star'] as const).map((action) => (
            <button
              key={action}
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-ink-2 transition-colors hover:bg-paper-3"
            >
              <Icon name={action} size={13} />
            </button>
          ))}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-ink-2 transition-colors hover:bg-paper-3"
          >
            <Icon name="settings" size={13} />
          </button>
        </div>
      </div>

      {belowTopBar}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas area */}
        <div className="relative flex flex-1 items-center justify-center bg-paper-2 p-6">
          {children}
        </div>

        {/* Right rail */}
        {rightRail && (
          <div className="w-[280px] shrink-0 overflow-auto border-l border-line bg-paper-2 p-[18px] text-ink-2">
            {rightRail}
          </div>
        )}
      </div>
    </div>
  )
}
