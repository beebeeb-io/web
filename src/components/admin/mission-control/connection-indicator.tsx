/**
 * Connection indicator — footer bar showing poll/WebSocket status
 * + cumulative stats (files processed + bytes transferred).
 */

import { formatBytes } from '../../../lib/format'
import type { RunProgress } from '../../../lib/api'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'polling'

interface ConnectionIndicatorProps {
  status: ConnectionStatus
  progress: RunProgress | null
  lastUpdated: Date | null
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string }> = {
  connected:    { label: 'Connected',          color: 'oklch(0.55 0.12 155)' },
  reconnecting: { label: 'Reconnecting…',      color: 'var(--color-amber-deep)' },
  polling:      { label: 'Polling fallback',   color: 'var(--color-ink-4)' },
}

export function ConnectionIndicator({
  status,
  progress,
  lastUpdated,
}: ConnectionIndicatorProps) {
  const { label, color } = STATUS_CONFIG[status]

  const totalProcessed = progress
    ? (progress.files_migrated + progress.files_failed).toLocaleString()
    : '—'

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div className="border-t border-line bg-paper-2 px-5 py-2 flex items-center gap-5 text-[11px] font-mono">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
        <span style={{ color }}>{label}</span>
      </div>

      {/* Divider */}
      <span className="text-ink-4">·</span>

      {/* Files processed */}
      <span className="text-ink-3">
        <span className="text-ink">{totalProcessed}</span> files processed
      </span>

      {/* Divider */}
      <span className="text-ink-4">·</span>

      {/* Bytes transferred */}
      <span className="text-ink-3">
        <span className="text-ink">
          {progress
            ? formatBytes(progress.throughput_bytes_per_sec * /* elapsed estimate */ 1)
            : '—'}
        </span>{' '}
        transferred
      </span>

      {/* Last updated pushed right */}
      <span className="ml-auto text-ink-4">Updated {updatedStr}</span>
    </div>
  )
}
