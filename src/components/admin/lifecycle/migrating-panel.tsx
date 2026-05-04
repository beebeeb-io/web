/**
 * Migrating panel — Phase 3 of the pool decommission wizard.
 *
 * Polls getLifecycleRun every 5 s. Auto-advances to drained panel when done.
 */

import { useEffect, useState } from 'react'
import { BBButton } from '../../bb-button'
import { formatBytes } from '../../../lib/format'
import {
  getLifecycleRun,
  abortLifecycleRun,
  type LifecycleRun,
  type RunProgress,
} from '../../../lib/api'

function formatMigrationTime(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface MigratingPanelProps {
  poolId: string
  run: LifecycleRun
  targetPoolName: string
  onPhaseChanged: () => void
}

export function MigratingPanel({
  poolId,
  run,
  targetPoolName,
  onPhaseChanged,
}: MigratingPanelProps) {
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)

  useEffect(() => {
    getLifecycleRun(poolId, run.id)
      .then((p) => { setRunProgress(p); if (p.run.current_phase !== 'migrating') onPhaseChanged() })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to fetch progress.'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, run.id])

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const p = await getLifecycleRun(poolId, run.id)
        setRunProgress(p)
        setLoadError(null)
        if (p.run.current_phase !== 'migrating') onPhaseChanged()
      } catch { /* transient — wait for next tick */ }
    }, 5000)
    return () => clearInterval(id)
  }, [poolId, run.id, onPhaseChanged])

  async function handlePause() {
    const ok = window.confirm(`Pause migration to ${targetPoolName}?\n\nThe pool returns to quiescing — read-only, uploads still route to ${targetPoolName}. Resume by clicking 'Begin migration' again.`)
    if (!ok) return
    setPauseError(null)
    setPausing(true)
    try {
      await abortLifecycleRun(poolId, run.id, 'migrating', false)
      onPhaseChanged()
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Pause failed.')
    } finally {
      setPausing(false)
    }
  }

  const pct = runProgress ? Math.round(runProgress.phase_progress * 100) : 0

  return (
    <div>
      {/* Progress section */}
      <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">
        Migration progress
      </p>

      {loadError && !runProgress && (
        <p className="text-xs text-red mb-3">{loadError}</p>
      )}

      {/* Progress bar card */}
      <div className="rounded-lg border border-line bg-paper overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <span className="text-[12px] font-semibold text-ink flex-1">
            {runProgress
              ? `${runProgress.files_migrated.toLocaleString()} / ${runProgress.files_total.toLocaleString()} files`
              : 'Loading…'}
          </span>
          <span className="font-mono text-sm font-bold text-amber-deep tabular-nums">{pct}%</span>
        </div>
        <div className="px-4 py-3">
          <div className="h-2 rounded-full bg-paper-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${pct}%`, background: 'var(--color-amber)' }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-ink-4">
              To <span className="font-medium">{targetPoolName}</span>
            </span>
            <span className="font-mono text-[10px] text-ink-4 tabular-nums">
              {runProgress ? `${runProgress.files_pending.toLocaleString()} pending` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* 2×2 KPI grid */}
      {runProgress && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
            <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">ETA</div>
            <div className="font-mono text-lg font-bold text-ink leading-tight">
              {formatMigrationTime(runProgress.eta_seconds)}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
            <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Throughput</div>
            <div className="font-mono text-lg font-bold text-ink leading-tight">
              {formatBytes(runProgress.throughput_bytes_per_sec)}/s
            </div>
          </div>
          <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
            <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Migrated</div>
            <div className="font-mono text-lg font-bold text-ink leading-tight">
              {runProgress.files_migrated.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
            <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Failed</div>
            <div
              className={`font-mono text-lg font-bold leading-tight ${
                runProgress.files_failed > 0 ? 'text-amber-deep' : 'text-ink'
              }`}
            >
              {runProgress.files_failed.toLocaleString()}
            </div>
            {runProgress.files_failed > 0 && (
              <div className="font-mono text-[10px] text-amber-deep mt-0.5">will retry</div>
            )}
          </div>
        </div>
      )}

      {/* Pause error */}
      {pauseError && <p className="text-xs text-red mb-3">{pauseError}</p>}

      {/* CTA */}
      <BBButton variant="ghost" disabled={pausing} onClick={handlePause}>
        {pausing ? (
          <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Pausing…</>
        ) : 'Pause migration'}
      </BBButton>

      <p className="text-[11px] text-ink-4 mt-4">
        Updates every 5 seconds. Pausing reverts to quiescing — resume by clicking "Begin migration".
      </p>
    </div>
  )
}
