import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import { listMembers, inviteMember, removeMember } from '../../lib/api'
import type { WorkspaceMember } from '../../lib/api'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function AdminUsers() {
  const { showToast } = useToast()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listMembers()
      setMembers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteMember(inviteEmail.trim())
      showToast({ icon: 'mail', title: 'Invite sent', description: inviteEmail.trim() })
      setInviteEmail('')
      setShowInvite(false)
      void load()
    } catch (err) {
      showToast({ icon: 'x', title: 'Invite failed', description: err instanceof Error ? err.message : 'Could not send invite', danger: true })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(id: string, email: string) {
    if (!confirm(`Remove ${email} from the workspace?`)) return
    try {
      await removeMember(id)
      showToast({ icon: 'check', title: 'User removed', description: email })
      void load()
    } catch (err) {
      showToast({ icon: 'x', title: 'Remove failed', description: err instanceof Error ? err.message : 'Could not remove user', danger: true })
    }
  }

  return (
    <AdminShell activeSection="users">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="users" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">User management</h2>
        <BBChip>{members.length} {members.length === 1 ? 'user' : 'users'}</BBChip>
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

      {/* Column headers */}
      <div
        className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
        style={{ gridTemplateColumns: '1fr 200px 120px 100px' }}
      >
        <span>Email</span>
        <span>Joined</span>
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
            <BBButton size="sm" variant="ghost" onClick={load}>Retry</BBButton>
          </div>
        ) : members.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">No users found</div>
        ) : (
          members.map(m => (
            <div
              key={m.id}
              className="grid px-5 py-3 text-xs border-b border-line items-center"
              style={{ gridTemplateColumns: '1fr 200px 120px 100px' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-7 h-7 rounded-full bg-paper-2 border border-line-2 flex items-center justify-center text-[11px] font-semibold text-ink-2 shrink-0"
                >
                  {m.email.charAt(0).toUpperCase()}
                </div>
                <span className="font-mono text-[11px] truncate">{m.email}</span>
              </div>
              <span className="text-ink-2">{formatDate(m.joined_at)}</span>
              <span>
                <BBChip variant={m.email_verified ? 'green' : 'default'}>
                  {m.email_verified ? 'Verified' : 'Pending'}
                </BBChip>
              </span>
              <div className="flex justify-end">
                <BBButton
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(m.id, m.email)}
                >
                  Remove
                </BBButton>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="shield" size={11} className="text-ink-3" />
        <span>User data is stored in Frankfurt. Hetzner.</span>
      </div>
    </AdminShell>
  )
}
