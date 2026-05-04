/**
 * Quiescing panel — Phase 2 of the pool decommission wizard.
 *
 * Renders when lifecycle_phase === 'quiescing'. The pool is read-only;
 * new uploads route to the target. Admin can either abort (revert to active)
 * or advance (begin migration).
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
  /** display_name (or name) of the target pool — resolved by parent. */
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
      `Abort decommission?\n\n` +
        `The pool will return to active and accept new uploads again.\n` +
        `Files written to ${targetPoolName} during this quiescing window will stay there.`,
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
      `Begin migrating files to ${targetPoolName}?\n\n` +
        `${insights?.files_count.toLocaleString() ?? '?'} ` +
        `file${insights?.files_count !== 1 ? 's' : ''} will be copied in the background. ` +
        `You can pause migration at any time.`,
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

  return (
    <div className="max-w-xl">
      {/* Heading */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-base font-semibold text-ink">Quiescing</h3>
        <Icon name="chevron-right" size={14} className="text-ink-3" />
        <span className="text-base font-semibold text-ink">{targetPoolName}</span>
      </div>
      <p className="text-sm text-ink-3 mb-5">
        This pool is read-only. New uploads are routed to {targetPoolName}.
      </p>

      {/* Stats */}
      <div className="bg-paper-2 border border-line rounded-lg px-4 py-1 mb-5">
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
          <span className="text-sm text-ink-2">Files still on this pool</span>
          <span className="text-sm font-medium font-mono tabular-nums text-ink">
            {insights?.files_count.toLocaleString() ?? '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
          <span className="text-sm text-ink-2">Storage used</span>
          <span className="text-sm font-medium font-mono tabular-nums text-ink">
            {insights ? formatBytes(insights.used_bytes) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-sm text-ink-2">Run started</span>
          <span className="text-sm font-medium font-mono tabular-nums text-ink">
            {new Date(run.started_at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTAs */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Abort — secondary, destructive */}
        <BBButton
          variant="ghost"
          disabled={busy}
          onClick={handleAbort}
          className="text-red border-red hover:bg-red/5"
        >
          {submitting === 'abort' ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
              Aborting…
            </>
          ) : (
            'Abort decommission'
          )}
        </BBButton>

        {/* Advance — primary, amber */}
        <BBButton
          variant="amber"
          size="lg"
          disabled={busy}
          onClick={handleAdvance}
        >
          {submitting === 'advance' ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
              Starting migration…
            </>
          ) : (
            <>
              Begin migration
              <Icon name="chevron-right" size={14} className="ml-1.5" />
            </>
          )}
        </BBButton>
      </div>

      <p className="text-xs text-ink-4 mt-4 leading-relaxed">
        Aborting reverts the pool to active immediately.
        Files written to {targetPoolName} during quiescing stay there — they are not reversed automatically.
      </p>
    </div>
  )
}
