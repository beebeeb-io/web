import { useState, useEffect, useCallback, useRef } from 'react'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { ShareActivity } from '../components/share-activity'
import { ShareApprove } from '../components/share-approve'
import { ShareDialog } from '../components/share-dialog'
import { SharePermissions } from '../components/share-permissions'
import { SharedContextMenu, type SharedMenuTab } from '../components/shared-context-menu'
import { useToast } from '../components/toast'
import {
  getSentInvites,
  getIncomingInvites,
  cancelInvite,
  resendInvite,
  withdrawInvite,
  hideInvite,
  type ShareInvite,
} from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFilename, fromBase64, x25519SharedSecret, deriveShareKey, deriveX25519Private } from '../lib/crypto'

// ─── Helpers ───────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

// ─── Tab types ───────────────────────────────────

type TabId = 'with-me' | 'by-me' | 'pending'

// ─── Component ───────────────────────────────────

export function Shared() {
  const { isUnlocked, getMasterKey } = useKeys()
  const { showToast } = useToast()
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  const [tab, setTab] = useState<TabId>('with-me')
  const [loading, setLoading] = useState(true)

  // "With me" state — approved incoming invites
  const [withMeInvites, setWithMeInvites] = useState<ShareInvite[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})

  // "By me" state — approved sent invites
  const [sentApproved, setSentApproved] = useState<ShareInvite[]>([])

  // "Pending" state
  const [sentInvited, setSentInvited] = useState<ShareInvite[]>([])
  const [incomingClaimed, setIncomingClaimed] = useState<ShareInvite[]>([])

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; inviteId: string; tab: SharedMenuTab;
    status?: 'invited' | 'claimed'; role?: 'sender' | 'recipient'; canReshare?: boolean;
  }>({ open: false, x: 0, y: 0, inviteId: '', tab: 'with-me' })

  // Permissions popover
  const [permPopover, setPermPopover] = useState<{
    open: boolean; x: number; y: number; inviteId: string;
    recipientEmail: string; canDownload: boolean; canReshare: boolean; expiresAt: string | null;
  }>({ open: false, x: 0, y: 0, inviteId: '', recipientEmail: '', canDownload: true, canReshare: false, expiresAt: null })

  // Activity modal
  const [activityInviteId, setActivityInviteId] = useState<string | null>(null)

  // Forward share dialog
  const [forwardFileId, setForwardFileId] = useState<string | null>(null)
  const [forwardFileName, setForwardFileName] = useState<string>('')

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastClickedIdRef = useRef<string | null>(null)

  // ─── Fetch all data ────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sent, incoming] = await Promise.all([
        getSentInvites().catch(() => []),
        getIncomingInvites().catch(() => []),
      ])

      setWithMeInvites(incoming.filter((i) => i.status === 'approved'))
      setSentApproved(sent.filter((i) => i.status === 'approved'))
      setSentInvited(sent.filter((i) => i.status === 'invited'))
      setIncomingClaimed(incoming.filter((i) => i.status === 'claimed'))
    } catch {
      // Silently fail — data stays empty
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Clear selection on tab change
  useEffect(() => {
    setSelectedIds(new Set())
    lastClickedIdRef.current = null
  }, [tab])

  // ─── Decrypt filenames for "With me" tab ─────

  useEffect(() => {
    if (!isUnlocked || withMeInvites.length === 0) return
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      for (const invite of withMeInvites) {
        if (cancelled) return
        if (invite.file_id && invite.sender_public_key && invite.file_name_encrypted) {
          try {
            const parsed = JSON.parse(invite.file_name_encrypted) as {
              nonce: string
              ciphertext: string
            }
            const masterKey = getMasterKey()
            const myPrivate = await deriveX25519Private(masterKey)
            const theirPublic = fromBase64(invite.sender_public_key)
            const sharedSecret = await x25519SharedSecret(myPrivate, theirPublic)
            const fileIdBytes = new TextEncoder().encode(invite.file_id)
            const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
            names[invite.id] = await decryptFilename(
              shareKey,
              fromBase64(parsed.nonce),
              fromBase64(parsed.ciphertext),
            )
          } catch {
            names[invite.id] = invite.file_name_encrypted
          }
        } else {
          names[invite.id] = invite.file_name_encrypted ?? 'Encrypted file'
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [withMeInvites, isUnlocked, getMasterKey])

  function displayName(invite: ShareInvite): string {
    return decryptedNames[invite.id] ?? invite.file_name_encrypted ?? 'Encrypted file'
  }

  // ─── Actions ──────────────────────────────────

  const handleCancelInvite = useCallback(async (invite: ShareInvite) => {
    try {
      await cancelInvite(invite.id)
      setSentInvited((prev) => prev.filter((i) => i.id !== invite.id))
      showToast({ icon: 'check', title: 'Invite cancelled', description: `Invite to ${invite.recipient_email} was cancelled.` })
    } catch (e) {
      showToast({ icon: 'x', title: 'Failed to cancel', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    }
  }, [showToast])

  // ─── Context menu action handler ──────────────

  const handleSharedAction = useCallback(async (action: string, inviteId: string) => {
    switch (action) {
      case 'download':
        showToast({ icon: 'download', title: 'Not available yet', description: 'Shared file download is coming soon.' })
        break
      case 'save-copy':
        showToast({ icon: 'folder', title: 'Not available yet', description: 'Save copy to drive is coming soon.' })
        break
      case 'forward': {
        const invite = withMeInvites.find((i) => i.id === inviteId)
        if (invite?.file_id) {
          setForwardFileId(invite.file_id)
          setForwardFileName(displayName(invite))
        }
        break
      }
      case 'remove-shared':
        try {
          await hideInvite(inviteId)
          showToast({ icon: 'check', title: 'Removed', description: 'Removed from your shared list.' })
          fetchAll()
        } catch (e) {
          showToast({ icon: 'x', title: 'Failed', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
        }
        break
      case 'change-permissions':
      case 'set-expiry': {
        const invite = sentApproved.find((i) => i.id === inviteId) ?? sentInvited.find((i) => i.id === inviteId)
        if (invite) {
          setPermPopover({
            open: true, x: ctxMenu.x, y: ctxMenu.y, inviteId,
            recipientEmail: invite.recipient_email,
            canDownload: invite.can_download ?? true,
            canReshare: invite.can_reshare ?? false,
            expiresAt: invite.expires_at ?? null,
          })
        }
        break
      }
      case 'view-activity':
        setActivityInviteId(inviteId)
        break
      case 'revoke-access': {
        const invite = sentApproved.find((i) => i.id === inviteId)
        if (invite && confirm(`Revoke access? ${invite.recipient_email} will no longer be able to decrypt this file.`)) {
          try {
            await cancelInvite(inviteId)
            setSentApproved((prev) => prev.filter((i) => i.id !== inviteId))
            showToast({ icon: 'check', title: 'Access revoked', description: invite.recipient_email })
          } catch (e) {
            showToast({ icon: 'x', title: 'Failed to revoke', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
          }
        }
        break
      }
      case 'resend-email':
        try {
          await resendInvite(inviteId)
          showToast({ icon: 'mail', title: 'Email resent', description: 'Invite email was resent.' })
        } catch (e) {
          showToast({ icon: 'x', title: 'Failed to resend', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
        }
        break
      case 'cancel-invite':
        await handleCancelInvite({ id: inviteId } as ShareInvite)
        break
      case 'withdraw-claim':
        try {
          await withdrawInvite(inviteId)
          setIncomingClaimed((prev) => prev.filter((i) => i.id !== inviteId))
          showToast({ icon: 'check', title: 'Claim withdrawn', description: 'You withdrew your claim.' })
          fetchAll()
        } catch (e) {
          showToast({ icon: 'x', title: 'Failed to withdraw', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
        }
        break
    }
  }, [withMeInvites, sentApproved, sentInvited, ctxMenu.x, ctxMenu.y, showToast, fetchAll, handleCancelInvite])

  // ─── Multi-select helpers ─────────────────────

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClickedIdRef.current = id
  }

  function handleCheckboxClick(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    toggleSelection(id)
  }

  function selectAllInTab() {
    if (tab === 'with-me') {
      const all = new Set(withMeInvites.map((i) => i.id))
      setSelectedIds(selectedIds.size === all.size ? new Set() : all)
    } else if (tab === 'by-me') {
      const all = new Set(sentApproved.map((i) => i.id))
      setSelectedIds(selectedIds.size === all.size ? new Set() : all)
    } else {
      const all = new Set([...sentInvited, ...incomingClaimed].map((i) => i.id))
      setSelectedIds(selectedIds.size === all.size ? new Set() : all)
    }
  }

  async function handleBulkRevoke() {
    const ids = Array.from(selectedIds)
    if (!confirm(`Revoke access for ${ids.length} recipient${ids.length !== 1 ? 's' : ''}?`)) return
    try {
      await Promise.all(ids.map((id) => cancelInvite(id)))
      showToast({ icon: 'check', title: 'Access revoked', description: `${ids.length} share${ids.length !== 1 ? 's' : ''} revoked.` })
      setSelectedIds(new Set())
      fetchAll()
    } catch (e) {
      showToast({ icon: 'x', title: 'Bulk revoke failed', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    }
  }

  async function handleBulkRemove() {
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map((id) => hideInvite(id)))
      showToast({ icon: 'check', title: 'Removed', description: `${ids.length} item${ids.length !== 1 ? 's' : ''} removed.` })
      setSelectedIds(new Set())
      fetchAll()
    } catch (e) {
      showToast({ icon: 'x', title: 'Bulk remove failed', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    }
  }

  async function handleBulkCancelInvites() {
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map((id) => cancelInvite(id)))
      showToast({ icon: 'check', title: 'Invites cancelled', description: `${ids.length} invite${ids.length !== 1 ? 's' : ''} cancelled.` })
      setSelectedIds(new Set())
      fetchAll()
    } catch (e) {
      showToast({ icon: 'x', title: 'Bulk cancel failed', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    }
  }

  // ─── Spinner ──────────────────────────────────

  const Spinner = () => (
    <div className="flex items-center justify-center py-20">
      <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )

  // ─── Empty state ──────────────────────────────

  const EmptyState = ({ icon, title, description }: { icon: string; title: string; description: string }) => (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div
        className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--color-amber-bg)', border: '1.5px dashed var(--color-line-2)' }}
      >
        <Icon name={icon as any} size={24} className="text-amber-deep" />
      </div>
      <div className="text-[15px] font-semibold text-ink mb-1">{title}</div>
      <div className="text-[13px] text-ink-3">{description}</div>
    </div>
  )

  // ─── Section header (for pending tab) ─────────

  const SectionHeader = ({ title, count }: { title: string; count: number }) => (
    <div className="px-5 py-2.5 border-b border-line bg-paper-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</span>
      {count > 0 && (
        <span className="text-[10px] font-mono font-medium text-amber-deep bg-amber-bg px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  )

  // ─── Tab content: With me ─────────────────────

  const renderWithMe = () => {
    if (loading) return <Spinner />
    if (withMeInvites.length === 0) {
      return (
        <EmptyState
          icon="share"
          title="Nothing shared with you yet"
          description="When someone shares a file with you, it will appear here"
        />
      )
    }

    return (
      <>
        {/* Column header */}
        <div
          className="px-[18px] py-2.5 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 32px 1.4fr 1fr 100px 80px',
            gap: 14,
          }}
        >
          <span className="flex items-center justify-center">
            {withMeInvites.length > 0 && (
              <BBCheckbox
                checked={selectedIds.size === withMeInvites.length && withMeInvites.length > 0}
                indeterminate={selectedIds.size > 0 && selectedIds.size < withMeInvites.length}
                onChange={() => selectAllInTab()}
              />
            )}
          </span>
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">From</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {withMeInvites.map((invite, i, arr) => {
            const isFolder = invite.is_folder ?? false

            return (
              <div
                key={invite.id}
                className="group hover:bg-paper-2 transition-colors cursor-pointer"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 32px 1.4fr 1fr 100px 80px',
                  gap: 14,
                  padding: '11px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                }}
              >
                <span
                  className={`flex items-center justify-center ${
                    selectedIds.has(invite.id) ? '' : 'opacity-0 group-hover:opacity-100'
                  } transition-opacity`}
                  onClick={(e) => handleCheckboxClick(invite.id, e)}
                >
                  <BBCheckbox checked={selectedIds.has(invite.id)} onChange={() => {}} />
                </span>
                <Icon
                  name={isFolder ? 'folder' : 'file'}
                  size={14}
                  className={isFolder ? 'text-amber-deep self-center' : 'text-ink-2 self-center'}
                />
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-medium truncate">{displayName(invite)}</span>
                  <span className="text-[11px] text-ink-4 shrink-0">{timeAgo(invite.created_at)}</span>
                </div>
                <span className="font-mono text-[11.5px] self-center text-ink-2 truncate">
                  {invite.sender_email ?? ''}
                </span>
                <span className="font-mono text-[11px] text-ink-3 self-center">
                  {isFolder ? '--' : formatBytes(invite.size_bytes ?? 0)}
                </span>
                <div className="flex justify-end self-center">
                  <BBButton
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setCtxMenu({
                        open: true, x: rect.left, y: rect.bottom + 4,
                        inviteId: invite.id, tab: 'with-me', canReshare: invite.can_reshare ?? false,
                      })
                    }}
                  >
                    <Icon name="more" size={13} />
                  </BBButton>
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  // ─── Tab content: By me ───────────────────────

  const renderByMe = () => {
    if (loading) return <Spinner />
    if (sentApproved.length === 0) {
      return (
        <EmptyState
          icon="upload"
          title="No active shares"
          description="Files you share with others will appear here once they accept"
        />
      )
    }

    return (
      <>
        {/* Column header */}
        <div
          className="px-[18px] py-2.5 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 32px 1.4fr 1fr 100px 80px',
            gap: 14,
          }}
        >
          <span className="flex items-center justify-center">
            {sentApproved.length > 0 && (
              <BBCheckbox
                checked={selectedIds.size === sentApproved.length && sentApproved.length > 0}
                indeterminate={selectedIds.size > 0 && selectedIds.size < sentApproved.length}
                onChange={() => selectAllInTab()}
              />
            )}
          </span>
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">File</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Shared with</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Date</span>
          <span />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {sentApproved.map((invite, i, arr) => (
            <div
              key={invite.id}
              className="group hover:bg-paper-2 transition-colors"
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 32px 1.4fr 1fr 100px 80px',
                gap: 14,
                padding: '11px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
              }}
            >
              <span
                className={`flex items-center justify-center ${
                  selectedIds.has(invite.id) ? '' : 'opacity-0 group-hover:opacity-100'
                } transition-opacity`}
                onClick={(e) => handleCheckboxClick(invite.id, e)}
              >
                <BBCheckbox checked={selectedIds.has(invite.id)} onChange={() => {}} />
              </span>
              <Icon name="file" size={14} className="text-ink-2 self-center" />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium truncate">
                  {invite.file_name_encrypted ?? 'Encrypted file'}
                </span>
              </div>
              <span className="font-mono text-[11.5px] self-center text-ink-2 truncate">
                {invite.recipient_email}
              </span>
              <span className="font-mono text-[11px] text-ink-3 self-center">
                {invite.approved_at ? timeAgo(invite.approved_at) : timeAgo(invite.created_at)}
              </span>
              <div className="flex justify-end self-center">
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setCtxMenu({
                      open: true, x: rect.left, y: rect.bottom + 4,
                      inviteId: invite.id, tab: 'by-me',
                    })
                  }}
                >
                  <Icon name="more" size={13} />
                </BBButton>
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  // ─── Tab content: Pending ─────────────────────

  const renderPending = () => {
    if (loading) return <Spinner />

    const hasWaiting = sentInvited.length > 0
    const hasWaitingSender = incomingClaimed.length > 0

    if (!hasWaiting && !hasWaitingSender) {
      // Only show ShareApprove section — it handles its own empty state
      return (
        <div className="flex-1 overflow-y-auto">
          <SectionHeader title="Needs your action" count={0} />
          <div className="px-5 py-4">
            <ShareApprove onUpdate={fetchAll} />
          </div>
          <div className="px-5 py-12 text-center">
            <div className="text-[13px] text-ink-3">No pending invites or requests</div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 overflow-y-auto">
        {/* Section: Needs your action (ShareApprove) */}
        <SectionHeader title="Needs your action" count={0} />
        <div className="px-5 py-4">
          <ShareApprove onUpdate={fetchAll} />
        </div>

        {/* Section: Invited — waiting */}
        {hasWaiting && (
          <>
            <SectionHeader title="Invited — waiting" count={sentInvited.length} />
            <div className="divide-y divide-line">
              {sentInvited.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-paper-2 transition-colors"
                >
                  <div className="shrink-0 w-[30px] h-[30px] rounded-[8px] bg-paper-2 border border-line flex items-center justify-center">
                    <Icon name="mail" size={13} className="text-ink-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">
                      <span className="font-mono text-xs">{invite.recipient_email}</span>
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      Invited {timeAgo(invite.created_at)}
                    </div>
                  </div>
                  <BBChip variant="default" className="text-[10px] shrink-0">Waiting to claim</BBChip>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setCtxMenu({
                        open: true, x: rect.left, y: rect.bottom + 4,
                        inviteId: invite.id, tab: 'pending', status: 'invited', role: 'sender',
                      })
                    }}
                  >
                    <Icon name="more" size={13} />
                  </BBButton>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Section: Waiting for sender */}
        {hasWaitingSender && (
          <>
            <SectionHeader title="Waiting for sender" count={incomingClaimed.length} />
            <div className="divide-y divide-line">
              {incomingClaimed.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-paper-2 transition-colors"
                >
                  <div className="shrink-0 w-[30px] h-[30px] rounded-[8px] bg-paper-2 border border-line flex items-center justify-center">
                    <Icon name="clock" size={13} className="text-ink-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">
                      {invite.sender_email ?? 'Unknown sender'}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      Claimed {invite.claimed_at ? timeAgo(invite.claimed_at) : timeAgo(invite.created_at)}
                    </div>
                  </div>
                  <BBChip variant="default" className="text-[10px] shrink-0">Waiting for approval</BBChip>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setCtxMenu({
                        open: true, x: rect.left, y: rect.bottom + 4,
                        inviteId: invite.id, tab: 'pending', status: 'claimed', role: 'recipient',
                      })
                    }}
                  >
                    <Icon name="more" size={13} />
                  </BBButton>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── Status bar count ─────────────────────────

  const itemCount = tab === 'with-me'
    ? withMeInvites.length
    : tab === 'by-me'
    ? sentApproved.length
    : sentInvited.length + incomingClaimed.length

  return (
    <DriveLayout>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-line flex items-center gap-2.5">
        <Icon name="share" size={14} className="text-amber-deep" />
        <div>
          <h1 className="text-sm font-semibold text-ink">Shared</h1>
          <p className="text-[11px] text-ink-3">
            Files shared with you and by you
          </p>
        </div>
        <div className="ml-auto">
          <NotificationInbox
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-5 border-b border-line flex items-center gap-0">
        {([
          { id: 'with-me' as TabId, label: 'With me' },
          { id: 'by-me' as TabId, label: 'By me' },
          { id: 'pending' as TabId, label: 'Pending' },
        ]).map((t) => {
          const isActive = tab === t.id
          const badgeCount = t.id === 'pending'
            ? sentInvited.length + incomingClaimed.length
            : 0

          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="relative px-4 py-2.5 text-[13px] font-medium cursor-pointer transition-colors"
              style={{ color: isActive ? 'var(--color-ink)' : 'var(--color-ink-3)' }}
            >
              <span className="flex items-center gap-1.5">
                {t.label}
                {badgeCount > 0 && (
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                    style={{
                      backgroundColor: 'oklch(0.82 0.17 84)',
                      color: 'oklch(0.25 0.04 84)',
                    }}
                  >
                    {badgeCount}
                  </span>
                )}
              </span>
              {/* Active underline */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
                  style={{ backgroundColor: 'oklch(0.82 0.17 84)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'with-me' && renderWithMe()}
      {tab === 'by-me' && renderByMe()}
      {tab === 'pending' && renderPending()}

      {/* Status bar */}
      <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3 mt-auto">
        <span className="font-mono">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          <Icon name="shield" size={12} className="text-amber-deep" />
          End-to-end encrypted
        </span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="px-5 py-2.5 border-t border-line bg-ink flex items-center gap-3.5">
          <span className="text-sm font-medium text-paper">{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-paper/60 hover:text-paper transition-colors cursor-pointer">Clear</button>
          <div className="ml-auto flex items-center gap-1.5">
            {tab === 'with-me' && (
              <BBButton size="sm" variant="ghost" className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5" onClick={handleBulkRemove}>
                <Icon name="x" size={13} /> Remove all
              </BBButton>
            )}
            {tab === 'by-me' && (
              <BBButton size="sm" variant="ghost" className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5" onClick={handleBulkRevoke}>
                <Icon name="trash" size={13} /> Revoke all
              </BBButton>
            )}
            {tab === 'pending' && (
              <BBButton size="sm" variant="ghost" className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5" onClick={handleBulkCancelInvites}>
                <Icon name="x" size={13} /> Cancel all
              </BBButton>
            )}
          </div>
        </div>
      )}

      {/* Overlays */}
      <SharedContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        tab={ctxMenu.tab}
        inviteId={ctxMenu.inviteId}
        status={ctxMenu.status}
        role={ctxMenu.role}
        canReshare={ctxMenu.canReshare}
        onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
        onAction={handleSharedAction}
      />

      <SharePermissions
        open={permPopover.open}
        x={permPopover.x}
        y={permPopover.y}
        inviteId={permPopover.inviteId}
        recipientEmail={permPopover.recipientEmail}
        canDownload={permPopover.canDownload}
        canReshare={permPopover.canReshare}
        expiresAt={permPopover.expiresAt}
        onClose={() => setPermPopover((prev) => ({ ...prev, open: false }))}
        onUpdated={fetchAll}
      />

      <ShareActivity
        open={activityInviteId !== null}
        inviteId={activityInviteId ?? ''}
        onClose={() => setActivityInviteId(null)}
      />

      {forwardFileId && (
        <ShareDialog
          open={forwardFileId !== null}
          onClose={() => setForwardFileId(null)}
          fileId={forwardFileId}
          fileName={forwardFileName}
          fileSize={0}
        />
      )}
    </DriveLayout>
  )
}
