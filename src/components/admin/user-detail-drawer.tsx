import { useState, useEffect, useCallback } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { KpiCard } from './kpi-card'
import { StorageUsageBar } from '../storage-usage-bar'
import { useToast } from '../toast'
import {
  getAdminUserDetail,
  getAdminUserSessions,
  getUserLoginIps,
  listStoragePools,
  listAuditLog,
  migrateUser,
  adminPromote,
  adminDemote,
  getUserStorage,
  suspendUser,
  unsuspendUser,
  getAdminUserSignIns,
  getAdminUserGdprActivity,
} from '../../lib/api'
import type {
  AdminUserDetail,
  AdminUserSession,
  LoginIp,
  StoragePool,
  AuditEvent,
  UserStorageBreakdown,
  AdminSignIn,
  AdminActivityEvent,
} from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { useImpersonation } from '../../lib/impersonation-context'
import { useAuth } from '../../lib/auth-context'

type TabKey = 'storage' | 'security' | 'billing' | 'activity' | 'sign-ins' | 'gdpr-activity'

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
  const [userStorage, setUserStorage] = useState<UserStorageBreakdown | null>(null)
  const [loginIps, setLoginIps] = useState<LoginIp[]>([])
  const [sessions, setSessions] = useState<AdminUserSession[]>([])
  const [activity, setActivity] = useState<AuditEvent[] | null>(null)
  const [signIns, setSignIns] = useState<{ opted_in: boolean; sign_ins: AdminSignIn[] } | null>(null)
  const [gdprActivity, setGdprActivity] = useState<{ opted_in: boolean; events: AdminActivityEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('storage')
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [impersonating, setImpersonating] = useState(false)
  const [roleChanging, setRoleChanging] = useState(false)
  const [suspending, setSuspending] = useState(false)

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
    // user-storage feeds the migrate-destination dropdown's source-pool
    // exclusion. It's tolerated to fail (e.g. user has 0 files) — we just
    // treat the result as no-source-pools and fall through to the existing
    // "all active pools" behaviour, which won't pick a current source
    // because there is none.
    Promise.all([
      getAdminUserDetail(userId),
      listStoragePools(),
      getUserLoginIps(userId),
      getUserStorage(userId).catch(() => null),
      getAdminUserSessions(userId).catch(() => []),
    ])
      .then(([d, p, ips, us, sess]) => {
        if (cancelled) return
        setDetail(d)
        setPools(p)
        setLoginIps(ips.ips)
        setUserStorage(us)
        setSessions(sess)
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

  // Lazy-load sign-ins tab
  useEffect(() => {
    if (tab !== 'sign-ins' || signIns !== null) return
    let cancelled = false
    getAdminUserSignIns(userId)
      .then(r => { if (!cancelled) setSignIns(r) })
      .catch(() => { if (!cancelled) setSignIns({ opted_in: false, sign_ins: [] }) })
    return () => { cancelled = true }
  }, [tab, signIns, userId])

  // Lazy-load GDPR activity tab
  useEffect(() => {
    if (tab !== 'gdpr-activity' || gdprActivity !== null) return
    let cancelled = false
    getAdminUserGdprActivity(userId)
      .then(r => { if (!cancelled) setGdprActivity(r) })
      .catch(() => { if (!cancelled) setGdprActivity({ opted_in: false, events: [] }) })
    return () => { cancelled = true }
  }, [tab, gdprActivity, userId])

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

  const handleSuspend = useCallback(async () => {
    if (!detail) return
    if (!confirm(`Suspend ${detail.email}? They will not be able to log in until unsuspended.`)) return
    setSuspending(true)
    try {
      await suspendUser(userId)
      showToast({ icon: 'shield', title: 'Account suspended', description: detail.email, danger: true })
      await reloadDetail()
    } catch (err) {
      showToast({ icon: 'x', title: 'Suspend failed', description: err instanceof Error ? err.message : 'Could not suspend', danger: true })
    } finally {
      setSuspending(false)
    }
  }, [detail, userId, reloadDetail, showToast])

  const handleUnsuspend = useCallback(async () => {
    if (!detail) return
    if (!confirm(`Unsuspend ${detail.email}? They will be able to log in again.`)) return
    setSuspending(true)
    try {
      await unsuspendUser(userId)
      showToast({ icon: 'shield', title: 'Account unsuspended', description: detail.email })
      await reloadDetail()
    } catch (err) {
      showToast({ icon: 'x', title: 'Unsuspend failed', description: err instanceof Error ? err.message : 'Could not unsuspend', danger: true })
    } finally {
      setSuspending(false)
    }
  }, [detail, userId, reloadDetail, showToast])

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
                      {detail.email_verified ? '✓ Verified' : 'Unverified'}
                    </BBChip>
                    <BBChip variant={detail.opaque_enrolled ? 'green' : 'default'}>
                      {detail.opaque_enrolled === false ? 'Legacy auth' : detail.opaque_enrolled ? 'OPAQUE' : '—'}
                    </BBChip>
                    {detail.is_suspended && (
                      <BBChip variant="default" className="!text-red !border-red/30 !bg-red/5">
                        Suspended
                      </BBChip>
                    )}
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
              <div className="flex flex-wrap items-center gap-2 mt-4">
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

                {/* Role-change button */}
                {!isSelf && detail.role === 'user' && (
                  <BBButton size="sm" variant="ghost" onClick={handlePromote} disabled={roleChanging}>
                    <Icon name="shield" size={11} className="mr-1.5" />
                    {roleChanging ? 'Promoting…' : 'Promote to admin'}
                  </BBButton>
                )}
                {!isSelf && detail.role === 'admin' && (
                  <BBButton size="sm" variant="ghost" onClick={handleDemote} disabled={roleChanging}>
                    <Icon name="shield" size={11} className="mr-1.5" />
                    {roleChanging ? 'Demoting…' : 'Demote to user'}
                  </BBButton>
                )}
                {!isSelf && detail.role === 'superadmin' && (
                  <BBButton size="sm" variant="ghost" disabled title="Superadmin role cannot be changed from this surface">
                    <Icon name="shield" size={11} className="mr-1.5" />
                    Superadmin
                  </BBButton>
                )}

                {/* Suspend / Unsuspend */}
                {!isSelf && (
                  detail.is_suspended ? (
                    <BBButton size="sm" variant="ghost" onClick={handleUnsuspend} disabled={suspending}>
                      {suspending ? 'Unsuspending…' : 'Unsuspend'}
                    </BBButton>
                  ) : (
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={handleSuspend}
                      disabled={suspending}
                      className="!text-red hover:!bg-red/5"
                    >
                      <Icon name="x" size={11} className="mr-1.5" />
                      {suspending ? 'Suspending…' : 'Suspend'}
                    </BBButton>
                  )
                )}

                {/* View files — future feature, disabled for now */}
                <BBButton size="sm" variant="ghost" disabled title="Coming soon">
                  <Icon name="folder" size={11} className="mr-1.5" />
                  View files
                </BBButton>
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
                  ['activity', 'Audit'],
                  ['sign-ins', 'Sign-ins'],
                  ['gdpr-activity', 'Activity'],
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
                  userStorage={userStorage}
                  migrateOpen={migrateOpen}
                  setMigrateOpen={setMigrateOpen}
                  migrating={migrating}
                  onMigrate={handleMigrate}
                />
              )}
              {tab === 'security' && (
                <SecurityTab detail={detail} loginIps={loginIps} sessions={sessions} />
              )}
              {tab === 'billing' && <BillingTab detail={detail} />}
              {tab === 'activity' && <ActivityTab events={activity} />}
              {tab === 'sign-ins' && <SignInsTab data={signIns} />}
              {tab === 'gdpr-activity' && <GdprActivityTab data={gdprActivity} />}
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
  userStorage,
  migrateOpen,
  setMigrateOpen,
  migrating,
  onMigrate,
}: {
  detail: AdminUserDetail
  pools: StoragePool[]
  userStorage: UserStorageBreakdown | null
  migrateOpen: boolean
  setMigrateOpen: (open: boolean) => void
  migrating: boolean
  onMigrate: (poolId: string) => void
}) {
  const totalBytes = detail.storage_bytes
  const activePools = pools.filter(p => p.is_active)

  // Source-pool exclusion for the migrate-destination dropdown. The server's
  // /admin/user-storage endpoint only returns pools where the user actually
  // has at least one file (HAVING COUNT > 0), so this set is exactly the
  // user's current sources. We exclude all of them so the admin can't pick
  // a no-op destination — and so a user with files spanning multiple pools
  // still sees a coherent dropdown. See task 0019.
  const sourcePoolIds = new Set(userStorage?.pools.map(p => p.pool_id) ?? [])
  const destinationPools = activePools.filter(p => !sourcePoolIds.has(p.id))

  // Plan quota — use plan_limit_bytes when the server provides it, otherwise
  // use a 5 GB free tier baseline. The StorageUsageBar colours by percentage.
  const quotaBytes = detail.plan_limit_bytes ?? (
    detail.plan === 'free' ? 5_368_709_120 :
    detail.plan === 'personal' ? 214_748_364_800 :
    detail.plan === 'team' ? 1_099_511_627_776 :
    10_995_116_277_760
  )

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Quota bar */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-2">
          Quota usage
        </div>
        <StorageUsageBar
          usedBytes={totalBytes}
          quotaBytes={quotaBytes}
          planName={planLabel(detail.plan)}
        />
      </div>

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
            {destinationPools.length === 0 ? (
              <div className="rounded-sm border border-line bg-paper px-3 py-3 text-[11px] text-ink-3 leading-relaxed">
                No alternate destinations available. The user's files already
                live on the only active pool — add another active storage pool
                first.
              </div>
            ) : (
              <div className="space-y-1.5">
                {destinationPools.map(pool => (
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
            )}
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
  sessions,
}: {
  detail: AdminUserDetail
  loginIps: LoginIp[]
  sessions: AdminUserSession[]
}) {
  return (
    <div className="px-5 py-4 space-y-4">
      {/* Status summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">Auth method</div>
          <div className={`text-sm font-semibold ${detail.opaque_enrolled === false ? 'text-amber-deep' : 'text-ink'}`}>
            {detail.opaque_enrolled === false ? 'Legacy' : detail.opaque_enrolled ? 'OPAQUE' : '—'}
          </div>
          <div className="text-[10px] text-ink-3 mt-0.5">
            {detail.opaque_enrolled === false ? 'Argon2id, will auto-upgrade' : detail.opaque_enrolled ? 'Password-hardened auth' : 'Unknown'}
          </div>
        </div>
        <div className="rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">Sessions</div>
          <div className="text-sm font-mono font-semibold text-ink">{detail.session_count}</div>
          <div className="text-[10px] text-ink-3 mt-0.5">
            {detail.last_login ? `Last ${formatDateTime(detail.last_login)}` : 'Never'}
          </div>
        </div>
      </div>

      {/* Active sessions */}
      {sessions.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-2">Active sessions</div>
          <div className="rounded-md border border-line overflow-hidden">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 text-[11px]">
                <Icon name="lock" size={12} className="text-ink-3 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-ink truncate">
                    {s.device_hint ?? s.user_agent?.slice(0, 40) ?? 'Unknown device'}
                  </div>
                  <div className="text-ink-3 font-mono">{s.ip_address ?? '—'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-ink-3">{s.last_active_at ? formatDateTime(s.last_active_at) : '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Login IPs */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-2">Login IPs</div>
        {loginIps.length === 0 ? (
          <div className="text-xs text-ink-3 italic">No login history</div>
        ) : (
          <div className="rounded-md border border-line overflow-hidden">
            <div
              className="grid px-3 py-1.5 bg-paper-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
              style={{ gridTemplateColumns: '1fr 110px 110px' }}
            >
              <span>IP</span><span>First seen</span><span>Last seen</span>
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

// ─── Sign-ins tab (GDPR opt-in) ────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function OptOutPlaceholder({ label }: { label: string }) {
  return (
    <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
      <div className="w-10 h-10 rounded-full bg-paper-2 border border-line flex items-center justify-center">
        <Icon name="eye-off" size={16} className="text-ink-4" />
      </div>
      <p className="text-[13px] font-medium text-ink-2">Tracking not enabled</p>
      <p className="text-[12px] text-ink-3 max-w-[280px] leading-relaxed">
        This user has not opted in to activity tracking. Only operational data (sessions, billing) is available.
      </p>
      <p className="text-[11px] text-ink-4">{label}</p>
    </div>
  )
}

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <svg className="animate-spin h-4 w-4 text-amber" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function SignInsTab({ data }: { data: { opted_in: boolean; sign_ins: AdminSignIn[] } | null }) {
  if (data === null) return <TabSpinner />

  if (!data.opted_in) {
    return <OptOutPlaceholder label="Sign-in history is only recorded when the user opts in." />
  }

  if (data.sign_ins.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-ink-3">
        No sign-ins recorded yet.
      </div>
    )
  }

  return (
    <div>
      {/* Column headers */}
      <div
        className="grid px-5 py-1.5 bg-paper-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line sticky top-0"
        style={{ gridTemplateColumns: '90px 1fr 130px 60px 60px' }}
      >
        <span>Time</span>
        <span>IP</span>
        <span>Device</span>
        <span>Country</span>
        <span>Status</span>
      </div>
      {data.sign_ins.map(s => (
        <div
          key={s.id}
          className="grid px-5 py-2 text-[11px] font-mono border-b border-line last:border-b-0 items-center"
          style={{ gridTemplateColumns: '90px 1fr 130px 60px 60px' }}
        >
          <span className="text-ink-3">{timeAgo(s.at)}</span>
          <span className="text-ink truncate">{s.ip_anonymized ?? '—'}</span>
          <span className="text-ink-2 truncate">{s.device ?? '—'}</span>
          <span className="text-ink-2">{s.country_code ?? '—'}</span>
          <span>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                s.success
                  ? 'bg-green/10 text-green border border-green/20'
                  : 'bg-red/10 text-red border border-red/20'
              }`}
            >
              {s.success ? 'OK' : 'Fail'}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── GDPR Activity tab ─────────────────────────────────

const EVENT_ICON: Record<string, 'upload' | 'trash' | 'download' | 'share' | 'x' | 'folder' | 'file'> = {
  file_uploaded: 'upload',
  file_deleted: 'trash',
  file_downloaded: 'download',
  share_created: 'share',
  share_revoked: 'x',
  folder_created: 'folder',
}

function GdprActivityTab({ data }: { data: { opted_in: boolean; events: AdminActivityEvent[] } | null }) {
  if (data === null) return <TabSpinner />

  if (!data.opted_in) {
    return <OptOutPlaceholder label="File activity is only recorded when the user opts in." />
  }

  if (data.events.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-ink-3">
        No activity recorded yet.
      </div>
    )
  }

  return (
    <div>
      {data.events.map(e => {
        const iconName = EVENT_ICON[e.event_type] ?? 'file'
        return (
          <div
            key={e.id}
            className="flex items-start gap-3 px-5 py-3 border-b border-line last:border-b-0"
          >
            <div className="mt-0.5 w-6 h-6 rounded-md bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Icon name={iconName} size={11} className="text-ink-3" />
            </div>
            <span className="flex-1 text-[12px] text-ink leading-snug">{e.description}</span>
            <span className="font-mono text-[10.5px] text-ink-3 shrink-0 mt-0.5">{timeAgo(e.at)}</span>
          </div>
        )
      })}
    </div>
  )
}
