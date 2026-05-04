/**
 * Drained panel — Phase 4 of the pool decommission wizard.
 *
 * Renders when lifecycle_phase === 'drained'.
 *
 * Two modes:
 *  - outcome === 'in_progress': freshly drained — offer reverse-migrate,
 *    archive, or delete-forever.
 *  - outcome === 'archived': parked empty pool — single "Reactivate" CTA.
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

  // ── Reverse-migrate ───────────────────────────────────────────────────────
  async function handleReverse() {
    const ok = window.confirm(
      `Reverse-migrate to ${pool.display_name || pool.name}?\n\n` +
        `Files will be copied back from ${targetPoolName} to this pool. ` +
        `This starts a new migration run in the opposite direction.`,
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

  // ── Archive ───────────────────────────────────────────────────────────────
  async function handleArchive() {
    const ok = window.confirm(
      `Archive this pool?\n\n` +
        `The pool stays empty and accepts no new writes. ` +
        `You can reactivate it later.`,
    )
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

  // ── Delete ────────────────────────────────────────────────────────────────
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

  // ── Reactivate (archived only) ────────────────────────────────────────────
  async function handleReactivate() {
    const ok = window.confirm(
      `Reactivate ${pool.display_name || pool.name}?\n\n` +
        `The pool will return to active and accept new uploads.`,
    )
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

  const isArchived = run.outcome === 'archived'

  return (
    <div className="max-w-xl">
      {/* Heading */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-base font-semibold text-ink">
          {isArchived ? 'Archived' : 'Drained'}
        </h3>
        {!isArchived && (
          <>
            <Icon name="chevron-right" size={14} className="text-ink-3" />
            <span className="text-base font-semibold text-ink-3">empty</span>
          </>
        )}
      </div>

      <p className="text-sm text-ink-3 mb-5">
        {isArchived
          ? `This pool is empty and archived — it accepts no new writes.`
          : `All files have been migrated to ${targetPoolName}. This pool is empty.`}
      </p>

      {/* Summary card */}
      <div className="bg-paper-2 border border-line rounded-lg px-4 py-3 mb-5 flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-amber-bg)' }}
        >
          <Icon name="check" size={14} className="text-amber-deep" />
        </div>
        <p className="text-sm text-ink-2">
          {isArchived
            ? 'Pool is empty and retained for audit purposes.'
            : `Migration to ${targetPoolName} complete. 0 files remaining.`}
        </p>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTAs */}
      {isArchived ? (
        <BBButton
          variant="amber"
          disabled={busy}
          onClick={handleReactivate}
        >
          {submitting === 'reactivate' ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
              Reactivating…
            </>
          ) : (
            'Reactivate'
          )}
        </BBButton>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {/* Reverse-migrate — secondary */}
          <BBButton
            variant="default"
            disabled={busy}
            onClick={handleReverse}
            className="border border-line"
          >
            {submitting === 'reverse' ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                Starting…
              </>
            ) : (
              'Reverse-migrate'
            )}
          </BBButton>

          {/* Archive — secondary */}
          <BBButton
            variant="ghost"
            disabled={busy}
            onClick={handleArchive}
          >
            {submitting === 'archive' ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                Archiving…
              </>
            ) : (
              'Archive (keep empty)'
            )}
          </BBButton>

          {/* Delete forever — danger */}
          <BBButton
            variant="danger"
            disabled={busy}
            onClick={() => setDeleteModalOpen(true)}
          >
            Delete forever
          </BBButton>
        </div>
      )}

      <p className="text-xs text-ink-4 mt-4 leading-relaxed">
        {isArchived
          ? 'Reactivating restores the pool to the write rotation.'
          : `Reverse-migrate copies files back from ${targetPoolName}. Archive keeps the empty pool for audit trails. Delete is permanent — the pool row is tombstoned and blobs are removed.`}
      </p>

      {/* Delete confirmation modal */}
      <ConfirmationModal
        open={deleteModalOpen}
        title={`Delete pool "${pool.name}" forever?`}
        description={
          <>
            <p>
              This pool is empty. Deleting it is permanent — the row is
              tombstoned and all associated blob storage is removed.
            </p>
            <p className="mt-2">
              There is no recovery path after deletion.
            </p>
          </>
        }
        confirmationText={pool.name}
        confirmLabel="Delete pool forever"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => {
          setDeleteModalOpen(false)
          setSubmitting(null)
          setError(null)
        }}
        loading={submitting === 'delete'}
      />
    </div>
  )
}
