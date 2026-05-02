import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'
import { getAdminStats, getHealth, listStoragePools } from '../../lib/api'
import type { AdminStats, HealthResponse, StoragePool } from '../../lib/api'
import { formatBytes } from '../../lib/format'


function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">{label}</div>
      <div className="font-mono text-lg font-bold text-ink leading-tight">{value}</div>
      {sub && <div className="font-mono text-[10px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  )
}

function PoolBar({
  pool,
}: {
  pool: StoragePool
}) {
  const pct =
    pool.capacity_bytes && pool.capacity_bytes > 0
      ? Math.min((pool.used_bytes / pool.capacity_bytes) * 100, 100)
      : 0
  const color =
    pct > 90
      ? 'var(--color-red)'
      : pct > 70
        ? 'var(--color-amber-deep)'
        : 'oklch(0.55 0.12 155)'

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-medium text-ink truncate">{pool.display_name}</span>
          <span className="font-mono text-[10px] text-ink-3">{pool.region}</span>
          {!pool.is_active && (
            <BBChip className="text-[9px]">Inactive</BBChip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-paper-3">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <span className="font-mono text-[10px] text-ink-3 shrink-0 w-[38px] text-right">
            {pool.capacity_bytes ? `${pct.toFixed(1)}%` : '--'}
          </span>
        </div>
        <div className="font-mono text-[10px] text-ink-3 mt-0.5">
          {formatBytes(pool.used_bytes)}
          {pool.capacity_bytes ? ` / ${formatBytes(pool.capacity_bytes)}` : ''}
        </div>
      </div>
    </div>
  )
}

const POLL_INTERVAL = 30_000

export function Monitoring() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [pools, setPools] = useState<StoragePool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [statsData, healthData, poolsData] = await Promise.all([
        getAdminStats().catch(() => null),
        getHealth().catch(() => null),
        listStoragePools().catch(() => []),
      ])
      if (statsData) setStats(statsData)
      if (healthData) setHealth(healthData)
      setPools(poolsData)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    intervalRef.current = setInterval(() => void load(), POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  const isHealthy = health?.status === 'ok' || health?.status === 'healthy'

  const totalPoolUsed = pools.reduce((sum, p) => sum + p.used_bytes, 0)
  const totalPoolCapacity = pools.reduce((sum, p) => sum + (p.capacity_bytes ?? 0), 0)

  return (
    <AdminShell activeSection="monitoring">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="eye" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Monitoring</h2>
        {lastRefresh && (
          <span className="ml-auto font-mono text-[10px] text-ink-3">
            Last update {lastRefresh.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
        <BBButton
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          className={lastRefresh ? '' : 'ml-auto'}
        >
          Refresh
        </BBButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
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
            <BBButton size="sm" variant="ghost" onClick={() => void load()}>
              Retry
            </BBButton>
          </div>
        ) : (
          <>
            {/* System Health Bar */}
            <div className="rounded-xl border border-line-2 bg-paper-2 px-4 py-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: health
                      ? isHealthy
                        ? 'var(--color-green)'
                        : 'var(--color-red)'
                      : 'var(--color-ink-4)',
                  }}
                />
                <span className="text-[13px] font-medium text-ink">
                  {health
                    ? isHealthy
                      ? 'All systems operational'
                      : 'System degraded'
                    : 'Health unavailable'}
                </span>
              </div>
              {health && (
                <>
                  <div className="h-4 w-px bg-line" />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-4">DB</span>
                    <span className="font-mono text-[11px] text-ink-2">
                      {health.db_latency_ms?.toFixed(1) ?? '--'}ms
                    </span>
                  </div>
                  <div className="h-4 w-px bg-line" />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-4">Uptime</span>
                    <span className="font-mono text-[11px] text-ink-2">
                      {health.uptime_seconds != null ? formatUptime(health.uptime_seconds) : '--'}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-line" />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-4">Version</span>
                    <span className="font-mono text-[11px] text-ink-2">
                      {health.version}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Stats Cards */}
            {stats && (
              <>
                {/* Users row */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                    Users
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard
                      label="Total users"
                      value={stats.users.total.toLocaleString()}
                    />
                    <StatCard
                      label="Active (7d)"
                      value={stats.users.active_7d.toLocaleString()}
                    />
                    <StatCard
                      label="Signups today"
                      value={stats.users.signups_today.toLocaleString()}
                    />
                  </div>
                </div>

                {/* Files row */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                    Files
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard
                      label="Total files"
                      value={stats.files.total.toLocaleString()}
                    />
                    <StatCard
                      label="Storage used"
                      value={formatBytes(stats.files.storage_used_bytes)}
                    />
                    <StatCard
                      label="Uploads today"
                      value={stats.files.uploads_today.toLocaleString()}
                    />
                  </div>
                </div>

                {/* Shares row */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                    Sharing
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard
                      label="Active shares"
                      value={stats.shares.active_links.toLocaleString()}
                    />
                    <StatCard
                      label="Active invites"
                      value={stats.shares.active_invites.toLocaleString()}
                    />
                    <StatCard
                      label="Created today"
                      value={stats.shares.created_today.toLocaleString()}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Storage Pools Summary */}
            {pools.length > 0 && (
              <div className="rounded-xl border border-line-2 bg-paper overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                  <Icon name="cloud" size={13} className="text-ink-2" />
                  <span className="text-[13px] font-semibold">Storage pools</span>
                  <BBChip>{pools.length} {pools.length === 1 ? 'pool' : 'pools'}</BBChip>
                  {totalPoolCapacity > 0 && (
                    <span className="ml-auto font-mono text-[10px] text-ink-3">
                      {formatBytes(totalPoolUsed)} / {formatBytes(totalPoolCapacity)} total
                    </span>
                  )}
                </div>
                <div className="px-4 py-2 divide-y divide-line">
                  {pools.map(pool => (
                    <PoolBar key={pool.id} pool={pool} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="clock" size={11} className="text-ink-3" />
        <span>Auto-refresh every 30 seconds</span>
        <span className="ml-auto font-mono text-[10px]">Stored in Frankfurt. Hetzner.</span>
      </div>
    </AdminShell>
  )
}
