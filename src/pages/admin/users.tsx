import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import { UserDetailDrawer } from '../../components/admin/user-detail-drawer'
import {
  listAdminUsers,
  inviteMember,
  removeMember,
  getWaitlist,
} from '../../lib/api'
import type { AdminUser, WaitlistEntry } from '../../lib/api'
import { useImpersonation } from '../../lib/impersonation-context'
import { formatBytes } from '../../lib/format'

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


function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

// ─── Main page ──────────────────────────────────────────────────

export function AdminUsers() {
  const { showToast } = useToast()
  const { startImpersonation } = useImpersonation()
  const [activeTab, setActiveTab] = useState<'users' | 'waitlist'>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (searchTerm: string, pageOffset: number) => {
    setLoading(true)
    setError(null)
    try {
      const [data, waitlistData] = await Promise.all([
        listAdminUsers({
          search: searchTerm || undefined,
          limit: PAGE_SIZE,
          offset: pageOffset,
        }),
        getWaitlist().catch(() => ({ count: 0, entries: [] })),
      ])
      setUsers(data.users)
      setTotal(data.total)
      setWaitlist(
        [...waitlistData.entries].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      )
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
    setSelectedUserId(null)
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

  async function handleImpersonate(id: string, email: string) {
    if (!confirm(`Impersonate ${email}? You will be viewing the app as this user.`)) return
    setImpersonating(id)
    try {
      await startImpersonation(id)
    } catch (err) {
      showToast({ icon: 'x', title: 'Impersonation failed', description: err instanceof Error ? err.message : 'Could not impersonate user', danger: true })
      setImpersonating(null)
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
        {activeTab === 'users' && (
          <BBButton
            size="sm"
            variant="amber"
            className="ml-auto"
            onClick={() => setShowInvite(!showInvite)}
          >
            <Icon name="plus" size={11} className="mr-1.5" />
            Invite user
          </BBButton>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-line px-5">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-3 py-2.5 text-[12px] border-b-2 transition-colors ${
            activeTab === 'users'
              ? 'border-amber font-semibold text-ink'
              : 'border-transparent text-ink-3 hover:text-ink-2'
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setActiveTab('waitlist')}
          className={`px-3 py-2.5 text-[12px] border-b-2 transition-colors ${
            activeTab === 'waitlist'
              ? 'border-amber font-semibold text-ink'
              : 'border-transparent text-ink-3 hover:text-ink-2'
          }`}
        >
          Waitlist{' '}
          <span className="font-mono text-[10px] text-ink-3">
            {waitlist.length}
          </span>
        </button>
      </div>

      {activeTab === 'users' ? (
        <>
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
            style={{ gridTemplateColumns: '1fr 140px 80px 100px 80px 180px' }}
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
              users.map(u => (
                <div
                  key={u.id}
                  className="grid px-5 py-3 text-xs border-b border-line items-center hover:bg-paper-2 transition-colors cursor-pointer"
                  style={{ gridTemplateColumns: '1fr 140px 80px 100px 80px 180px' }}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-paper-2 border border-line-2 flex items-center justify-center text-[11px] font-semibold text-ink-2 shrink-0">
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
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => handleImpersonate(u.id, u.email)}
                      disabled={impersonating === u.id}
                    >
                      <Icon name="eye" size={11} className="mr-1" />
                      {impersonating === u.id ? 'Loading...' : 'Impersonate'}
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      <Icon name="chevron-right" size={11} className="mr-1" />
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
              ))
            )}
          </div>

          {/* Pagination footer */}
          <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
            <Icon name="shield" size={11} className="text-ink-3" />
            <span>User data is stored in Falkenstein. Hetzner.</span>

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
        </>
      ) : (
        <>
          {/* Waitlist column headers */}
          <div
            className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
            style={{ gridTemplateColumns: '1fr 160px 180px' }}
          >
            <span>Email</span>
            <span>Source</span>
            <span>Signed up</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : waitlist.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-ink-3">
                No signups yet
              </div>
            ) : (
              waitlist.map((e, idx) => (
                <div
                  key={`${e.email}-${e.created_at}`}
                  className={`grid px-5 py-2.5 text-xs border-b border-line items-center transition-colors hover:bg-paper-2 ${
                    idx % 2 === 1 ? 'bg-paper-2/50' : ''
                  }`}
                  style={{ gridTemplateColumns: '1fr 160px 180px' }}
                >
                  <span className="font-mono text-[11px] text-ink truncate">{e.email}</span>
                  <span>
                    {e.source ? (
                      <BBChip>{e.source}</BBChip>
                    ) : (
                      <span className="text-ink-4 font-mono text-[11px]">---</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {formatDateTime(e.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
            <Icon name="mail" size={11} className="text-ink-3" />
            <span>{waitlist.length.toLocaleString()} signups · sorted by most recent first</span>
          </div>
        </>
      )}

      {selectedUserId && (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </AdminShell>
  )
}
