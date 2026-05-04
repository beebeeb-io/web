interface PhaseTransition {
  from: string
  to: string
  at: string
}

interface ProgressTimelineProps {
  /** Completion fraction in [0, 1]. */
  progress: number
  errors: { at: string; file_id: string }[]
  phases: PhaseTransition[]
  totalFiles: number
  filesDone: number
  /**
   * Time anchor for positioning markers along the time axis.
   * Defaults to "now" when omitted; pass an explicit value when rendering
   * a finished run so the bar isn't anchored to the current wall clock.
   */
  startedAt?: string
  endedAt?: string
}

/**
 * Horizontal progress bar with error tick marks and phase transition lines.
 *
 * Markers are positioned along the bar's *time* axis (run start → endedAt /
 * now), independent of the progress fill — so an error 30 seconds into a
 * 5-minute run will sit ~10% from the left even if the migration is now 70%
 * complete. That's intentional: the bar tells two stories at once (how far
 * along, and where in time the rough edges happened).
 */
export function ProgressTimeline({
  progress,
  errors,
  phases,
  totalFiles,
  filesDone,
  startedAt,
  endedAt,
}: ProgressTimelineProps) {
  const clamped = Math.max(0, Math.min(1, progress))
  const pct = clamped * 100

  // Time-axis bounds for marker positioning.
  const start = startedAt ? new Date(startedAt).getTime() : null
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()

  const positionPct = (iso: string): number | null => {
    if (start === null) return null
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return null
    const span = end - start
    if (span <= 0) return null
    const frac = (t - start) / span
    if (frac < 0 || frac > 1) return null
    return frac * 100
  }

  const errorTicks = errors
    .map((e) => ({ pct: positionPct(e.at), id: e.file_id }))
    .filter((m): m is { pct: number; id: string } => m.pct !== null)

  const phaseLines = phases
    .map((p) => ({ pct: positionPct(p.at), label: `${p.from} → ${p.to}` }))
    .filter((m): m is { pct: number; label: string } => m.pct !== null)

  const filesLabel = `${filesDone.toLocaleString()} / ${totalFiles.toLocaleString()} files`
  const pctLabel = `${pct.toFixed(pct < 10 ? 1 : 0)}%`

  return (
    <div
      className="rounded-lg border border-line bg-paper p-3"
      data-testid="progress-timeline"
    >
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-3 font-sans">
          Progress
        </span>
        <span
          className="text-[11px] font-mono text-ink-2"
          data-testid="progress-timeline-label"
        >
          {pctLabel} <span className="text-ink-3">·</span> {filesLabel}
        </span>
      </div>

      <div className="relative h-10 rounded-md bg-paper-3 overflow-hidden border border-line">
        {/* Amber fill */}
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: 'oklch(0.82 0.17 84)',
          }}
          aria-hidden
        />

        {/* Phase transition lines (amber, full-height, behind error ticks) */}
        {phaseLines.map((p, i) => (
          <div
            key={`phase-${i}`}
            className="absolute inset-y-0 w-px"
            style={{
              left: `${p.pct}%`,
              background: 'oklch(0.66 0.15 72)', // amber-deep
            }}
            title={p.label}
            aria-label={`Phase change: ${p.label}`}
          />
        ))}

        {/* Error ticks (red, top half so they read as "marks" not "fills") */}
        {errorTicks.map((e, i) => (
          <div
            key={`err-${i}`}
            className="absolute top-0 w-[2px] h-3 rounded-b-sm"
            style={{
              left: `calc(${e.pct}% - 1px)`,
              background: 'oklch(0.62 0.21 25)', // red
            }}
            title={`Error: ${e.id}`}
            aria-label={`Error in file ${e.id}`}
          />
        ))}
        {errorTicks.map((e, i) => (
          <div
            key={`err-b-${i}`}
            className="absolute bottom-0 w-[2px] h-3 rounded-t-sm"
            style={{
              left: `calc(${e.pct}% - 1px)`,
              background: 'oklch(0.62 0.21 25)',
            }}
            aria-hidden
          />
        ))}
      </div>

      {/* Legend (subtle, only shown when markers are present) */}
      {(errorTicks.length > 0 || phaseLines.length > 0) && (
        <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-ink-3">
          {errorTicks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-[2px] h-2.5"
                style={{ background: 'oklch(0.62 0.21 25)' }}
                aria-hidden
              />
              {errorTicks.length} error{errorTicks.length === 1 ? '' : 's'}
            </span>
          )}
          {phaseLines.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-px h-2.5"
                style={{ background: 'oklch(0.66 0.15 72)' }}
                aria-hidden
              />
              {phaseLines.length} phase change{phaseLines.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
