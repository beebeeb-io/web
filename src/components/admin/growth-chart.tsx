interface GrowthChartProps {
  data: { label: string; value: number }[]
  tabs: { key: string; label: string }[]
  activeTab: string
  onTabChange: (key: string) => void
  ranges?: { key: string; label: string }[]
  activeRange?: string
  onRangeChange?: (key: string) => void
}

export function GrowthChart({
  data,
  tabs,
  activeTab,
  onTabChange,
  ranges,
  activeRange,
  onRangeChange,
}: GrowthChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="rounded-lg border border-line bg-paper">
      <div className="flex items-center gap-0 border-b border-line px-4">
        <div className="flex gap-0 flex-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`px-3 py-2.5 text-[12px] border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-amber font-semibold text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink-2'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {ranges && onRangeChange && (
          <div className="flex gap-1">
            {ranges.map(r => (
              <button
                key={r.key}
                onClick={() => onRangeChange(r.key)}
                className={`px-2 py-1 text-[10px] rounded ${
                  activeRange === r.key
                    ? 'bg-paper-3 font-semibold text-ink'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-4">
        <div className="flex items-end gap-[2px] h-[120px]">
          {data.map((d, i) => {
            const pct = (d.value / maxValue) * 100
            return (
              <div
                key={i}
                className="flex-1 min-w-0 group relative"
                style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
              >
                <div
                  className="w-full rounded-t-sm transition-all"
                  style={{
                    height: `${Math.max(pct, 2)}%`,
                    background: `oklch(0.82 0.17 84 / ${0.3 + (pct / 100) * 0.7})`,
                  }}
                />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-ink text-paper text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                  {d.label}: {d.value}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
