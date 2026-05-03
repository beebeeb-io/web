import { formatBytes } from '../../lib/format'

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  format?: 'number' | 'bytes' | 'currency'
}

export function KpiCard({ label, value, sub, format }: KpiCardProps) {
  let display: string
  if (format === 'bytes' && typeof value === 'number') {
    display = formatBytes(value)
  } else if (format === 'currency' && typeof value === 'number') {
    display = `€${value.toLocaleString('nl-NL', { minimumFractionDigits: 0 })}`
  } else {
    display = String(value)
  }

  return (
    <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
      <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1 truncate">
        {label}
      </div>
      <div className="font-mono text-lg font-bold text-ink leading-tight truncate">
        {display}
      </div>
      {sub && (
        <div className="font-mono text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>
      )}
    </div>
  )
}
