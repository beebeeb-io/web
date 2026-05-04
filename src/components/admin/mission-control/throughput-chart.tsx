import { useMemo } from 'react'

export interface ThroughputSample {
  bytes_per_sec: number
  files_per_sec: number
  at: string
}

interface ThroughputChartProps {
  samples: ThroughputSample[]
  errors: { at: string }[]
  /** Width of the rolling time window in seconds. Default: 300 (5 minutes). */
  windowSeconds?: number
}

const VIEW_W = 600
const VIEW_H = 160
const PAD_L = 44
const PAD_R = 10
const PAD_T = 10
const PAD_B = 22
const PLOT_W = VIEW_W - PAD_L - PAD_R
const PLOT_H = VIEW_H - PAD_T - PAD_B

const AMBER = 'oklch(0.82 0.17 84)'
const AMBER_FALLBACK = '#f59e0b'
const RED = 'oklch(0.62 0.21 25)'

/** Snap a positive number up to a "nice" round value (1/2/5 × 10^n). */
function niceCeil(value: number): number {
  if (value <= 0) return 50
  const exp = Math.floor(Math.log10(value))
  const base = Math.pow(10, exp)
  const normalized = value / base
  let nice: number
  if (normalized <= 1) nice = 1
  else if (normalized <= 2) nice = 2
  else if (normalized <= 5) nice = 5
  else nice = 10
  return nice * base
}

function formatMbps(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} GB/s`
  if (mbps >= 100) return `${mbps.toFixed(0)} MB/s`
  if (mbps >= 10) return `${mbps.toFixed(0)} MB/s`
  return `${mbps.toFixed(1)} MB/s`
}

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function ThroughputChart({
  samples,
  errors,
  windowSeconds = 300,
}: ThroughputChartProps) {
  const {
    linePath,
    areaPath,
    yTicks,
    xTickLabels,
    errorMarkers,
    currentMbps,
    hasData,
  } = useMemo(() => {
    if (samples.length === 0) {
      return {
        linePath: '',
        areaPath: '',
        yTicks: [] as { y: number; label: string }[],
        xTickLabels: [] as { x: number; label: string }[],
        errorMarkers: [] as { x: number }[],
        currentMbps: 0,
        hasData: false,
      }
    }

    // Anchor the right edge to the most recent sample so the chart reads as
    // "the last N seconds of activity," not "now − N seconds." When data is
    // streaming live this is the same; when the migration finishes the chart
    // freezes at its last state instead of scrolling off into emptiness.
    const lastTs = new Date(samples[samples.length - 1].at).getTime()
    const windowEnd = lastTs
    const windowStart = windowEnd - windowSeconds * 1000

    const visible = samples.filter((s) => {
      const t = new Date(s.at).getTime()
      return t >= windowStart && t <= windowEnd
    })

    const maxBytesPerSec = visible.reduce(
      (acc, s) => Math.max(acc, s.bytes_per_sec),
      0,
    )
    const maxMbps = maxBytesPerSec / 1_000_000
    // Floor the y-scale at 50 MB/s so an idle migration doesn't render as
    // a wildly oscillating line over a 0.5 MB/s range — that misleads at a
    // glance. Real throughput will quickly push past this.
    const yMax = niceCeil(Math.max(maxMbps, 50))

    const xFor = (t: number) =>
      PAD_L + ((t - windowStart) / (windowSeconds * 1000)) * PLOT_W
    const yFor = (mbps: number) =>
      PAD_T + PLOT_H - (mbps / yMax) * PLOT_H

    const points = visible.map((s) => ({
      x: xFor(new Date(s.at).getTime()),
      y: yFor(s.bytes_per_sec / 1_000_000),
    }))

    let lp = ''
    let ap = ''
    if (points.length > 0) {
      lp = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ')
      const baselineY = (PAD_T + PLOT_H).toFixed(1)
      const firstX = points[0].x.toFixed(1)
      const lastX = points[points.length - 1].x.toFixed(1)
      ap = `${lp} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`
    }

    // Y-axis ticks: 0, 25%, 50%, 75%, 100% of yMax.
    const ticks: { y: number; label: string }[] = []
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4
      ticks.push({ y: yFor(v), label: formatMbps(v) })
    }

    // X-axis ticks roughly every minute. windowSeconds=300 → 5 ticks.
    const minuteCount = Math.max(2, Math.round(windowSeconds / 60))
    const xLabels: { x: number; label: string }[] = []
    for (let i = 0; i <= minuteCount; i++) {
      const t = windowStart + (i / minuteCount) * windowSeconds * 1000
      xLabels.push({ x: xFor(t), label: formatClock(new Date(t)) })
    }

    // Error markers: only render those falling inside the visible window.
    const markers = errors
      .map((e) => new Date(e.at).getTime())
      .filter((t) => t >= windowStart && t <= windowEnd)
      .map((t) => ({ x: xFor(t) }))

    return {
      linePath: lp,
      areaPath: ap,
      yTicks: ticks,
      xTickLabels: xLabels,
      errorMarkers: markers,
      currentMbps: visible.length
        ? visible[visible.length - 1].bytes_per_sec / 1_000_000
        : 0,
      hasData: visible.length > 0,
    }
  }, [samples, errors, windowSeconds])

  return (
    <div
      className="rounded-lg border border-line bg-paper p-4"
      data-testid="throughput-chart"
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] uppercase tracking-wider text-ink-3 font-sans">
          Throughput
        </span>
        <span
          className="text-2xl font-mono font-bold text-ink leading-none"
          data-testid="throughput-current"
        >
          {hasData ? formatMbps(currentMbps) : '—'}
        </span>
      </div>

      {!hasData ? (
        <div
          className="flex items-center justify-center text-[11px] text-ink-3 font-mono"
          style={{ height: VIEW_H }}
          data-testid="throughput-empty"
        >
          Waiting for data…
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          height={VIEW_H}
          preserveAspectRatio="none"
          className="block"
          role="img"
          aria-label="Throughput over the last 5 minutes"
        >
          {/* Y-axis grid lines */}
          {yTicks.map((t, i) => (
            <line
              key={`grid-${i}`}
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={t.y}
              y2={t.y}
              stroke="var(--color-line)"
              strokeWidth={i === 0 ? 1 : 0.5}
              strokeDasharray={i === 0 ? '' : '2 3'}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Filled area */}
          {areaPath && (
            <path
              d={areaPath}
              fill={AMBER}
              fillOpacity={0.3}
              style={{ fill: AMBER, fallbacks: AMBER_FALLBACK } as never}
            />
          )}

          {/* Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={AMBER}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Error markers — vertical red dashed lines */}
          {errorMarkers.map((m, i) => (
            <line
              key={`err-${i}`}
              x1={m.x}
              x2={m.x}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              stroke={RED}
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Y-axis labels */}
          {yTicks.map((t, i) => (
            <text
              key={`yl-${i}`}
              x={PAD_L - 6}
              y={t.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-3"
              fontSize={9}
              fontFamily="var(--font-mono)"
            >
              {t.label}
            </text>
          ))}

          {/* X-axis labels */}
          {xTickLabels.map((t, i) => (
            <text
              key={`xl-${i}`}
              x={t.x}
              y={VIEW_H - 6}
              textAnchor={
                i === 0 ? 'start' : i === xTickLabels.length - 1 ? 'end' : 'middle'
              }
              className="fill-ink-3"
              fontSize={9}
              fontFamily="var(--font-mono)"
            >
              {t.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}
