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
 */

import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminShell } from './admin-shell'
import { Icon } from '../../components/icons'
import {
  listStoragePools,
  listLifecycleRuns,
  getPoolInsights,
  type StoragePool,
  type LifecyclePhase,
  type LifecycleRun,
  type PoolInsights,
} from '../../lib/api'
import { InsightsPanel } from '../../components/admin/lifecycle/insights-panel'
import { QuiescingPanel } from '../../components/admin/lifecycle/quiescing-panel'
import { MigratingPanel } from '../../components/admin/lifecycle/migrating-panel'
import { DrainedPanel } from '../../components/admin/lifecycle/drained-panel'
import { PhaseBadge } from '../../components/admin/lifecycle/phase-badge'

// ─── Wizard page ──────────────────────────────────────────────────────────────

export function PoolLifecycle() {
  const { poolId } = useParams<{ poolId: string }>()

  const [pool, setPool] = useState<StoragePool | null>(null)
  const [allPools, setAllPools] = useState<StoragePool[]>([])
  const [activeRun, setActiveRun] = useState<LifecycleRun | null>(null)
  // Phase is derived from the in-progress run; defaults to 'active' when none.
  const [phase, setPhase] = useState<LifecyclePhase>('active')
  // Insights fetched only when phase === 'active'.
  const [insights, setInsights] = useState<PoolInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!poolId) return
    setLoading(true)
    setError(null)
    try {
      // 1. Fetch all pools — need both the current pool's details AND the list
      //    of other active pools for the target dropdown.
      const pools = await listStoragePools()
      const found = pools.find((p) => p.id === poolId) ?? null
      if (!found) {
        setError('Storage pool not found.')
        setLoading(false)
        return
      }
      setPool(found)
      setAllPools(pools)

      // 2. Derive current lifecycle phase from the in-progress run.
      const { runs } = await listLifecycleRuns(poolId)
      const inProgress = runs.find((r) => r.outcome === 'in_progress') ?? null
      setActiveRun(inProgress)
      const currentPhase = inProgress?.current_phase ?? 'active'
      setPhase(currentPhase)

      // 3. Fetch insights for active + quiescing phases — shows what's still
      //    on the source pool, useful as a pre-migration sanity check.
      if (currentPhase === 'active' || currentPhase === 'quiescing') {
        const poolInsights = await getPoolInsights(poolId)
        setInsights(poolInsights)
      }
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
        if (!insights) {
          // Insights still loading (fetched after phase check)
          return (
            <div className="flex items-center gap-2 text-sm text-ink-3 py-12 justify-center">
              <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
              Loading pool insights…
            </div>
          )
        }
        return (
          <InsightsPanel
            poolId={poolId!}
            poolName={pool.name}
            insights={insights}
            otherActivePools={allPools.filter(
              (p) => p.id !== poolId && p.is_active,
            )}
            onRunStarted={load}
          />
        )
      case 'quiescing':
        if (!activeRun) return <p className="text-sm text-ink-3">No active run found.</p>
        return (
          <QuiescingPanel
            poolId={poolId!}
            run={activeRun}
            insights={insights}
            targetPoolName={
              allPools.find((p) => p.id === activeRun.target_pool_id)?.display_name
              ?? allPools.find((p) => p.id === activeRun.target_pool_id)?.name
              ?? activeRun.target_pool_id
            }
            onPhaseChanged={load}
          />
        )
      case 'migrating':
        if (!activeRun) return <p className="text-sm text-ink-3">No active run found.</p>
        return (
          <MigratingPanel
            poolId={poolId!}
            run={activeRun}
            targetPoolName={
              allPools.find((p) => p.id === activeRun.target_pool_id)?.display_name
              ?? allPools.find((p) => p.id === activeRun.target_pool_id)?.name
              ?? activeRun.target_pool_id
            }
            onPhaseChanged={load}
          />
        )
      case 'drained':
      case 'deleted':
        if (!activeRun) return <p className="text-sm text-ink-3">No run record found.</p>
        return (
          <DrainedPanel
            poolId={poolId!}
            pool={pool}
            run={activeRun}
            targetPoolName={
              allPools.find((p) => p.id === activeRun.target_pool_id)?.display_name
              ?? allPools.find((p) => p.id === activeRun.target_pool_id)?.name
              ?? activeRun.target_pool_id
            }
            onPhaseChanged={load}
          />
        )
    }
  }

  // Build the subtitle: breadcrumb + pool mono name
  const subtitle = pool
    ? `${pool.name}${pool.is_default ? ' · default' : ''}`
    : undefined

  return (
    <AdminShell activeSection="infrastructure">
      {/* Header — matches the AdminHeader pattern from infrastructure.tsx */}
      <div className="px-7 pt-5 pb-4 border-b border-line">
        <Link
          to="/admin/infrastructure"
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2 transition-colors mb-3"
        >
          <Icon name="chevron-right" size={12} className="rotate-180" />
          Infrastructure
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-ink">
                {pool?.display_name ?? pool?.name ?? 'Pool lifecycle'}
              </h2>
              {!loading && pool && <PhaseBadge phase={phase} />}
            </div>
            {subtitle && (
              <p className="font-mono text-[12px] text-ink-3 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Wizard content — same flex-1 overflow-y-auto pattern as infrastructure.tsx */}
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {renderPanel()}
      </div>
    </AdminShell>
  )
}
