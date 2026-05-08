/**
 * Inline upload progress cards — appear at the top of the file list
 * during upload, replacing the fixed corner-toast UploadProgress.
 *
 * Three visible phases:
 *   1. Encrypting on this device   (amber border)
 *   2. Uploading to <city>         (amber-deep border)
 *   3. Done                        (green flash → removed from list)
 *
 * Spec 024 §4.
 */
import type { UploadItem } from './upload-progress'
import { Icon } from '@beebeeb/shared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatChunkSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  const mib = bytes / (1024 * 1024)
  if (mib >= 1024 && Number.isInteger(mib / 1024)) return `${mib / 1024} GiB`
  if (Number.isInteger(mib)) return `${mib} MiB`
  return `${mib.toFixed(1)} MiB`
}

function regionLabel(region?: string | null): string | null {
  if (!region) return null
  return region
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function phaseLabel(item: UploadItem): string {
  if (item.stage === 'Done') return 'done'
  if (item.stage === 'Error') return 'failed'
  if (item.paused) return 'paused'
  if (item.stage === 'Preparing') return 'Preparing encrypted backup'
  if (item.stage === 'Uploading') {
    if (item.totalChunks) {
      return `Uploading ${item.uploadedChunks ?? 0} / ${item.totalChunks} chunks`
    }
    return `uploading to ${item.storageCity ?? 'Falkenstein'}`
  }
  return 'encrypting on this device'
}

function borderColor(item: UploadItem): string {
  if (item.stage === 'Error') return 'border-l-red'
  if (item.stage === 'Uploading') return 'border-l-amber-deep'
  return 'border-l-amber'
}

function barColor(item: UploadItem): string {
  if (item.stage === 'Uploading') return 'bg-amber-deep'
  return 'bg-amber'
}

// ── Single card ───────────────────────────────────────────────────────────────

interface UploadCardProps {
  upload: UploadItem
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}

export function UploadCard({ upload, onCancel, onRetry }: UploadCardProps) {
  const { stage, progress } = upload
  const isEncrypting = stage === 'Queued' || stage === 'Preparing' || stage === 'Encrypting'
  const isError = stage === 'Error'
  const chunkSize = formatChunkSize(upload.chunkSizeBytes)
  const region = regionLabel(upload.storageRegion)

  // Done cards are removed from the list by the parent; nothing to show.
  if (stage === 'Done') return null

  return (
    <div
      data-testid="upload-card"
      className={`mx-px my-0.5 flex items-start gap-3 px-4 py-3 border-l-2 bg-paper-2 ${borderColor(upload)}`}
    >
      {/* Phase icon */}
      <div className="mt-[1px] shrink-0">
        {isError ? (
          <Icon name="x" size={13} className="text-red" />
        ) : (
          <Icon name="lock" size={13} className="text-amber-deep" />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-ink truncate">{upload.name}</span>
          <span className="text-[11px] text-ink-3 font-mono shrink-0 ml-auto">{phaseLabel(upload)}</span>
        </div>

        {/* Progress bar */}
        {!isError && (
          <div className="mt-1.5 h-[3px] rounded-full bg-line overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor(upload)}`}
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        )}

        {/* Hint below encrypting bar */}
        {isEncrypting && !isError && (
          <div className="text-[10.5px] text-ink-4 mt-1 leading-tight">
            Preparing encrypted backup
          </div>
        )}

        {stage === 'Uploading' && !isError && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-4 leading-tight">
            {chunkSize && <span>Chunk size: {chunkSize}</span>}
            {region && <span>Stored in {region}</span>}
          </div>
        )}

        {/* Error: inline message + retry/cancel */}
        {isError && (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-[11px] text-red leading-tight">
              {upload.errorMessage ?? 'Upload failed.'}
            </span>
            <button
              onClick={() => onRetry(upload.id)}
              className="text-[11px] text-amber-deep hover:underline leading-tight"
            >
              Retry
            </button>
            <button
              onClick={() => onCancel(upload.id)}
              className="text-[11px] text-ink-3 hover:text-ink leading-tight"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Cancel for in-progress */}
      {!isError && (
        <button
          onClick={() => onCancel(upload.id)}
          className="shrink-0 p-0.5 text-ink-4 hover:text-ink transition-colors mt-0.5"
          aria-label="Cancel upload"
          title="Cancel upload"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  )
}

// ── Stacked list ──────────────────────────────────────────────────────────────

interface UploadCardsProps {
  uploads: UploadItem[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}

/**
 * Renders all active (non-Done) upload cards stacked together.
 * Returns null when there's nothing to show.
 */
export function UploadCards({ uploads, onCancel, onRetry }: UploadCardsProps) {
  const active = uploads.filter(u => u.stage !== 'Done')
  if (active.length === 0) return null

  return (
    <div className="border-b border-line">
      {active.map(upload => (
        <UploadCard
          key={upload.id}
          upload={upload}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}
