import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/icons'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { BBInput } from '../components/bb-input'
import { useToast } from '../components/toast'
import { useAuth } from '../lib/auth-context'
import {
  type PendingInvite,
  type Workspace,
  type WorkspaceMemberDetail,
  createWorkspace,
  inviteWorkspaceMember,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  updateMemberRole,
} from '../lib/api'

/* ── Avatar ─────────────────────────────────────── */

const AVATAR_COLORS = ['#f5b800', '#e85a4f', '#3b82f6', '#a855f7', '#0f766e', '#f97316']

function initials(email: string): string {
  const local = email.split('@')[0]
  const parts = local.split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

function avatarColor(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/* ── Role chip ──────────────────────────────────── */

function RoleChip({ role }: { role: string }) {
  if (role === 'owner') return <BBChip variant="amber">Owner</BBChip>
  if (role === 'admin') return <BBChip>Admin</BBChip>
  if (role === 'viewer') return <BBChip>Viewer</BBChip>
  return <BBChip>Member</BBChip>
}

/* ── Invite dialog ──────────────────────────────── */

function InviteDialog({
  open,
  onClose,
  onInvite,
}: {
  open: boolean
  onClose: () => void
  onInvite: (email: string, role: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    setLoading(true)
    try {
      await onInvite(email, role)
      setEmail('')
      setRole('member')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invite')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30">
      <div
        className="bg-paper rounded-xl border border-line-2 shadow-3 overflow-hidden"
        style={{ width: 460 }}
      >
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
          <Icon name="mail" size={14} className="text-ink-2" />
          <span className="text-sm font-semibold text-ink">Invite member</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 text-ink-3 hover:text-ink cursor-pointer"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3.5">
          <BBInput
            label="Email address"
            icon="mail"
            placeholder="colleague@company.eu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error || undefined}
          />

          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Role</label>
            <div className="flex gap-2">
              {(['member', 'admin', 'viewer'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border cursor-pointer transition-colors ${
                    role === r
                      ? 'bg-amber-bg border-amber-deep text-amber-deep'
                      : 'bg-paper border-line text-ink-2 hover:bg-paper-2'
                  }`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-3 mt-1.5">
              {role === 'admin'
                ? 'Admins can invite members and manage the workspace.'
                : role === 'viewer'
                  ? 'Viewers can browse shared folders but cannot upload or edit.'
                  : 'Members can upload, download, and manage their own files.'}
            </p>
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-bg rounded-md border border-amber-deep/30">
            <Icon name="shield" size={12} className="text-amber-deep shrink-0" />
            <span className="text-[11.5px] text-ink-2">
              Key exchange happens between devices, not through our servers.
            </span>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-line bg-paper-2 flex justify-end gap-2">
          <BBButton size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </BBButton>
          <BBButton
            size="sm"
            variant="amber"
            onClick={handleSubmit}
            disabled={loading || !email.includes('@')}
          >
            <Icon name="mail" size={11} className="mr-1.5" />
            {loading ? 'Sending...' : 'Send invite'}
          </BBButton>
        </div>
      </div>
    </div>
  )
}

/* ── Main team page ─────────────────────────────── */

export function Team() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [activeWs, setActiveWs] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<WorkspaceMemberDetail[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadWorkspaces = useCallback(async () => {
    try {
      const ws = await listWorkspaces()
      if (ws.length > 0) {
        setActiveWs(ws[0])
      } else {
        setLoading(false)
      }
    } catch (err) {
      console.error('[Team] Failed to load workspaces:', err)
      showToast({ icon: 'x', title: 'Failed to load workspaces', danger: true })
      setLoading(false)
    }
  }, [showToast])

  const loadMembers = useCallback(async (wsId: string) => {
    try {
      const data = await listWorkspaceMembers(wsId)
      setMembers(data.members)
      setPendingInvites(data.pending_invites)
    } catch (err) {
      console.error('[Team] Failed to load members:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    if (activeWs) {
      setLoading(true)
      loadMembers(activeWs.id)
    }
  }, [activeWs, loadMembers])

  const handleInvite = async (email: string, role: string) => {
    if (!activeWs) return
    await inviteWorkspaceMember(activeWs.id, email, role)
    loadMembers(activeWs.id)
  }

  const handleRemove = async (userId: string) => {
    if (!activeWs) return
    try {
      await removeWorkspaceMember(activeWs.id, userId)
      showToast({ icon: 'check', title: 'Member removed' })
      loadMembers(activeWs.id)
    } catch (err) {
      showToast({ icon: 'x', title: 'Failed to remove member', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
    }
  }

  const handleCreateWorkspace = async () => {
    const name = prompt('Workspace name:')
    if (!name?.trim()) return
    try {
      const ws = await createWorkspace(name.trim())
      setActiveWs(ws)
      showToast({ icon: 'check', title: `Workspace "${name.trim()}" created` })
    } catch (err) {
      showToast({ icon: 'x', title: 'Failed to create workspace', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
    }
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!activeWs) return
    try {
      await updateMemberRole(activeWs.id, userId, newRole)
      showToast({ icon: 'check', title: 'Role updated' })
      loadMembers(activeWs.id)
    } catch (err) {
      showToast({ icon: 'x', title: 'Failed to update role', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
    }
  }

  const filteredMembers = members.filter(
    (m) =>
      m.email.toLowerCase().includes(search.toLowerCase()),
  )

  const filteredInvites = pendingInvites.filter(
    (inv) => inv.email.toLowerCase().includes(search.toLowerCase()),
  )

  const callerRole = activeWs
    ? members.find((m) => m.id === user?.user_id)?.role
    : undefined
  const canManage = callerRole === 'owner' || callerRole === 'admin'

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-xl pt-12">
      <div
        className="overflow-hidden border border-line-2 rounded-xl shadow-2 bg-paper"
        style={{ width: 920, minHeight: 520 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-line">
          <Icon name="users" size={15} className="text-ink-2" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-ink">
                {activeWs ? activeWs.name : 'Team'}
              </h2>
              {activeWs && (
                <span className="font-mono text-[11px] text-ink-4">
                  {members.length} member{members.length !== 1 ? 's' : ''}
                  {pendingInvites.length > 0 &&
                    ` · ${pendingInvites.length} pending`}
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-3 mt-0.5">
              Members + access
            </p>
          </div>
          <div className="ml-auto flex gap-2 items-center">
            <div className="relative">
              <Icon
                name="search"
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"
              />
              <input
                type="text"
                placeholder="Search people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[200px] pl-7 pr-3 py-1.5 text-xs bg-paper border border-line rounded-md outline-none placeholder:text-ink-4 focus:border-amber-deep focus:ring-2 focus:ring-amber/30 transition-all"
              />
            </div>
            {canManage && (
              <BBButton size="sm" variant="amber" onClick={() => setInviteOpen(true)}>
                <Icon name="plus" size={11} className="mr-1.5" />
                Invite
              </BBButton>
            )}
          </div>
        </div>

        {/* Column header */}
        <div
          className="grid items-center px-6 py-2 border-b border-line bg-paper-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3"
          style={{ gridTemplateColumns: '1.4fr 0.8fr 1fr 80px' }}
        >
          <span>Member</span>
          <span>Role</span>
          <span>Joined</span>
          <span />
        </div>

        {/* Member rows */}
        <div className="divide-y divide-line">
          {loading && members.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {!loading && members.length === 0 && !activeWs && (
            <div className="px-6 py-12 text-center">
              <div
                className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--color-paper-2)', border: '1.5px dashed var(--color-line-2)' }}
              >
                <Icon name="users" size={22} className="text-ink-4" />
              </div>
              <p className="text-sm font-medium text-ink-2 mb-1">No workspace yet</p>
              <p className="text-xs text-ink-3 mb-3">
                Create a workspace and invite your team to start collaborating.
              </p>
              <BBButton variant="amber" size="sm" onClick={handleCreateWorkspace}>
                <Icon name="plus" size={11} className="mr-1" />
                Create workspace
              </BBButton>
            </div>
          )}

          {filteredMembers.map((m) => (
            <div
              key={m.id}
              className="grid items-center px-6 py-3"
              style={{ gridTemplateColumns: '1.4fr 0.8fr 1fr 80px' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                  style={{
                    background: avatarColor(m.email),
                    boxShadow: '0 0 0 2px var(--color-paper)',
                  }}
                >
                  {initials(m.email)}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">
                    {m.email.split('@')[0]}
                    {m.id === user?.user_id && (
                      <span className="ml-1.5 text-[10px] text-ink-4">(you)</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-ink-3 truncate">
                    {m.email}
                  </div>
                </div>
              </div>

              <div>
                {canManage && m.role !== 'owner' && m.id !== user?.user_id ? (
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.id, e.target.value)}
                    className="text-xs bg-paper border border-line rounded-md px-2 py-1 cursor-pointer outline-none focus:border-amber-deep"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <RoleChip role={m.role} />
                )}
              </div>

              <div className="font-mono text-[11px] text-ink-3">
                {new Date(m.joined_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>

              <div className="flex justify-end">
                {canManage && m.role !== 'owner' && m.id !== user?.user_id && (
                  <BBButton
                    size="sm"
                    variant="danger"
                    onClick={() => handleRemove(m.id)}
                  >
                    Remove
                  </BBButton>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Pending invites */}
        {filteredInvites.length > 0 && (
          <>
            <div className="px-6 py-2 border-t border-b border-line bg-paper-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                Pending invites
              </span>
            </div>
            <div className="divide-y divide-line">
              {filteredInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="grid items-center px-6 py-3"
                  style={{ gridTemplateColumns: '1.4fr 0.8fr 1fr 80px' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-paper-2 border border-line-2 text-ink-4 text-[11px] font-semibold shrink-0">
                      <Icon name="mail" size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink-2 truncate">
                        {inv.email}
                      </div>
                      <div className="text-[11px] text-ink-4">
                        Invited by {inv.invited_by}
                      </div>
                    </div>
                  </div>

                  <div>
                    <RoleChip role={inv.role} />
                  </div>

                  <div className="font-mono text-[11px] text-ink-3">
                    Expires{' '}
                    {new Date(inv.expires_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>

                  <div className="flex justify-end">
                    <BBButton size="sm" variant="ghost">
                      Resend
                    </BBButton>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-6 py-2.5 border-t border-line bg-paper-2 flex items-center gap-2">
          <Icon name="shield" size={12} className="text-amber-deep" />
          <span className="text-[11px] text-ink-3">
            Key exchange happens between devices, not through our servers.
          </span>
        </div>
      </div>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
      />
    </div>
  )
}
