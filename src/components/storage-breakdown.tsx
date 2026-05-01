import { useState, useEffect } from 'react'
import { formatStorageSI } from '../lib/format'

export interface StorageSegment {
  label: string
  bytes: number
  color: string
}

export function StorageBreakdown({
  segments,
  totalBytes,
}: {
  segments: StorageSegment[]
  totalBytes: number
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80)
    return () => clearTimeout(t)
  }, [])

  const totalUsed = segments.reduce((s, seg) => s + seg.bytes, 0)

  return (
    <div>
      <div className="relative h-3 rounded-full bg-paper-3 overflow-hidden flex">
        {segments.map((seg, i) => {
          const pct = totalBytes > 0 ? (seg.bytes / totalBytes) * 100 : 0
          if (pct < 0.3) return null
          return (
            <div
              key={i}
              className="h-full transition-all duration-700 ease-out first:rounded-l-full last:rounded-r-full"
              style={{
                width: mounted ? `${pct}%` : '0%',
                background: seg.color,
                transitionDelay: `${i * 120}ms`,
              }}
            />
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-ink-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: seg.color }}
            />
            <span>{seg.label}</span>
            <span className="font-mono text-ink-3">{formatStorageSI(seg.bytes)}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span className="w-2 h-2 rounded-full shrink-0 bg-paper-3" />
          <span>Available</span>
          <span className="font-mono">{formatStorageSI(Math.max(0, totalBytes - totalUsed))}</span>
        </div>
      </div>
    </div>
  )
}
