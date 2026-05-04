/**
 * Pool decommission wizard page.
 *
 * Route: /admin/infrastructure/pools/:poolId
 *
 * The wizard is stateless — it reads the pool's current lifecycle phase and
 * renders the matching panel component. Phase is derived from the in-progress
 * lifecycle run (if one exists); pools with no active run are implicitly
 * 'active'. The existing /admin/storage-pools endpoint does not yet include
 * `lifecycle_phase`, so we fetch it from the runs list.
 *
 * Panel components are stubbed for Tasks 3–6.
 */

import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminShell } from './admin-shell'
import { Icon } from '../../components/icons'
import { formatBytes } from '../../lib/format'
import {
  listStoragePools,
  listLifecycleRuns,
  type StoragePool,
  type LifecyclePhase,
  type LifecycleRun,
} from '../../lib/api'

// ─── Phase badge ─────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<LifecyclePhase, string> = {
  active: 'Active',
  quiescing: 'Quiescing',
  migrating: 'Migrating',
  drained: 'Drained',
  deleted: 'Deleted',
}

const PHASE_COLORS: Record<
  LifecyclePhase,
  { bg: string; fg: string; border: string }
> = {
  active: {
    bg: 'oklch(0.94 0.06 155)',
    fg: 'oklch(0.45 0.12 155)',
    border: 'oklch(0.85 0.10 155)',
  },
  quiescing: {
    bg: 'var(--color-amber-bg)',
    fg: 'var(--color-amber-deep)',
    border: 'var(--color-amber)',
  },
  migrating: {
    bg: 'var(--color-amber-bg)',
    fg: 'var(--color-amber-deep)',
    border: 'var(--color-amber)',
  },
  drained: {
    bg: 'oklch(0.94 0.04 20)',
    fg: 'oklch(0.50 0.16 20)',
    border: 'oklch(0.85 0.10 20)',
  },
  deleted: {
    bg: 'var(--color-paper-2)',
    fg: 'var(--color-ink-3)',
    border: 'var(--color-line)',
  },
}

function PhaseBadge({ phase }: { phase: LifecyclePhase }) {
  const c = PHASE_COLORS[phase]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {PHASE_LABEL[phase]}
    </span>
  )
}

// ─── Placeholder panels (replaced by Tasks 3–6) ───────────────────────────

function ActivePanelPlaceholder({ pool }: { pool: StoragePool }) {
  return (
    <div className="p-6 border border-dashed border-line rounded-lg text-center">
      <p className="text-sm font-medium text-ink-2 mb-1">Insights panel</p>
      <p className="text-xs text-ink-4 font-mono">phase: active</p>
      <p className="text-xs text-ink-3 mt-2">{formatBytes(pool.used_bytes)} stored</p>
      <p className="text-xs text-ink-4 mt-1">InsightsPanel component — Task 3</p>
    </div>
  )
}

function QuiescingPanelPlaceholder({ run }: { run: LifecycleRun | null }) {
  return (
    <div className="p-6 border border-dashed border-amber rounded-lg text-center">
      <p className="text-sm font-medium text-ink-2 mb-1">Quiescing panel</p>
      <p className="text-xs text-ink-4 font-mono">phase: quiescing</p>
      {run && (
        <p className="text-xs text-ink-3 mt-2">
          Run: <span className="font-mono">{run.id.slice(0, 8)}</span>
        </p>
      )}
      <p className="text-xs text-ink-4 mt-1">QuiescingPanel component — Task 4</p>
    </div>
  )
}

function MigratingPanelPlaceholder({ run }: { run: LifecycleRun | null }) {
  return (
    <div className="p-6 border border-dashed border-amber rounded-lg text-center">
      <p className="text-sm font-medium text-ink-2 mb-1">Migrating panel</p>
      <p className="text-xs text-ink-4 font-mono">phase: migrating</p>
      {run && (
        <p className="text-xs text-ink-3 mt-2">
          Run: <span className="font-mono">{run.id.slice(0, 8)}</span>
        </p>
      )}
      <p className="text-xs text-ink-4 mt-1">MigratingPanel component — Task 5</p>
    </div>
  )
}

function DrainedPanelPlaceholder({ run }: { run: LifecycleRun | null }) {
  return (
    <div className="p-6 border border-dashed border-red rounded-lg text-center">
      <p className="text-sm font-medium text-ink-2 mb-1">Drained panel</p>
      <p className="text-xs text-ink-4 font-mono">phase: drained</p>
      {run && (
        <p className="text-xs text-ink-3 mt-2">
          Run: <span className="font-mono">{run.id.slice(0, 8)}</span>
        </p>
      )}
      <p className="text-xs text-ink-4 mt-1">DrainedPanel component — Task 6</p>
    </div>
  )
}

// ─── Wizard page ──────────────────────────────────────────────────────────────

export function PoolLifecycle() {
  const { poolId } = useParams<{ poolId: string }>()

  const [pool, setPool] = useState<StoragePool | null>(null)
  const [activeRun, setActiveRun] = useState<LifecycleRun | null>(null)
  // Phase is derived from the in-progress run; defaults to 'active' when none.
  const [phase, setPhase] = useState<LifecyclePhase>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!poolId) return
    setLoading(true)
    setError(null)
    try {
      // 1. Fetch pool details from the existing list endpoint.
      const pools = await listStoragePools()
      const found = pools.find((p) => p.id === poolId) ?? null
      if (!found) {
        setError('Storage pool not found.')
        setLoading(false)
        return
      }
      setPool(found)

      // 2. Fetch the lifecycle run history to determine current phase.
      //    The in-progress run (outcome='in_progress') is the canonical source
      //    of truth for phase because the existing /admin/storage-pools endpoint
      //    doesn't yet return lifecycle_phase. If no in-progress run, the pool
      //    is active.
      const { runs } = await listLifecycleRuns(poolId)
      const inProgress = runs.find((r) => r.outcome === 'in_progress') ?? null
      setActiveRun(inProgress)
      setPhase(inProgress?.current_phase ?? 'active')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pool data.')
    } finally {
      setLoading(false)
    }
  }, [poolId])

  useEffect(() => {
    void load()
  }, [load])

  // Panel rendered inside the wizard content area.
  function renderPanel() {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-sm text-ink-3 py-12 justify-center">
          <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
          Loading pool data…
        </div>
      )
    }
    if (error || !pool) {
      return (
        <div className="py-12 text-center">
          <p className="text-sm text-red">{error ?? 'Pool not found.'}</p>
          <Link
            to="/admin/infrastructure"
            className="text-xs text-ink-3 underline mt-2 inline-block"
          >
            ← Back to Infrastructure
          </Link>
        </div>
      )
    }
    switch (phase) {
      case 'active':
        return <ActivePanelPlaceholder pool={pool} />
      case 'quiescing':
        return <QuiescingPanelPlaceholder run={activeRun} />
      case 'migrating':
        return <MigratingPanelPlaceholder run={activeRun} />
      case 'drained':
      case 'deleted':
        return <DrainedPanelPlaceholder run={activeRun} />
    }
  }

  return (
    <AdminShell activeSection="infrastructure">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Page header */}
        <div className="px-7 pt-5 pb-4 border-b border-line">
          {/* Breadcrumb */}
          <Link
            to="/admin/infrastructure"
            className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2 transition-colors mb-3"
          >
            <Icon name="chevron-right" size={12} className="rotate-180" />
            Infrastructure
          </Link>

          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold text-ink truncate">
                  {pool?.display_name ?? pool?.name ?? 'Pool lifecycle'}
                </h2>
                {!loading && pool && <PhaseBadge phase={phase} />}
              </div>
              {pool && (
                <p className="text-[13px] text-ink-3 mt-0.5 font-mono">
                  {pool.name}
                  {pool.is_default && (
                    <span className="ml-2 text-[11px] text-ink-4">(default)</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Wizard content */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {renderPanel()}
        </div>
      </div>
    </AdminShell>
  )
}
