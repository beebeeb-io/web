import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import { listAdminUsers, getAdminUserDetail, inviteMember, removeMember } from '../../lib/api'
import type { AdminUser, AdminUserDetail } from '../../lib/api'

const PAGE_SIZE = 50

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

// ─── User detail panel ──────────────────────────────────────────

function UserDetailPanel({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAdminUserDetail(userId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  if (loading) {
    return (
      <div className="px-5 py-6 border-b border-line bg-paper-2">
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <svg className="animate-spin h-3.5 w-3.5 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading user details...
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="px-5 py-4 border-b border-line bg-paper-2">
        <div className="text-xs text-red">{error ?? 'User not found'}</div>
      </div>
    )
  }

  return (
    <div className="border-b border-line bg-paper-2">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-ink">User details</h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors">
            <Icon name="x" size={12} />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Storage */}
          <div className="bg-paper border border-line rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
              <Icon name="cloud" size={10} />
              Storage
            </div>
            <div className="text-sm font-semibold font-mono text-ink">
              {formatBytes(detail.storage_bytes)}
            </div>
            <div className="text-[10px] text-ink-3 mt-0.5">
              {detail.file_count.toLocaleString()} file{detail.file_count !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Plan */}
          <div className="bg-paper border border-line rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
              <Icon name="key" size={10} />
              Plan
            </div>
            <div className="text-sm font-semibold text-ink">
              {planLabel(detail.plan)}
            </div>
            <div className="text-[10px] text-ink-3 mt-0.5">
              {detail.subscription_status
                ? `${detail.subscription_status}${detail.billing_cycle ? ` (${detail.billing_cycle})` : ''}`
                : 'No subscription'}
            </div>
          </div>

          {/* Sessions */}
          <div className="bg-paper border border-line rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
              <Icon name="lock" size={10} />
              Sessions
            </div>
            <div className="text-sm font-semibold font-mono text-ink">
              {detail.session_count}
            </div>
            <div className="text-[10px] text-ink-3 mt-0.5">
              {detail.last_login
                ? `Last login ${formatDateTime(detail.last_login)}`
                : 'Never logged in'}
            </div>
          </div>

          {/* Shares */}
          <div className="bg-paper border border-line rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1">
              <Icon name="share" size={10} />
              Shares
            </div>
            <div className="text-sm font-semibold font-mono text-ink">
              {detail.share_count}
            </div>
            <div className="text-[10px] text-ink-3 mt-0.5">
              active share link{detail.share_count !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Subscription detail */}
        {detail.current_period_end && (
          <div className="mt-3 text-[11px] text-ink-3">
            <Icon name="clock" size={10} className="inline mr-1 -mt-px" />
            Current period ends {formatDate(detail.current_period_end)}
          </div>
        )}

        {/* Workspaces */}
        {detail.workspaces.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] font-mono uppercase tracking-wide text-ink-3 mb-1.5">
              Workspaces
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detail.workspaces.map(ws => (
                <BBChip key={ws.id} variant="default">
                  {ws.name}
                  <span className="ml-1 text-ink-3">({ws.role})</span>
                </BBChip>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────

export function AdminUsers() {
  const { showToast } = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (searchTerm: string, pageOffset: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await listAdminUsers({
        search: searchTerm || undefined,
        limit: PAGE_SIZE,
        offset: pageOffset,
      })
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { load(search, offset) }, [offset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  function handleSearchChange(value: string) {
    setSearch(value)
    setExpandedUserId(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setOffset(0)
      load(value, 0)
    }, 300)
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteMember(inviteEmail.trim())
      showToast({ icon: 'mail', title: 'Invite sent', description: inviteEmail.trim() })
      setInviteEmail('')
      setShowInvite(false)
      void load(search, offset)
    } catch (err) {
      showToast({ icon: 'x', title: 'Invite failed', description: err instanceof Error ? err.message : 'Could not send invite', danger: true })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(id: string, email: string) {
    if (!confirm(`Remove ${email} from the platform?`)) return
    try {
      await removeMember(id)
      showToast({ icon: 'check', title: 'User removed', description: email })
      void load(search, offset)
    } catch (err) {
      showToast({ icon: 'x', title: 'Remove failed', description: err instanceof Error ? err.message : 'Could not remove user', danger: true })
    }
  }

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <AdminShell activeSection="users">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="users" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">User management</h2>
        <BBChip>{total.toLocaleString()} {total === 1 ? 'user' : 'users'}</BBChip>
        <BBButton
          size="sm"
          variant="amber"
          className="ml-auto"
          onClick={() => setShowInvite(!showInvite)}
        >
          <Icon name="plus" size={11} className="mr-1.5" />
          Invite user
        </BBButton>
      </div>

      {/* Invite bar */}
      {showInvite && (
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-amber-bg">
          <Icon name="mail" size={12} className="text-amber-deep" />
          <input
            type="email"
            className="flex-1 border border-line-2 rounded-md px-2.5 py-1.5 text-xs bg-paper placeholder:text-ink-4"
            placeholder="Email address..."
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleInvite() }}
          />
          <BBButton size="sm" variant="amber" onClick={handleInvite} disabled={inviting}>
            {inviting ? 'Sending...' : 'Send invite'}
          </BBButton>
          <BBButton size="sm" variant="ghost" onClick={() => setShowInvite(false)}>
            <Icon name="x" size={11} />
          </BBButton>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-line bg-paper-2">
        <Icon name="search" size={12} className="text-ink-3" />
        <input
          type="text"
          className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-4"
          placeholder="Search by email..."
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
        />
        {search && (
          <button
            onClick={() => handleSearchChange('')}
            className="text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>

      {/* Column headers */}
      <div
        className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
        style={{ gridTemplateColumns: '1fr 140px 80px 100px 80px 90px' }}
      >
        <span>Email</span>
        <span>Joined</span>
        <span>Plan</span>
        <span>Storage</span>
        <span>Status</span>
        <span />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={() => load(search, offset)}>Retry</BBButton>
          </div>
        ) : users.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">
            {search ? `No users matching "${search}"` : 'No users found'}
          </div>
        ) : (
          users.map(u => {
            const isExpanded = expandedUserId === u.id
            return (
              <div key={u.id}>
                <div
                  className="grid px-5 py-3 text-xs border-b border-line items-center hover:bg-paper-2 transition-colors"
                  style={{ gridTemplateColumns: '1fr 140px 80px 100px 80px 90px' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full bg-paper-2 border border-line-2 flex items-center justify-center text-[11px] font-semibold text-ink-2 shrink-0"
                    >
                      {u.email.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-mono text-[11px] truncate">{u.email}</span>
                  </div>
                  <span className="text-ink-2">{formatDate(u.created_at)}</span>
                  <span>
                    <BBChip variant={u.plan !== 'free' ? 'amber' : 'default'}>
                      {planLabel(u.plan)}
                    </BBChip>
                  </span>
                  <span className="font-mono text-[11px] text-ink-2">
                    {formatBytes(u.storage_used_bytes)}
                  </span>
                  <span>
                    <BBChip variant={u.email_verified ? 'green' : 'default'}>
                      {u.email_verified ? 'Verified' : 'Pending'}
                    </BBChip>
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                    >
                      <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={11} className="mr-1" />
                      Details
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(u.id, u.email)}
                    >
                      <Icon name="x" size={11} />
                    </BBButton>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <UserDetailPanel
                    userId={u.id}
                    onClose={() => setExpandedUserId(null)}
                  />
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="shield" size={11} className="text-ink-3" />
        <span>User data is stored in Frankfurt. Hetzner.</span>

        {totalPages > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <BBButton
              size="sm"
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </BBButton>
            <span className="font-mono text-[11px]">
              {currentPage} / {totalPages}
            </span>
            <BBButton
              size="sm"
              variant="ghost"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </BBButton>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
