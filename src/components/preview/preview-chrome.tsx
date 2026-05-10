import type { ReactNode } from 'react'
import { Icon } from '@beebeeb/shared'

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
  /** Action callbacks — wired from the parent file preview */
  onDownload?: () => void
  onShare?: () => void
  onStar?: () => void
  isStarred?: boolean
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
  onDownload,
  onShare,
  onStar,
  isStarred = false,
}: PreviewChromeProps) {
  const kindIcon = kind.startsWith('image') ? 'file' : 'file' as const

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-paper text-ink">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-paper px-3 py-2">
        {/* Back button */}
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper-2 text-ink transition-colors hover:bg-paper-3"
        >
          <Icon name="chevron-right" size={13} className="rotate-180" />
        </button>

        {/* File info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[4px] bg-paper-2">
              <Icon name={kindIcon} size={11} />
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium text-ink">
              {filename}
            </span>
            {/* Amber encryption dot — visible on all sizes */}
            {decrypted && (
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-deep"
                title="Decrypted locally — key never left this device"
              />
            )}
          </div>
          {/* Trust line — only on desktop where there's room */}
          {decrypted && (
            <div
              key={filename}
              className="decrypt-fade-in hidden font-mono text-[10.5px] text-ink-3 mt-0.5 ml-[27px] items-center gap-1.5 sm:flex"
            >
              <span>Decrypted locally · key never left this device</span>
            </div>
          )}
        </div>

        {/* Desktop action buttons — hidden on mobile (shown in bottom bar instead) */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <span className="font-mono text-[11px] text-ink-3 mr-1">{size}</span>
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-ink-2 transition-colors hover:bg-paper-3"
              aria-label="Share"
            >
              <Icon name="share" size={13} />
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-2 text-ink-2 transition-colors hover:bg-paper-3"
              aria-label="Download"
            >
              <Icon name="download" size={13} />
            </button>
          )}
          {onStar && (
            <button
              type="button"
              onClick={onStar}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                isStarred
                  ? 'bg-amber-bg text-amber-deep hover:bg-amber-bg/80'
                  : 'bg-paper-2 text-ink-2 hover:bg-paper-3'
              }`}
              aria-label={isStarred ? 'Unstar' : 'Star'}
            >
              <Icon name="star" size={13} />
            </button>
          )}
        </div>
      </div>

      {belowTopBar}

      {/* Body — stacked on mobile (canvas on top, info below), side-by-side on md+ */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-auto md:overflow-hidden">
        {/* Canvas area */}
        <div className="relative flex w-full md:flex-1 items-center justify-center bg-paper-2 p-4 md:p-6 min-h-[45vh] md:min-h-0">
          {children}
        </div>

        {/* Right rail — desktop only */}
        {rightRail && (
          <div className="w-full md:w-[280px] shrink-0 overflow-auto border-t md:border-t-0 md:border-l border-line bg-paper-2 p-[18px] text-ink-2">
            {rightRail}
          </div>
        )}
      </div>

      {/* Mobile action bar — shown only on small screens, below the image */}
      {(onDownload || onShare || onStar) && (
        <div className="flex shrink-0 items-center justify-around border-t border-line bg-paper px-4 py-2.5 sm:hidden">
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="flex flex-col items-center gap-1 text-ink-2 active:text-ink"
              aria-label="Share"
            >
              <Icon name="share" size={20} />
              <span className="text-[10px]">Share</span>
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="flex flex-col items-center gap-1 text-ink-2 active:text-ink"
              aria-label="Download"
            >
              <Icon name="download" size={20} />
              <span className="text-[10px]">Download</span>
            </button>
          )}
          {onStar && (
            <button
              type="button"
              onClick={onStar}
              className={`flex flex-col items-center gap-1 ${isStarred ? 'text-amber-deep' : 'text-ink-2'} active:text-ink`}
              aria-label={isStarred ? 'Unstar' : 'Star'}
            >
              <Icon name="star" size={20} />
              <span className="text-[10px]">{isStarred ? 'Starred' : 'Star'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
