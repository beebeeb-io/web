import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/format'

export interface StorageBreakdownProps {
  usageBytes: number
  quotaBytes: number
  planName: string
  files?: Array<{ size_bytes: number; is_folder: boolean; is_media?: boolean }>
  showUpgrade?: boolean
  onUpgrade?: () => void
}

type CategoryKey = 'Media' | 'Other files'

const CATEGORY_CONFIG: Record<CategoryKey, { barClass: string; dotClass: string }> = {
  Media:         { barClass: 'bg-amber',    dotClass: 'bg-amber' },
  'Other files': { barClass: 'bg-ink-3',    dotClass: 'bg-ink-3' },
}

const CATEGORY_ORDER: CategoryKey[] = ['Media', 'Other files']

function categorizeFiles(
  files: Array<{ size_bytes: number; is_folder: boolean; is_media?: boolean }>,
): Record<CategoryKey, number> {
  const totals: Record<CategoryKey, number> = { Media: 0, 'Other files': 0 }
  for (const f of files) {
    if (f.is_folder) continue
    totals[f.is_media ? 'Media' : 'Other files'] += f.size_bytes
  }
  return totals
}

export function StorageBreakdown({
  usageBytes,
  quotaBytes,
  planName,
  files,
  showUpgrade = false,
  onUpgrade,
}: StorageBreakdownProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80)
    return () => clearTimeout(t)
  }, [])

  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return null

  const pct = Math.min(100, (usageBytes / quotaBytes) * 100)
  const isHigh = pct > 90
  const barColor = isHigh ? 'var(--color-red)' : 'var(--color-amber)'
  const availableBytes = Math.max(0, quotaBytes - usageBytes)

  const breakdown = files ? categorizeFiles(files) : null
  const breakdownEntries = breakdown
    ? CATEGORY_ORDER.filter((key) => breakdown[key] > 0).map((key) => ({
        key,
        bytes: breakdown[key],
        pct: quotaBytes > 0 ? (breakdown[key] / quotaBytes) * 100 : 0,
        ...CATEGORY_CONFIG[key],
      }))
    : []

  return (
    <div className="w-full space-y-4">
      {/* Overall progress bar */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold text-ink">
            {formatBytes(usageBytes)} of {formatBytes(quotaBytes)} used
          </span>
          <span className="text-[11px] font-mono text-ink-4 capitalize">{planName}</span>
        </div>
        <div className="relative h-2.5 w-full rounded-full bg-paper-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: mounted ? `${pct}%` : '0%', background: barColor }}
          />
        </div>
      </div>

      {/* File-type breakdown */}
      {breakdownEntries.length > 0 && (
        <div className="space-y-2.5">
          {breakdownEntries.map(({ key, bytes, pct: rowPct, barClass, dotClass }) => (
            <div key={key} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 w-24 shrink-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                <span className="text-[12.5px] text-ink-2">{key}</span>
              </div>
              <div className="flex-1 h-1.5 rounded-full bg-paper-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${barClass}`}
                  style={{ width: mounted ? `${rowPct}%` : '0%' }}
                />
              </div>
              <span className="text-[12px] font-mono text-ink-3 w-16 text-right shrink-0">
                {formatBytes(bytes)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Available space */}
      <div className="text-[13px] text-ink-2">
        <span className="font-mono font-semibold text-ink">{formatBytes(availableBytes)}</span>
        {' '}available
      </div>

      {/* Plan badge + upgrade CTA */}
      {showUpgrade && (
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-paper-2 border border-line">
            <span className="w-2 h-2 rounded-full bg-amber-deep shrink-0" />
            <span className="text-[12.5px] font-medium text-ink capitalize">{planName}</span>
          </div>
          {onUpgrade ? (
            <button
              onClick={onUpgrade}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all"
            >
              Upgrade
            </button>
          ) : (
            <a
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all no-underline"
            >
              Upgrade
            </a>
          )}
        </div>
      )}
    </div>
  )
}
