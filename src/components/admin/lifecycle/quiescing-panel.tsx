/**
 * Quiescing panel — Phase 2 of the pool decommission wizard.
 *
 * Pool is read-only; new uploads route to the target. Admin can abort
 * (revert to active) or advance (begin migration).
 */

import { useState } from 'react'
import { BBButton } from '../../bb-button'
import { Icon } from '../../icons'
import { formatBytes } from '../../../lib/format'
import {
  abortLifecycleRun,
  advanceLifecycleRun,
  type LifecycleRun,
  type PoolInsights,
} from '../../../lib/api'

interface QuiescingPanelProps {
  poolId: string
  run: LifecycleRun
  insights: PoolInsights | null
  targetPoolName: string
  onPhaseChanged: () => void
}

export function QuiescingPanel({
  poolId,
  run,
  insights,
  targetPoolName,
  onPhaseChanged,
}: QuiescingPanelProps) {
  const [submitting, setSubmitting] = useState<'abort' | 'advance' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAbort() {
    const ok = window.confirm(
      `Abort decommission?\n\nThe pool returns to active immediately. Files written to ${targetPoolName} during quiescing stay there.`,
    )
    if (!ok) return
    setError(null)
    setSubmitting('abort')
    try {
      await abortLifecycleRun(poolId, run.id, 'quiescing', false)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abort failed.')
    } finally {
      setSubmitting(null)
    }
  }

  async function handleAdvance() {
    const ok = window.confirm(
      `Begin migrating ${insights?.files_count.toLocaleString() ?? '?'} files to ${targetPoolName}?\n\nYou can pause at any time.`,
    )
    if (!ok) return
    setError(null)
    setSubmitting('advance')
    try {
      await advanceLifecycleRun(poolId, run.id, 'quiescing')
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to begin migration.')
    } finally {
      setSubmitting(null)
    }
  }

  const busy = submitting !== null
  const startedAt = new Date(run.started_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div>
      {/* Status banner */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 rounded-lg mb-5"
        style={{
          background: 'var(--color-amber-bg)',
          border: '1px solid var(--color-amber)',
        }}
      >
        <Icon name="lock" size={14} className="text-amber-deep shrink-0" />
        <p className="text-sm font-medium" style={{ color: 'var(--color-amber-deep)' }}>
          This pool is read-only. New uploads route to <strong>{targetPoolName}</strong>.
        </p>
      </div>

      {/* 2×2 KPI grid */}
      <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">
        Current state
      </p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Files remaining</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight">
            {insights?.files_count.toLocaleString() ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Storage used</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight">
            {insights ? formatBytes(insights.used_bytes) : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Target pool</div>
          <div className="text-sm font-semibold text-ink leading-tight truncate">
            {targetPoolName}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Quiescing since</div>
          <div className="font-mono text-sm font-medium text-ink leading-tight">
            {startedAt}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTAs */}
      <div className="flex items-center gap-3">
        <BBButton
          variant="ghost"
          disabled={busy}
          onClick={handleAbort}
          className="text-red border-red hover:bg-red/5"
        >
          {submitting === 'abort' ? (
            <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Aborting…</>
          ) : 'Abort decommission'}
        </BBButton>

        <BBButton
          variant="amber"
          size="lg"
          disabled={busy}
          onClick={handleAdvance}
        >
          {submitting === 'advance' ? (
            <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Starting…</>
          ) : (
            <>Begin migration<Icon name="chevron-right" size={14} className="ml-1.5" /></>
          )}
        </BBButton>
      </div>

      <p className="text-[11px] text-ink-4 mt-4 leading-relaxed">
        Aborting reverts the pool to active immediately. Files written to {targetPoolName} during quiescing are not reversed automatically.
      </p>
    </div>
  )
}
