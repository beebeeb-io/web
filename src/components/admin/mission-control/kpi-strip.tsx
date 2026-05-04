/**
 * KPI strip — four horizontal stat cards for the Mission Control monitor.
 * Matches the KpiCard visual pattern from the Dashboard.
 */

import { formatBytes } from '../../../lib/format'
import type { RunProgress } from '../../../lib/api'

interface KpiStripProps {
  progress: RunProgress | null
}

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  danger?: boolean
}

function Card({ label, value, sub, danger }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-line bg-paper p-3 min-w-0 flex-1">
      <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1 truncate">{label}</div>
      <div
        className={`font-mono text-lg font-bold leading-tight truncate ${
          danger ? 'text-red' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] text-ink-4 mt-0.5 truncate">{sub}</div>
      )}
    </div>
  )
}

function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function KpiStrip({ progress }: KpiStripProps) {
  if (!progress) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {['Progress', 'Throughput', 'ETA', 'Failed'].map((label) => (
          <div key={label} className="rounded-lg border border-line bg-paper p-3 min-w-0 flex-1 animate-pulse">
            <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">{label}</div>
            <div className="h-6 w-16 bg-paper-3 rounded" />
          </div>
        ))}
      </div>
    )
  }

  const pct = Math.round(progress.phase_progress * 100)
  const throughputMBps = (progress.throughput_bytes_per_sec / 1_000_000)

  return (
    <div className="grid grid-cols-4 gap-3">
      <Card
        label="Progress"
        value={`${pct}%`}
        sub={`${progress.files_migrated.toLocaleString()} / ${progress.files_total.toLocaleString()} files`}
      />
      <Card
        label="Throughput"
        value={`${formatBytes(progress.throughput_bytes_per_sec)}/s`}
        sub={throughputMBps > 0 ? `${throughputMBps.toFixed(1)} MB/s` : undefined}
      />
      <Card
        label="ETA"
        value={formatEta(progress.eta_seconds)}
        sub={progress.files_pending > 0 ? `${progress.files_pending.toLocaleString()} pending` : undefined}
      />
      <Card
        label="Failed"
        value={progress.files_failed.toLocaleString()}
        sub={progress.files_failed > 0 ? 'will retry' : undefined}
        danger={progress.files_failed > 0}
      />
    </div>
  )
}
