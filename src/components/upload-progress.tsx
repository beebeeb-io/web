import { Icon } from './icons'
import { formatBytes } from '../lib/format'

export interface UploadItem {
  id: string
  name: string
  size: number
  progress: number
  stage: 'Queued' | 'Encrypting' | 'Uploading' | 'Done' | 'Error'
  /** Bytes uploaded so far — used for speed calculation */
  bytesUploaded?: number
  /** Timestamp when uploading stage started */
  startedAt?: number
  /** Whether this upload is paused */
  paused?: boolean
}

interface UploadProgressProps {
  items: UploadItem[]
  onClose: () => void
  onCancel?: (id: string) => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
}


function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.ceil(seconds % 60)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function computeSpeed(item: UploadItem): number {
  if (!item.startedAt || !item.bytesUploaded || item.bytesUploaded === 0) return 0
  const elapsed = (Date.now() - item.startedAt) / 1000
  if (elapsed <= 0) return 0
  return item.bytesUploaded / elapsed
}

function computeEta(item: UploadItem, speed: number): number {
  if (speed <= 0) return Infinity
  const remaining = item.size - (item.bytesUploaded ?? 0)
  return remaining / speed
}

export function UploadProgress({ items, onClose, onCancel, onPause, onResume }: UploadProgressProps) {
  if (items.length === 0) return null

  const totalBytes = items.reduce((s, i) => s + i.size, 0)
  const uploadedBytes = items.reduce((s, i) => s + (i.bytesUploaded ?? i.size * (i.progress / 100)), 0)
  const activeItems = items.filter((i) => i.stage === 'Uploading' && !i.paused)
  const totalSpeed = activeItems.reduce((s, i) => s + computeSpeed(i), 0)

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[420px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-line flex items-center">
        <span className="text-[13px] font-semibold">
          Uploading {items.length} file{items.length > 1 ? 's' : ''}
        </span>
        <span className="font-mono text-[11px] text-ink-3 ml-auto mr-3">
          {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-0.5 text-ink-3 hover:text-ink transition-colors"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Aggregate speed */}
      {totalSpeed > 0 && (
        <div className="px-5 pt-2.5 flex items-center gap-3">
          <span className="font-mono text-[10.5px] text-ink-3">
            {formatSpeed(totalSpeed)}
          </span>
        </div>
      )}

      {/* File list */}
      <div className="px-5 py-3.5 flex flex-col gap-3 max-h-[280px] overflow-y-auto">
        {items.map((item) => {
          const speed = computeSpeed(item)
          const eta = computeEta(item, speed)
          const isActive = item.stage === 'Uploading' || item.stage === 'Encrypting'
          const isDone = item.stage === 'Done'

          return (
            <div key={item.id}>
              <div className="flex items-center gap-2 mb-1">
                {/* File icon / done checkmark */}
                <div
                  className="w-[18px] h-[18px] shrink-0 rounded-[5px] border border-line flex items-center justify-center"
                  style={{
                    background: isDone ? 'oklch(0.94 0.06 155)' : 'var(--color-paper-2)',
                  }}
                >
                  {isDone ? (
                    <Icon name="check" size={11} style={{ color: 'oklch(0.45 0.12 155)' }} />
                  ) : (
                    <Icon name="file" size={10} className="text-ink-3" />
                  )}
                </div>

                {/* File name */}
                <span className="text-[12.5px] font-medium truncate">{item.name}</span>

                {/* Stage + percentage */}
                <span
                  className="font-mono text-[10.5px] font-medium ml-auto shrink-0"
                  style={{
                    color: isDone
                      ? 'oklch(0.45 0.12 155)'
                      : item.paused
                        ? 'var(--color-ink-4)'
                        : item.stage === 'Queued'
                          ? 'var(--color-ink-4)'
                          : 'var(--color-amber-deep)',
                  }}
                >
                  {item.paused ? 'Paused' : item.stage} · {item.progress}%
                </span>

                {/* Pause/Resume button */}
                {isActive && !isDone && onPause && onResume && (
                  <button
                    onClick={() => item.paused ? onResume(item.id) : onPause(item.id)}
                    aria-label={item.paused ? 'Resume upload' : 'Pause upload'}
                    className="p-0.5 text-ink-3 hover:text-ink transition-colors shrink-0"
                  >
                    <Icon name={item.paused ? 'play' : 'pause'} size={12} />
                  </button>
                )}

                {/* Cancel button */}
                {!isDone && onCancel && (
                  <button
                    onClick={() => onCancel(item.id)}
                    aria-label="Cancel upload"
                    className="p-0.5 text-ink-3 hover:text-red transition-colors shrink-0"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>

              {/* Speed + ETA row */}
              {item.stage === 'Uploading' && !isDone && !item.paused && speed > 0 && (
                <div className="flex items-center gap-2 mb-1 ml-[26px]">
                  <span className="font-mono text-[10px] text-ink-4">
                    {formatSpeed(speed)}
                  </span>
                  <span className="font-mono text-[10px] text-ink-4">
                    {formatEta(eta)} remaining
                  </span>
                </div>
              )}

              {/* Progress bar */}
              <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${item.progress}%`,
                    background: isDone
                      ? 'oklch(0.45 0.12 155)'
                      : item.paused
                        ? 'var(--color-ink-4)'
                        : 'var(--color-amber)',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Info banner */}
      <div className="mx-5 mb-4 px-3 py-2.5 bg-amber-bg border border-line rounded-md flex items-center gap-2.5">
        <Icon name="key" size={14} className="text-amber-deep shrink-0" />
        <span className="text-xs" style={{ color: 'oklch(0.35 0.06 72)' }}>
          Keys stay on your device — never on our servers.
        </span>
      </div>
    </div>
  )
}
