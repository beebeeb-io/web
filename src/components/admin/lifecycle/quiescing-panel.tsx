/**
 * Quiescing panel — Phase 2 of the pool decommission wizard.
 *
 * Pool is read-only; new uploads route to the target. Admin can abort
 * (revert to active) or advance (begin migration).
 */

import { useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { formatBytes } from '../../../lib/format'
import {
  abortLifecycleRun,
  advanceLifecycleRun,
  type LifecycleRun,
  type PoolInsights,
} from '../../../lib/api'
import { ConfirmationModal } from './confirmation-modal'

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
  const [modal, setModal] = useState<'abort' | 'advance' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAbort() {
    setError(null)
    setSubmitting(true)
    try {
      await abortLifecycleRun(poolId, run.id, 'quiescing', false)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abort failed.')
    } finally {
      setSubmitting(false)
      setModal(null)
    }
  }

  async function handleAdvance() {
    setError(null)
    setSubmitting(true)
    try {
      await advanceLifecycleRun(poolId, run.id, 'quiescing')
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to begin migration.')
    } finally {
      setSubmitting(false)
      setModal(null)
    }
  }

  const busy = submitting
  const startedAt = new Date(run.started_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div>
      {/* Status banner */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 rounded-lg mb-5"
        style={{ background: 'var(--color-amber-bg)', border: '1px solid var(--color-amber)' }}
      >
        <Icon name="lock" size={14} className="text-amber-deep shrink-0" />
        <p className="text-sm font-medium" style={{ color: 'var(--color-amber-deep)' }}>
          This pool is read-only. New uploads route to <strong>{targetPoolName}</strong>.
        </p>
      </div>

      {/* 2×2 KPI grid */}
      <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">Current state</p>
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
          <div className="text-sm font-semibold text-ink leading-tight truncate">{targetPoolName}</div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Quiescing since</div>
          <div className="font-mono text-sm font-medium text-ink leading-tight">{startedAt}</div>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTAs */}
      <div className="flex items-center gap-3">
        <BBButton
          variant="ghost"
          disabled={busy}
          onClick={() => setModal('abort')}
          className="text-red border-red hover:bg-red/5"
        >
          Abort decommission
        </BBButton>
        <BBButton variant="amber" size="lg" disabled={busy} onClick={() => setModal('advance')}>
          Begin migration
          <Icon name="chevron-right" size={14} className="ml-1.5" />
        </BBButton>
      </div>

      <p className="text-[11px] text-ink-4 mt-4 leading-relaxed">
        Aborting reverts the pool to active immediately. Files written to {targetPoolName} during quiescing are not reversed automatically.
      </p>

      {/* Abort modal */}
      <ConfirmationModal
        open={modal === 'abort'}
        title="Abort decommission?"
        description={
          <>
            <p>The pool returns to active immediately and accepts new uploads again.</p>
            <p className="mt-2">Files written to <strong>{targetPoolName}</strong> during this quiescing window stay there — they are not reversed automatically.</p>
          </>
        }
        confirmLabel="Abort decommission"
        variant="danger"
        onConfirm={handleAbort}
        onCancel={() => { setModal(null); setError(null) }}
        loading={submitting}
      />

      {/* Advance modal */}
      <ConfirmationModal
        open={modal === 'advance'}
        title="Begin migration?"
        description={
          <>
            <p>
              <span className="font-mono font-semibold">{insights?.files_count.toLocaleString() ?? '?'}</span>{' '}
              files will be copied to <strong>{targetPoolName}</strong> in the background.
            </p>
            <p className="mt-2">You can pause migration at any time from this panel.</p>
          </>
        }
        confirmLabel="Begin migration"
        variant="warning"
        onConfirm={handleAdvance}
        onCancel={() => { setModal(null); setError(null) }}
        loading={submitting}
      />
    </div>
  )
}
