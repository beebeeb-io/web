import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import { listStoragePools, listMigrations, updateStoragePool, getPoolUsage } from '../../lib/api'
import type { StoragePool, MigrationSummary, MigrationEntry, PoolUsageEntry } from '../../lib/api'
import { formatBytes } from '../../lib/format'


function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusColor(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'done': return { fg: 'oklch(0.45 0.12 155)', bg: 'oklch(0.94 0.06 155)' }
    case 'pending': return { fg: 'var(--color-amber-deep)', bg: 'var(--color-amber-bg)' }
    case 'copying':
    case 'verifying': return { fg: 'oklch(0.5 0.15 250)', bg: 'oklch(0.94 0.06 250)' }
    case 'failed': return { fg: 'var(--color-red)', bg: 'oklch(0.97 0.03 25)' }
    default: return { fg: 'var(--color-ink-3)', bg: 'var(--color-paper-2)' }
  }
}

function UsageBar({ used, capacity, className }: { used: number; capacity: number | null; className?: string }) {
  if (!capacity || capacity <= 0) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <div className="flex-1 h-2 rounded-full bg-paper-3">
          <div className="h-full rounded-full bg-amber" style={{ width: '0%' }} />
        </div>
        <span className="font-mono text-[10px] text-ink-3">No limit</span>
      </div>
    )
  }
  const pct = Math.min((used / capacity) * 100, 100)
  const color = pct > 90 ? 'var(--color-red)' : pct > 70 ? 'var(--color-amber-deep)' : 'oklch(0.55 0.12 155)'
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div className="flex-1 h-2 rounded-full bg-paper-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[10px] text-ink-3 w-[40px] text-right">{pct.toFixed(1)}%</span>
    </div>
  )
}

function PoolUsageDetail({ poolId }: { poolId: string }) {
  const [entries, setEntries] = useState<PoolUsageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getPoolUsage(poolId)
      .then(data => setEntries(data.entries))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load usage'))
      .finally(() => setLoading(false))
  }, [poolId])

  if (loading) {
    return <div className="text-[10px] text-ink-3 py-2">Loading usage...</div>
  }
  if (error) {
    return <div className="text-[10px] text-red py-2">{error}</div>
  }
  if (entries.length === 0) {
    return <div className="text-[10px] text-ink-3 py-2">No users in this pool</div>
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="text-[10px] font-medium text-ink-3 uppercase tracking-wide mb-2">Per-user breakdown</div>
      <div className="flex flex-col gap-1.5">
        {entries.map(e => (
          <div key={e.user_id} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-ink-2 truncate flex-1 min-w-0">{e.email}</span>
            <span className="font-mono text-ink-3 shrink-0">{e.file_count} files</span>
            <span className="font-mono text-ink shrink-0 w-[72px] text-right">{formatBytes(e.used_bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StoragePools() {
  const { showToast } = useToast()
  const [pools, setPools] = useState<StoragePool[]>([])
  const [migrationSummary, setMigrationSummary] = useState<MigrationSummary | null>(null)
  const [recentMigrations, setRecentMigrations] = useState<MigrationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingPool, setUpdatingPool] = useState<string | null>(null)
  const [expandedPool, setExpandedPool] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [poolsData, migrationsData] = await Promise.all([
        listStoragePools(),
        listMigrations().catch(() => null),
      ])
      setPools(poolsData)
      if (migrationsData) {
        setMigrationSummary(migrationsData.summary)
        setRecentMigrations(migrationsData.recent)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage pools')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleToggleActive(pool: StoragePool) {
    setUpdatingPool(pool.id)
    try {
      const updated = await updateStoragePool(pool.id, { is_active: !pool.is_active })
      setPools(prev => prev.map(p => p.id === pool.id ? updated : p))
      showToast({
        icon: 'check',
        title: `Pool ${updated.is_active ? 'activated' : 'deactivated'}`,
        description: pool.display_name,
      })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Could not update pool',
        danger: true,
      })
    } finally {
      setUpdatingPool(null)
    }
  }

  async function handleSetDefault(pool: StoragePool) {
    if (pool.is_default) return
    setUpdatingPool(pool.id)
    try {
      const updated = await updateStoragePool(pool.id, { is_default: true })
      // Clear is_default on all other pools, set on this one
      setPools(prev => prev.map(p => {
        if (p.id === pool.id) return updated
        if (p.is_default) return { ...p, is_default: false }
        return p
      }))
      showToast({
        icon: 'check',
        title: 'Default pool changed',
        description: `${pool.display_name} is now the default pool`,
      })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Could not set default pool',
        danger: true,
      })
    } finally {
      setUpdatingPool(null)
    }
  }

  const totalUsed = pools.reduce((sum, p) => sum + p.used_bytes, 0)
  const totalCapacity = pools.reduce((sum, p) => sum + (p.capacity_bytes ?? 0), 0)

  return (
    <AdminShell activeSection="storage-pools">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="cloud" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Storage pools</h2>
        <BBChip>{pools.length} {pools.length === 1 ? 'pool' : 'pools'}</BBChip>
        {totalUsed > 0 && (
          <span className="ml-auto font-mono text-[11px] text-ink-3">
            {formatBytes(totalUsed)} used
            {totalCapacity > 0 && ` of ${formatBytes(totalCapacity)}`}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={load}>Retry</BBButton>
          </div>
        ) : pools.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-3">No storage pools configured</div>
        ) : (
          <>
            {/* Pool cards */}
            <div className="grid gap-3" style={{ gridTemplateColumns: pools.length > 1 ? '1fr 1fr' : '1fr' }}>
              {pools.map(pool => {
                const isUpdating = updatingPool === pool.id
                const isExpanded = expandedPool === pool.id
                return (
                  <div key={pool.id} className="rounded-xl bg-paper border border-line-2 p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="w-[32px] h-[32px] rounded-lg shrink-0 flex items-center justify-center border"
                        style={{
                          background: pool.is_active ? 'var(--color-amber-bg)' : 'var(--color-paper-2)',
                          borderColor: pool.is_active ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
                        }}
                      >
                        <Icon
                          name="cloud"
                          size={14}
                          style={{ color: pool.is_active ? 'var(--color-amber-deep)' : 'var(--color-ink-4)' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold">{pool.display_name}</span>
                          {pool.is_default && <BBChip variant="amber" className="text-[9px]">Default</BBChip>}
                          <BBChip variant={pool.is_active ? 'green' : 'default'} className="text-[9px]">
                            {pool.is_active ? 'Active' : 'Inactive'}
                          </BBChip>
                        </div>
                        <div className="font-mono text-[10px] text-ink-3 mt-0.5">{pool.name}</div>
                      </div>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div>
                        <div className="text-[10px] text-ink-4">Provider</div>
                        <div className="font-mono text-[11px] font-medium">{pool.provider}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-ink-4">Region</div>
                        <div className="font-mono text-[11px] font-medium">{pool.region}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-ink-4">Bucket</div>
                        <div className="font-mono text-[11px] font-medium truncate">{pool.bucket}</div>
                      </div>
                    </div>

                    {/* Usage */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-ink-4">Usage</span>
                        <span className="font-mono text-[10px] text-ink-2">
                          {formatBytes(pool.used_bytes)}
                          {pool.capacity_bytes ? ` / ${formatBytes(pool.capacity_bytes)}` : ''}
                        </span>
                      </div>
                      <UsageBar used={pool.used_bytes} capacity={pool.capacity_bytes} />
                    </div>

                    {/* Endpoint */}
                    <div className="p-2 bg-paper-2 border border-line rounded-md font-mono text-[10px] text-ink-3 break-all mb-3">
                      {pool.endpoint}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1 border-t border-line">
                      <BBButton
                        size="sm"
                        variant={pool.is_active ? 'ghost' : 'default'}
                        disabled={isUpdating}
                        onClick={() => handleToggleActive(pool)}
                      >
                        {isUpdating
                          ? 'Updating...'
                          : pool.is_active
                            ? 'Deactivate'
                            : 'Activate'}
                      </BBButton>
                      {!pool.is_default && (
                        <BBButton
                          size="sm"
                          variant="ghost"
                          disabled={isUpdating}
                          onClick={() => handleSetDefault(pool)}
                        >
                          Set as default
                        </BBButton>
                      )}
                      <BBButton
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setExpandedPool(isExpanded ? null : pool.id)}
                      >
                        {isExpanded ? 'Hide usage' : 'View usage'}
                      </BBButton>
                    </div>

                    {/* Expandable per-user usage */}
                    {isExpanded && <PoolUsageDetail poolId={pool.id} />}
                  </div>
                )
              })}
            </div>

            {/* Migration dashboard */}
            {migrationSummary && (
              <div className="rounded-xl bg-paper border border-line-2 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                  <Icon name="arrow-up" size={13} className="text-ink-2" />
                  <span className="text-[13px] font-semibold">File migrations</span>
                  <BBChip>{migrationSummary.total} total</BBChip>
                  <BBButton size="sm" variant="ghost" className="ml-auto" onClick={load}>
                    Refresh
                  </BBButton>
                </div>

                {/* Summary counters */}
                <div className="grid grid-cols-5 gap-3 p-4 border-b border-line bg-paper-2">
                  {(['pending', 'copying', 'verifying', 'done', 'failed'] as const).map(status => {
                    const count = migrationSummary[status]
                    const colors = statusColor(status)
                    return (
                      <div key={status} className="text-center">
                        <div
                          className="font-mono text-lg font-bold"
                          style={{ color: count > 0 ? colors.fg : 'var(--color-ink-4)' }}
                        >
                          {count}
                        </div>
                        <div className="text-[10px] text-ink-3 capitalize">{status}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Recent migrations */}
                {recentMigrations.length > 0 && (
                  <>
                    <div
                      className="grid px-4 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
                      style={{ gridTemplateColumns: '140px 1fr 1fr 80px 140px' }}
                    >
                      <span>File</span>
                      <span>From</span>
                      <span>To</span>
                      <span>Status</span>
                      <span>Created</span>
                    </div>
                    {recentMigrations.slice(0, 10).map(m => {
                      const colors = statusColor(m.status)
                      return (
                        <div
                          key={m.id}
                          className="grid px-4 py-2.5 text-xs border-b border-line items-center last:border-b-0"
                          style={{ gridTemplateColumns: '140px 1fr 1fr 80px 140px' }}
                        >
                          <span className="font-mono text-[10px] text-ink-2 truncate">{m.file_id.slice(0, 8)}...</span>
                          <span className="font-mono text-[11px]">{m.from_pool ?? '-'}</span>
                          <span className="font-mono text-[11px]">{m.to_pool ?? '-'}</span>
                          <span>
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style={{ background: colors.bg, color: colors.fg }}
                            >
                              {m.status}
                            </span>
                          </span>
                          <span className="font-mono text-[10px] text-ink-3">{formatDate(m.created_at)}</span>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="lock" size={11} className="text-ink-3" />
        <span>All data is encrypted at rest. Server never sees plaintext.</span>
        <span className="ml-auto font-mono text-[10px]">S3-compatible backends</span>
      </div>
    </AdminShell>
  )
}
