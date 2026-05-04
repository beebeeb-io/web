import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../icons'
import { BBButton } from '../bb-button'
import { BBChip } from '../bb-chip'
import { KpiCard } from './kpi-card'
import { useToast } from '../toast'
import {
  getAdminUserDetail,
  getUserLoginIps,
  listStoragePools,
  listAuditLog,
  migrateUser,
  adminPromote,
  adminDemote,
} from '../../lib/api'
import type {
  AdminUserDetail,
  LoginIp,
  StoragePool,
  AuditEvent,
} from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { useImpersonation } from '../../lib/impersonation-context'
import { useAuth } from '../../lib/auth-context'

type TabKey = 'storage' | 'security' | 'billing' | 'activity'

interface UserDetailDrawerProps {
  userId: string
  onClose: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function UserDetailDrawer({ userId, onClose }: UserDetailDrawerProps) {
  const { showToast } = useToast()
  const { startImpersonation } = useImpersonation()
  const { user: currentUser } = useAuth()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [pools, setPools] = useState<StoragePool[]>([])
  const [loginIps, setLoginIps] = useState<LoginIp[]>([])
  const [activity, setActivity] = useState<AuditEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('storage')
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [impersonating, setImpersonating] = useState(false)
  const [roleChanging, setRoleChanging] = useState(false)

  // True if this drawer is open for the currently-logged-in admin's own user
  // record. Used to hide self-targeting role-change actions (server also
  // rejects with 400 — this is just defense-in-depth so the dead button isn't
  // shown).
  const isSelf = !!currentUser && currentUser.user_id === userId

  // Reload user detail without re-fetching pools/loginIps. Used after a
  // successful role change so the role chip + button label reflect the
  // updated state without flickering the rest of the drawer.
  const reloadDetail = useCallback(async () => {
    try {
      const d = await getAdminUserDetail(userId)
      setDetail(d)
    } catch {
      // Non-fatal — the action succeeded server-side; the chip just won't
      // update until the user reopens the drawer.
    }
  }, [userId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getAdminUserDetail(userId),
      listStoragePools(),
      getUserLoginIps(userId),
    ])
      .then(([d, p, ips]) => {
        if (cancelled) return
        setDetail(d)
        setPools(p)
        setLoginIps(ips.ips)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load user')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Lazy-load activity tab
  useEffect(() => {
    if (tab !== 'activity' || activity !== null) return
    let cancelled = false
    listAuditLog({ actor: userId, limit: 20 })
      .then(r => {
        if (!cancelled) setActivity(r.events)
      })
      .catch(() => {
        if (!cancelled) setActivity([])
      })
    return () => {
      cancelled = true
    }
  }, [tab, activity, userId])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleImpersonate = useCallback(async () => {
    if (!detail) return
    if (isSelf) return // server rejects, but don't even attempt
    if (!confirm(`Impersonate ${detail.email}? You will be viewing the app as this user.`)) return
    setImpersonating(true)
    try {
      // startImpersonation swaps the auth token, stashes the admin token in
      // sessionStorage, and force-reloads to '/'. So the success path here
      // never returns — control transfers to a fresh page load as the target
      // user. We only fall through to the catch when the API call itself
      // fails (e.g. server 400, network error).
      await startImpersonation(userId)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Impersonation failed',
        description: err instanceof Error ? err.message : 'Could not impersonate',
        danger: true,
      })
      setImpersonating(false)
    }
  }, [detail, userId, isSelf, startImpersonation, showToast])

  const handlePromote = useCallback(async () => {
    if (!detail) return
    if (isSelf) return
    if (!confirm(
      `Promote ${detail.email} to admin? They will gain access to /admin/* and ` +
      `can perform admin actions on this workspace.`,
    )) return
    setRoleChanging(true)
    try {
      await adminPromote(userId)
      showToast({
        icon: 'shield',
        title: 'Promoted to admin',
        description: detail.email,
      })
      await reloadDetail()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Promote failed',
        description: err instanceof Error ? err.message : 'Could not promote user',
        danger: true,
      })
    } finally {
      setRoleChanging(false)
    }
  }, [detail, userId, isSelf, reloadDetail, showToast])

  const handleDemote = useCallback(async () => {
    if (!detail) return
    if (isSelf) return
    if (!confirm(
      `Demote ${detail.email} from admin to regular user? They will lose ` +
      `access to /admin/* immediately.`,
    )) return
    setRoleChanging(true)
    try {
      await adminDemote(userId)
      showToast({
        icon: 'shield',
        title: 'Demoted to user',
        description: detail.email,
      })
      await reloadDetail()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Demote failed',
        description: err instanceof Error ? err.message : 'Could not demote user',
        danger: true,
      })
    } finally {
      setRoleChanging(false)
    }
  }, [detail, userId, isSelf, reloadDetail, showToast])

  const handleMigrate = useCallback(
    async (toPoolId: string) => {
      setMigrating(true)
      try {
        const res = await migrateUser(userId, toPoolId)
        showToast({
          icon: 'cloud',
          title: 'Migration started',
          description: `${res.migration_count} files queued`,
        })
        setMigrateOpen(false)
      } catch (err) {
        showToast({
          icon: 'x',
          title: 'Migration failed',
          description: err instanceof Error ? err.message : 'Could not migrate',
          danger: true,
        })
      } finally {
        setMigrating(false)
      }
    },
    [userId, showToast],
  )

  const initial = detail?.email.charAt(0).toUpperCase() ?? '?'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink/20 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-50 w-[480px] bg-paper border-l border-line shadow-3 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-heading"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink transition-colors z-10"
          aria-label="Close drawer"
        >
          <Icon name="x" size={13} />
        </button>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error || !detail ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="text-center">
              <div className="text-xs text-red mb-3">{error ?? 'User not found'}</div>
              <BBButton size="sm" variant="ghost" onClick={onClose}>Close</BBButton>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-line">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-bg border border-amber/30 flex items-center justify-center text-amber-deep text-lg font-semibold shrink-0">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="user-detail-heading"
                    className="font-mono text-sm text-ink truncate"
                  >
                    {detail.email}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <BBChip variant={detail.plan !== 'free' ? 'amber' : 'default'}>
                      {planLabel(detail.plan)}
                    </BBChip>
                    <BBChip variant={detail.email_verified ? 'green' : 'default'}>
                      {detail.email_verified ? 'Verified' : 'Pending'}
                    </BBChip>
                    {detail.role !== 'user' && (
                      <BBChip
                        variant={detail.role === 'superadmin' ? 'amber' : 'default'}
                      >
                        {detail.role === 'superadmin' ? 'Superadmin' : 'Admin'}
                      </BBChip>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] text-ink-3 font-mono">
                    Joined {formatDate(detail.created_at)}
                    <span className="mx-1.5 text-ink-4">·</span>
                    {detail.last_login
                      ? `Last login ${formatDateTime(detail.last_login)}`
                      : 'Never logged in'}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-4">
                <BBButton
                  size="sm"
                  variant="amber"
                  onClick={handleImpersonate}
                  disabled={impersonating || isSelf}
                  title={isSelf ? 'Cannot impersonate yourself' : undefined}
                >
                  <Icon name="eye" size={11} className="mr-1.5" />
                  {impersonating ? 'Loading…' : 'Impersonate'}
                </BBButton>

                {/* Role-change button: shape depends on the target's current role.
                    Superadmin is intentionally not changeable from this surface
                    (server also rejects). Hidden when looking at our own row. */}
                {!isSelf && detail.role === 'user' && (
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={handlePromote}
                    disabled={roleChanging}
                  >
                    <Icon name="shield" size={11} className="mr-1.5" />
                    {roleChanging ? 'Promoting…' : 'Promote to admin'}
                  </BBButton>
                )}
                {!isSelf && detail.role === 'admin' && (
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={handleDemote}
                    disabled={roleChanging}
                  >
                    <Icon name="shield" size={11} className="mr-1.5" />
                    {roleChanging ? 'Demoting…' : 'Demote to user'}
                  </BBButton>
                )}
                {!isSelf && detail.role === 'superadmin' && (
                  <BBButton
                    size="sm"
                    variant="ghost"
                    disabled
                    title="Superadmin role cannot be changed from this surface"
                  >
                    <Icon name="shield" size={11} className="mr-1.5" />
                    Superadmin
                  </BBButton>
                )}
              </div>
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-4 gap-2 px-5 py-4 border-b border-line bg-paper-2">
              <KpiCard label="Files" value={detail.file_count} format="number" />
              <KpiCard
                label="Storage"
                value={detail.storage_bytes}
                format="bytes"
                sub={detail.plan !== 'free' ? `${planLabel(detail.plan)} plan` : 'Free plan'}
              />
              <KpiCard label="Shares" value={detail.share_count} format="number" />
              <KpiCard label="Sessions" value={detail.session_count} format="number" />
            </div>

            {/* Tab bar */}
            <div className="flex gap-0 border-b border-line px-5">
              {(
                [
                  ['storage', 'Storage'],
                  ['security', 'Security'],
                  ['billing', 'Billing'],
                  ['activity', 'Activity'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-2.5 text-[12px] border-b-2 transition-colors ${
                    tab === key
                      ? 'border-amber font-semibold text-ink'
                      : 'border-transparent text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {tab === 'storage' && (
                <StorageTab
                  detail={detail}
                  pools={pools}
                  migrateOpen={migrateOpen}
                  setMigrateOpen={setMigrateOpen}
                  migrating={migrating}
                  onMigrate={handleMigrate}
                />
              )}
              {tab === 'security' && (
                <SecurityTab detail={detail} loginIps={loginIps} />
              )}
              {tab === 'billing' && <BillingTab detail={detail} />}
              {tab === 'activity' && <ActivityTab events={activity} />}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

// ─── Storage tab ──────────────────────────────────────

function StorageTab({
  detail,
  pools,
  migrateOpen,
  setMigrateOpen,
  migrating,
  onMigrate,
}: {
  detail: AdminUserDetail
  pools: StoragePool[]
  migrateOpen: boolean
  setMigrateOpen: (open: boolean) => void
  migrating: boolean
  onMigrate: (poolId: string) => void
}) {
  const totalBytes = detail.storage_bytes
  const activePools = pools.filter(p => p.is_active)

  return (
    <div className="px-5 py-4 space-y-4">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-2">
          Per-pool usage
        </div>
        {activePools.length === 0 ? (
          <div className="text-xs text-ink-3 italic">No active pools</div>
        ) : (
          <div className="space-y-2.5">
            {activePools.map(pool => {
              // Without a per-user-per-pool breakdown endpoint, attribute the
              // user's total to the default pool. Future: dedicated endpoint.
              const usedByUser = pool.is_default ? totalBytes : 0
              const filesByUser = pool.is_default ? detail.file_count : 0
              const cap = pool.capacity_bytes ?? 0
              const pct = cap > 0 ? Math.min(100, (usedByUser / cap) * 100) : 0
              return (
                <div
                  key={pool.id}
                  className="rounded-md border border-line bg-paper-2 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink truncate">
                        {pool.display_name}
                      </div>
                      <div className="text-[10px] text-ink-3 font-mono truncate">
                        {pool.region} · {pool.provider}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono text-ink">
                        {formatBytes(usedByUser)}
                      </div>
                      <div className="text-[10px] text-ink-3 font-mono">
                        {filesByUser.toLocaleString()} files
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-paper overflow-hidden border border-line">
                    <div
                      className="h-full bg-amber"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Migrate */}
      <div>
        {migrateOpen ? (
          <div className="rounded-md border border-line bg-paper-2 px-3 py-3">
            <div className="text-[11px] text-ink-2 mb-2">
              Migrate all files to:
            </div>
            <div className="space-y-1.5">
              {activePools.map(pool => (
                <button
                  key={pool.id}
                  onClick={() => onMigrate(pool.id)}
                  disabled={migrating}
                  className="w-full text-left px-2.5 py-2 rounded-sm text-xs bg-paper border border-line hover:bg-amber-bg hover:border-amber/30 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-ink">{pool.display_name}</div>
                  <div className="text-[10px] text-ink-3 font-mono">
                    {pool.region} · {pool.provider}
                  </div>
                </button>
              ))}
            </div>
            <BBButton
              size="sm"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => setMigrateOpen(false)}
              disabled={migrating}
            >
              Cancel
            </BBButton>
          </div>
        ) : (
          <BBButton
            size="sm"
            variant="default"
            className="w-full"
            onClick={() => setMigrateOpen(true)}
          >
            <Icon name="cloud" size={11} className="mr-1.5" />
            Migrate all files to pool…
          </BBButton>
        )}
      </div>
    </div>
  )
}

// ─── Security tab ─────────────────────────────────────

function SecurityTab({
  detail,
  loginIps,
}: {
  detail: AdminUserDetail
  loginIps: LoginIp[]
}) {
  return (
    <div className="px-5 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
            Sessions
          </div>
          <div className="text-sm font-mono font-semibold text-ink">
            {detail.session_count}
          </div>
          <div className="text-[10px] text-ink-3 mt-0.5">
            {detail.last_login
              ? `Last ${formatDateTime(detail.last_login)}`
              : 'Never'}
          </div>
        </div>
        <div className="rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
            TOTP
          </div>
          <div className="text-sm font-semibold text-ink-3">
            Unknown
          </div>
          <div className="text-[10px] text-ink-3 mt-0.5">
            Not yet exposed by API
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-2">
          Login IPs
        </div>
        {loginIps.length === 0 ? (
          <div className="text-xs text-ink-3 italic">No login history</div>
        ) : (
          <div className="rounded-md border border-line overflow-hidden">
            <div
              className="grid px-3 py-1.5 bg-paper-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
              style={{ gridTemplateColumns: '1fr 110px 110px' }}
            >
              <span>IP</span>
              <span>First seen</span>
              <span>Last seen</span>
            </div>
            {loginIps.map(ip => (
              <div
                key={ip.ip}
                className="grid px-3 py-2 text-[11px] font-mono border-b border-line last:border-b-0 items-center"
                style={{ gridTemplateColumns: '1fr 110px 110px' }}
              >
                <span className="text-ink truncate">{ip.ip}</span>
                <span className="text-ink-3">{formatDate(ip.first_seen)}</span>
                <span className="text-ink-3">{formatDate(ip.last_seen)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Billing tab ──────────────────────────────────────

function BillingTab({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="px-5 py-4">
      <dl className="rounded-md border border-line divide-y divide-line bg-paper-2">
        <Row label="Plan" value={planLabel(detail.plan)} />
        <Row
          label="Billing cycle"
          value={detail.billing_cycle ?? '—'}
        />
        <Row
          label="Subscription"
          value={detail.subscription_status ?? 'No subscription'}
        />
        <Row
          label="Period ends"
          value={detail.current_period_end ? formatDate(detail.current_period_end) : '—'}
        />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <dt className="text-[11px] text-ink-3 font-mono uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-xs text-ink font-mono">{value}</dd>
    </div>
  )
}

// ─── Activity tab ─────────────────────────────────────

function ActivityTab({ events }: { events: AuditEvent[] | null }) {
  if (events === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg className="animate-spin h-4 w-4 text-amber" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-ink-3">
        No recent activity
      </div>
    )
  }

  return (
    <div className="rounded-none">
      <div
        className="grid px-5 py-1.5 bg-paper-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line sticky top-0"
        style={{ gridTemplateColumns: '120px 140px 1fr' }}
      >
        <span>Time</span>
        <span>Event</span>
        <span>Target</span>
      </div>
      {events.map(e => (
        <div
          key={e.id}
          className="grid px-5 py-2 text-[11px] font-mono border-b border-line items-center"
          style={{ gridTemplateColumns: '120px 140px 1fr' }}
        >
          <span className="text-ink-3">{formatDateTime(e.created_at)}</span>
          <span className="text-ink truncate">{e.event}</span>
          <span className="text-ink-3 truncate">{e.target ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}
