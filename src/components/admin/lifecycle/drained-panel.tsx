/**
 * Drained panel — Phase 4 of the pool decommission wizard.
 *
 * Two modes: outcome='in_progress' (freshly drained) or outcome='archived'.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import {
  reverseMigrateRun,
  archiveRun,
  deletePool,
  reactivateRun,
  type LifecycleRun,
  type StoragePool,
} from '../../../lib/api'
import { ConfirmationModal } from './confirmation-modal'

type ModalAction = 'reverse' | 'archive' | 'delete' | 'reactivate' | null

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

  const [openModal, setOpenModal] = useState<ModalAction>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busy = submitting
  const isArchived = run.outcome === 'archived'
  const poolDisplayName = pool.display_name || pool.name

  async function handleReverse() {
    setError(null)
    setSubmitting(true)
    try {
      await reverseMigrateRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reverse-migrate failed.')
    } finally {
      setSubmitting(false)
      setOpenModal(null)
    }
  }

  async function handleArchive() {
    setError(null)
    setSubmitting(true)
    try {
      await archiveRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.')
    } finally {
      setSubmitting(false)
      setOpenModal(null)
    }
  }

  async function handleDeleteConfirmed() {
    setError(null)
    setSubmitting(true)
    try {
      await deletePool(poolId, run.id, pool.name)
      navigate('/admin/infrastructure', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setSubmitting(false)
      setOpenModal(null)
    }
  }

  async function handleReactivate() {
    setError(null)
    setSubmitting(true)
    try {
      await reactivateRun(poolId, run.id)
      onPhaseChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reactivation failed.')
    } finally {
      setSubmitting(false)
      setOpenModal(null)
    }
  }

  return (
    <div>
      {/* Status card */}
      <div className="rounded-lg border border-line bg-paper overflow-hidden mb-5">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <Icon name="check" size={12} className="text-ink-2" />
          <span className="text-[12px] font-semibold text-ink">
            {isArchived ? 'Archived' : 'Drained'}
          </span>
          <span className="ml-auto font-mono text-[10px] text-ink-4">{poolDisplayName}</span>
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
        <BBButton variant="amber" disabled={busy} onClick={() => setOpenModal('reactivate')}>
          Reactivate
        </BBButton>
      ) : (
        <>
          <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">Next steps</p>
          <div className="rounded-lg border border-line bg-paper overflow-hidden mb-4">
            {/* Reverse-migrate */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Reverse-migrate</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Copy files back from {targetPoolName} to this pool.</p>
              </div>
              <BBButton variant="default" size="sm" disabled={busy} onClick={() => setOpenModal('reverse')} className="shrink-0 border border-line">
                Reverse
              </BBButton>
            </div>

            {/* Archive */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Archive</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Keep pool empty, no new writes. Reactivate later.</p>
              </div>
              <BBButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpenModal('archive')} className="shrink-0">
                Archive
              </BBButton>
            </div>

            {/* Delete */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-red">Delete forever</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Permanent — blobs removed, row tombstoned. No recovery.</p>
              </div>
              <BBButton variant="danger" size="sm" disabled={busy} onClick={() => setOpenModal('delete')} className="shrink-0">
                Delete
              </BBButton>
            </div>
          </div>
        </>
      )}

      {/* Reactivate modal */}
      <ConfirmationModal
        open={openModal === 'reactivate'}
        title={`Reactivate ${poolDisplayName}?`}
        description="The pool will return to active and accept new uploads again."
        confirmLabel="Reactivate"
        variant="warning"
        onConfirm={handleReactivate}
        onCancel={() => { setOpenModal(null); setError(null) }}
        loading={submitting}
      />

      {/* Reverse-migrate modal */}
      <ConfirmationModal
        open={openModal === 'reverse'}
        title="Reverse-migrate?"
        description={<p>Files will be copied back from <strong>{targetPoolName}</strong> to {poolDisplayName}. This starts a new migration run in the opposite direction.</p>}
        confirmLabel="Start reverse migration"
        variant="warning"
        onConfirm={handleReverse}
        onCancel={() => { setOpenModal(null); setError(null) }}
        loading={submitting}
      />

      {/* Archive modal */}
      <ConfirmationModal
        open={openModal === 'archive'}
        title="Archive this pool?"
        description="The pool stays empty and accepts no new writes. You can reactivate it later."
        confirmLabel="Archive pool"
        variant="warning"
        onConfirm={handleArchive}
        onCancel={() => { setOpenModal(null); setError(null) }}
        loading={submitting}
      />

      {/* Delete modal — requires typing pool name */}
      <ConfirmationModal
        open={openModal === 'delete'}
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
        onCancel={() => { setOpenModal(null); setError(null) }}
        loading={submitting}
      />
    </div>
  )
}
