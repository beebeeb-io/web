/**
 * Migrating panel — Phase 3 of the pool decommission wizard.
 *
 * Renders when lifecycle_phase === 'migrating'. Polls getLifecycleRun every
 * 5 s for live progress and auto-advances to the drained panel when the run
 * completes (current_phase transitions away from 'migrating').
 */

import { useEffect, useState } from 'react'
import { BBButton } from '../../bb-button'
import { Icon } from '../../icons'
import { formatBytes } from '../../../lib/format'
import {
  getLifecycleRun,
  abortLifecycleRun,
  type LifecycleRun,
  type RunProgress,
} from '../../../lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format seconds as "~Xh Ym", "~Ym", or "< 1 min". Shared with InsightsPanel. */
function formatMigrationTime(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  return `~${m}m`
}

// ─── Component ────────────────────────────────────────────────────────────────

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

  // Initial fetch on mount so progress shows immediately rather than after
  // the first 5 s tick.
  useEffect(() => {
    getLifecycleRun(poolId, run.id)
      .then((progress) => {
        setRunProgress(progress)
        if (progress.run.current_phase !== 'migrating') {
          onPhaseChanged()
        }
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to fetch progress.')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, run.id])

  // Poll every 5 s for live progress.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const progress = await getLifecycleRun(poolId, run.id)
        setRunProgress(progress)
        setLoadError(null)
        if (progress.run.current_phase !== 'migrating') {
          onPhaseChanged() // auto-advanced to drained (or aborted to quiescing)
        }
      } catch (err) {
        // Don't surface transient poll errors — just log and wait for next tick.
        console.warn('[MigratingPanel] poll failed:', err)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [poolId, run.id, onPhaseChanged])

  async function handlePause() {
    const ok = window.confirm(
      `Pause migration to ${targetPoolName}?\n\n` +
        `The pool will return to quiescing — read-only, uploads still route to ` +
        `${targetPoolName}. You can resume by clicking 'Begin migration' again.`,
    )
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
    <div className="max-w-xl">
      {/* Heading */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-base font-semibold text-ink">Migrating</h3>
        <Icon name="chevron-right" size={14} className="text-ink-3" />
        <span className="text-base font-semibold text-ink">{targetPoolName}</span>
      </div>
      <p className="text-sm text-ink-3 mb-5">
        Files are being copied in the background. This page updates every 5 seconds.
      </p>

      {loadError && !runProgress && (
        <p className="text-xs text-red mb-3">{loadError}</p>
      )}

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5 gap-2">
          <span className="text-sm font-medium text-ink">
            {runProgress
              ? `${runProgress.files_migrated.toLocaleString()} / ${runProgress.files_total.toLocaleString()} files`
              : 'Loading…'}
          </span>
          <span className="font-mono text-sm font-medium text-amber-deep tabular-nums">
            {pct}%
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-paper-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: 'var(--color-amber)',
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      {runProgress && (
        <div className="bg-paper-2 border border-line rounded-lg px-4 py-1 mb-5">
          <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
            <span className="text-sm text-ink-2">ETA</span>
            <span className="text-sm font-medium font-mono tabular-nums text-ink">
              {formatMigrationTime(runProgress.eta_seconds)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
            <span className="text-sm text-ink-2">Throughput</span>
            <span className="text-sm font-medium font-mono tabular-nums text-ink">
              {formatBytes(runProgress.throughput_bytes_per_sec)}/s
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
            <span className="text-sm text-ink-2">Pending</span>
            <span className="text-sm font-medium font-mono tabular-nums text-ink">
              {runProgress.files_pending.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-ink-2">Migrated</span>
            <span className="text-sm font-medium font-mono tabular-nums text-ink">
              {runProgress.files_migrated.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Failure warning — only when files have failed */}
      {runProgress && runProgress.files_failed > 0 && (
        <div
          className="flex items-start gap-2.5 px-3 py-2.5 rounded-md mb-4"
          style={{
            background: 'var(--color-amber-bg)',
            border: '1px solid var(--color-amber)',
          }}
        >
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-xs text-ink-2">
            <span className="font-semibold font-mono">{runProgress.files_failed.toLocaleString()}</span>{' '}
            file{runProgress.files_failed !== 1 ? 's' : ''} failed — the worker will retry automatically.
          </p>
        </div>
      )}

      {/* Pause error */}
      {pauseError && <p className="text-xs text-red mb-3">{pauseError}</p>}

      {/* CTA */}
      <BBButton variant="ghost" disabled={pausing} onClick={handlePause}>
        {pausing ? (
          <>
            <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            Pausing…
          </>
        ) : (
          'Pause migration'
        )}
      </BBButton>

      <p className="text-xs text-ink-4 mt-4 leading-relaxed">
        Pausing returns the pool to quiescing — uploads still route to {targetPoolName}.
        Resume by clicking "Begin migration" from the quiescing panel.
      </p>
    </div>
  )
}
