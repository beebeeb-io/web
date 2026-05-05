import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminShell } from './admin-shell'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { KpiCard } from '../../components/admin/kpi-card'
import { GrowthChart } from '../../components/admin/growth-chart'
import { getAdminStats, getHealth, listAuditLog, getAdminGrowthData, listStoragePools } from '../../lib/api'
import type { AdminStats, HealthResponse, AuditEvent, StoragePool } from '../../lib/api'
import { formatBytes } from '../../lib/format'

const POLL_INTERVAL = 30_000

// Growth-chart tabs. Labels say what is actually plotted — previously the
// "Storage" tab was a count of files-per-day in disguise (server SQL used
// COUNT not SUM). Server now returns bytes-added-per-day for "storage", so
// labels can finally be honest. See task 0021.
const TABS = [
  { key: 'signups', label: 'New users' },
  { key: 'storage', label: 'Storage growth' },
  { key: 'shares', label: 'New shares' },
] as const

const RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: '90', label: '90d' },
] as const

type GrowthMetric = 'signups' | 'storage' | 'shares'

/** Per-metric tooltip phrasing — units + natural language. */
function tooltipFormatterFor(metric: GrowthMetric): (value: number) => string {
  switch (metric) {
    case 'storage':
      return (v) => `${formatBytes(v)} added`
    case 'signups':
      return (v) => `${v.toLocaleString()} new ${v === 1 ? 'user' : 'users'}`
    case 'shares':
      return (v) => `${v.toLocaleString()} ${v === 1 ? 'share' : 'shares'} created`
  }
}

/** Per-metric y-axis tick formatter. */
function axisFormatterFor(metric: GrowthMetric): (value: number) => string {
  return metric === 'storage' ? formatBytes : (v) => v.toLocaleString()
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortenId(id: string | null): string {
  if (!id) return '—'
  if (id.includes('@')) return id
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

export function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [, setHealth] = useState<HealthResponse | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [pools, setPools] = useState<StoragePool[]>([])
  const [growth, setGrowth] = useState<{ label: string; value: number }[]>([])
  const [activeTab, setActiveTab] = useState<GrowthMetric>('signups')
  const [activeRange, setActiveRange] = useState<string>('30')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadGrowth = useCallback(async (metric: GrowthMetric, days: number) => {
    try {
      const res = await getAdminGrowthData(metric, days)
      const points = res.data.map(p => ({
        label: new Date(p.date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
        }),
        value: p.value,
      }))
      setGrowth(points)
    } catch {
      const fallback: { label: string; value: number }[] = []
      const today = new Date()
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        fallback.push({
          label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          value: 0,
        })
      }
      setGrowth(fallback)
    }
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [statsData, healthData, auditData, poolsData] = await Promise.all([
        getAdminStats().catch(() => null),
        getHealth().catch(() => null),
        listAuditLog({ limit: 50 }).catch(() => null),
        listStoragePools().catch(() => []),
      ])
      if (statsData) setStats(statsData)
      if (healthData) setHealth(healthData)
      if (auditData) setEvents(auditData.events)
      if (poolsData.length) setPools(poolsData)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data')
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

  useEffect(() => {
    void loadGrowth(activeTab, Number(activeRange))
  }, [activeTab, activeRange, loadGrowth])

  // Some fields may exist on the server payload but not on the current type — read defensively.
  const statsAny = stats as (AdminStats & {
    users: { active_30d?: number }
    files: { total_bytes?: number }
    storage?: { total_used_bytes?: number; pool_count?: number }
  }) | null

  const totalUsers = statsAny?.users.total ?? 0
  const mau = statsAny?.users.active_30d ?? statsAny?.users.active_7d ?? 0
  const mauLabel = statsAny?.users.active_30d != null ? 'MAU (30d)' : 'Active (7d)'
  const storageBytes =
    statsAny?.storage?.total_used_bytes ??
    statsAny?.files.total_bytes ??
    statsAny?.files.storage_used_bytes ??
    0
  const activeShares = statsAny?.shares.active_links ?? 0
  const signupsToday = statsAny?.users.signups_today ?? 0

  // Pool capacity — sum active pool capacities for a cluster-wide view
  const totalCapacityBytes = pools.reduce((s, p) => s + (p.capacity_bytes ?? 0), 0)
  const poolCapacityPct = totalCapacityBytes > 0
    ? Math.round((storageBytes / totalCapacityBytes) * 100)
    : null

  return (
    <AdminShell activeSection="dashboard">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="eye" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Dashboard</h2>
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
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                label="Total users"
                value={totalUsers.toLocaleString()}
                sub={signupsToday > 0 ? `+${signupsToday} today` : undefined}
              />
              <KpiCard
                label={mauLabel}
                value={mau.toLocaleString()}
              />
              <KpiCard
                label="Storage used"
                value={storageBytes}
                format="bytes"
                sub={poolCapacityPct !== null ? `${poolCapacityPct}% of cluster` : undefined}
              />
              <KpiCard
                label="Cluster capacity"
                value={totalCapacityBytes > 0 ? totalCapacityBytes : '—'}
                format={totalCapacityBytes > 0 ? 'bytes' : undefined}
                sub={pools.length > 0 ? `${pools.filter(p => p.is_active).length} active pool${pools.filter(p => p.is_active).length !== 1 ? 's' : ''}` : 'No pools'}
              />
              <KpiCard
                label="MRR"
                value="—"
                sub="Stripe not connected"
              />
              <KpiCard
                label="Active shares"
                value={activeShares.toLocaleString()}
              />
            </div>

            {/* Growth chart */}
            <GrowthChart
              data={growth}
              tabs={TABS as unknown as { key: string; label: string }[]}
              activeTab={activeTab}
              onTabChange={(k) => setActiveTab(k as GrowthMetric)}
              ranges={RANGES as unknown as { key: string; label: string }[]}
              activeRange={activeRange}
              onRangeChange={setActiveRange}
              formatTooltip={tooltipFormatterFor(activeTab)}
              formatAxis={axisFormatterFor(activeTab)}
            />

            {/* Recent activity */}
            <div className="rounded-lg border border-line bg-paper overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
                <Icon name="clock" size={12} className="text-ink-2" />
                <span className="text-[12px] font-semibold text-ink">Recent activity</span>
                <span className="ml-auto font-mono text-[10px] text-ink-3">
                  {events.length} events
                </span>
              </div>
              {events.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-ink-3">
                  No recent activity
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-ink-4 border-b border-line">
                        <th className="px-4 py-2 font-medium">Time</th>
                        <th className="px-4 py-2 font-medium">Event</th>
                        <th className="px-4 py-2 font-medium">Actor</th>
                        <th className="px-4 py-2 font-medium">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {events.map(ev => (
                        <tr key={ev.id} className="hover:bg-paper-2/60">
                          <td className="px-4 py-1.5 font-mono text-[11px] text-ink-3 whitespace-nowrap">
                            {formatTime(ev.created_at)}
                          </td>
                          <td className="px-4 py-1.5 text-ink-2 whitespace-nowrap">
                            {ev.event}
                          </td>
                          <td className="px-4 py-1.5 font-mono text-[11px] text-ink-2 whitespace-nowrap">
                            {shortenId(ev.actor)}
                          </td>
                          <td className="px-4 py-1.5 font-mono text-[11px] text-ink-3 truncate max-w-[280px]">
                            {shortenId(ev.target)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="clock" size={11} className="text-ink-3" />
        <span>Auto-refresh every 30 seconds</span>
        <span className="ml-auto font-mono text-[10px]">Stored in Falkenstein. Hetzner.</span>
      </div>
    </AdminShell>
  )
}
