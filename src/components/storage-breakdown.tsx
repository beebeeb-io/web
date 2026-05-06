import { useEffect, useState } from 'react'

export interface StorageBreakdownProps {
  usageBytes: number
  quotaBytes: number
  planName: string
  files?: Array<{ name: string; size_bytes: number }>
  showUpgrade?: boolean
  onUpgrade?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function categorizeFiles(files: Array<{ name: string; size_bytes: number }>) {
  const categories = { Photos: 0, Documents: 0, Videos: 0, Other: 0 }
  const photoExts = /\.(jpe?g|png|heic|webp|gif|svg|raw|cr2|nef)$/i
  const docExts = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|odt|ods)$/i
  const videoExts = /\.(mp4|mov|avi|mkv|webm|m4v)$/i

  for (const f of files) {
    if (photoExts.test(f.name)) categories.Photos += f.size_bytes
    else if (docExts.test(f.name)) categories.Documents += f.size_bytes
    else if (videoExts.test(f.name)) categories.Videos += f.size_bytes
    else categories.Other += f.size_bytes
  }
  return categories
}

const CATEGORY_COLORS: Record<string, string> = {
  Photos:    'oklch(0.75 0.12 72)',
  Documents: 'oklch(0.65 0.12 250)',
  Videos:    'oklch(0.65 0.12 300)',
  Other:     'oklch(0.65 0.05 0)',
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

  if (quotaBytes <= 0) return null

  const pct = Math.min(100, (usageBytes / quotaBytes) * 100)
  const isHigh = pct > 90
  const barColor = isHigh ? 'var(--color-red)' : 'var(--color-amber)'
  const availableBytes = Math.max(0, quotaBytes - usageBytes)

  const categories = files ? categorizeFiles(files) : null
  const categoryEntries = categories
    ? (Object.entries(categories) as [string, number][]).filter(([, v]) => v > 0)
    : []

  return (
    <div className="w-full space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold text-ink">
            {formatBytes(usageBytes)} of {formatBytes(quotaBytes)} used
          </span>
          <span className="text-[11px] font-mono text-ink-4">{planName}</span>
        </div>
        <div className="relative h-3 w-full rounded-full bg-paper-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: mounted ? `${pct}%` : '0%', background: barColor }}
          />
        </div>
      </div>

      {/* Type breakdown */}
      {categoryEntries.length > 0 && (
        <div className="space-y-2">
          {categoryEntries.map(([name, bytes]) => {
            const rowPct = quotaBytes > 0 ? (bytes / quotaBytes) * 100 : 0
            return (
              <div key={name} className="flex items-center gap-3">
                <span className="w-20 text-[12.5px] text-ink-2 shrink-0">{name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-paper-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: mounted ? `${rowPct}%` : '0%',
                      background: CATEGORY_COLORS[name] ?? CATEGORY_COLORS.Other,
                    }}
                  />
                </div>
                <span className="text-[12px] font-mono text-ink-3 w-16 text-right shrink-0">
                  {formatBytes(bytes)}
                </span>
              </div>
            )
          })}
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
