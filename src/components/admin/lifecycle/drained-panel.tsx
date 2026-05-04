/**
 * Drained panel — Phase 4 of the pool decommission wizard.
 *
 * Two modes: outcome='in_progress' (freshly drained) or outcome='archived'.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../../bb-button'
import { Icon } from '../../icons'
import {
  reverseMigrateRun,
  archiveRun,
  deletePool,
  reactivateRun,
  type LifecycleRun,
  type StoragePool,
} from '../../../lib/api'
import { ConfirmationModal } from './confirmation-modal'

interface DrainedPanelProps {
  poolId: string
  pool: StoragePool
  run: LifecycleRun
  targetPoolName: string
  onPhaseChanged: () => void
}

export function DrainedPanel({
  poolId,
  pool,
  run,
  targetPoolName,
  onPhaseChanged,
}: DrainedPanelProps) {
  const navigate = useNavigate()

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState<
    'reverse' | 'archive' | 'delete' | 'reactivate' | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const busy = submitting !== null
  const isArchived = run.outcome === 'archived'

  async function handleReverse() {
    const ok = window.confirm(
      `Reverse-migrate back to ${pool.display_name || pool.name}?\n\nFiles will be copied from ${targetPoolName} back to this pool.`,
    )
    if (!ok) return
    setError(null)
    setSubmitting('reverse')
    try {
      await reverseMigrateRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reverse-migrate failed.')
    } finally {
      setSubmitting(null)
    }
  }

  async function handleArchive() {
    const ok = window.confirm(`Archive this pool?\n\nThe pool stays empty and accepts no new writes. You can reactivate it later.`)
    if (!ok) return
    setError(null)
    setSubmitting('archive')
    try {
      await archiveRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.')
    } finally {
      setSubmitting(null)
    }
  }

  async function handleDeleteConfirmed() {
    setError(null)
    setSubmitting('delete')
    try {
      await deletePool(poolId, run.id, pool.name)
      setDeleteModalOpen(false)
      navigate('/admin/infrastructure', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setSubmitting(null)
    }
  }

  async function handleReactivate() {
    const ok = window.confirm(`Reactivate ${pool.display_name || pool.name}?\n\nThe pool returns to active and accepts new uploads.`)
    if (!ok) return
    setError(null)
    setSubmitting('reactivate')
    try {
      await reactivateRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reactivation failed.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="max-w-2xl">
      {/* Status banner */}
      <div className="rounded-lg border border-line bg-paper overflow-hidden mb-5">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <Icon name="check" size={12} className="text-ink-2" />
          <span className="text-[12px] font-semibold text-ink">
            {isArchived ? 'Archived' : 'Drained'}
          </span>
          <span className="ml-auto font-mono text-[10px] text-ink-4">
            {pool.display_name || pool.name}
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-ink-2">
            {isArchived
              ? 'This pool is empty and archived — it accepts no new writes.'
              : `All files migrated to ${targetPoolName}. This pool is empty.`}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTAs */}
      {isArchived ? (
        <BBButton variant="amber" disabled={busy} onClick={handleReactivate}>
          {submitting === 'reactivate' ? (
            <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Reactivating…</>
          ) : 'Reactivate'}
        </BBButton>
      ) : (
        <>
          <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">
            Next steps
          </p>
          <div className="rounded-lg border border-line bg-paper overflow-hidden mb-4">
            {/* Reverse-migrate row */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Reverse-migrate</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Copy files back from {targetPoolName} to this pool.</p>
              </div>
              <BBButton
                variant="default"
                size="sm"
                disabled={busy}
                onClick={handleReverse}
                className="shrink-0 border border-line"
              >
                {submitting === 'reverse' ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : 'Reverse'}
              </BBButton>
            </div>

            {/* Archive row */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Archive</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Keep pool empty, no new writes. Reactivate later.</p>
              </div>
              <BBButton
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={handleArchive}
                className="shrink-0"
              >
                {submitting === 'archive' ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : 'Archive'}
              </BBButton>
            </div>

            {/* Delete row */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-red">Delete forever</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Permanent — blobs removed, row tombstoned. No recovery.</p>
              </div>
              <BBButton
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => setDeleteModalOpen(true)}
                className="shrink-0"
              >
                Delete
              </BBButton>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      <ConfirmationModal
        open={deleteModalOpen}
        title={`Delete pool "${pool.name}" forever?`}
        description={
          <>
            <p>The pool is empty. Deleting is permanent — the row is tombstoned and blob storage is removed.</p>
            <p className="mt-2">There is no recovery path after deletion.</p>
          </>
        }
        confirmationText={pool.name}
        confirmLabel="Delete pool forever"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => { setDeleteModalOpen(false); setSubmitting(null); setError(null) }}
        loading={submitting === 'delete'}
      />
    </div>
  )
}
