import { useState, useEffect, useCallback } from 'react'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { ShareApprove } from '../components/share-approve'
import { useToast } from '../components/toast'
import {
  listSharedWithMe,
  getSentInvites,
  getIncomingInvites,
  cancelInvite,
  type SharedWithMeItem,
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

  // "With me" state
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeItem[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<number, string>>({})

  // "By me" state — approved sent invites
  const [sentApproved, setSentApproved] = useState<ShareInvite[]>([])

  // "Pending" state
  const [sentInvited, setSentInvited] = useState<ShareInvite[]>([])
  const [incomingClaimed, setIncomingClaimed] = useState<ShareInvite[]>([])

  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // ─── Fetch all data ────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [withMe, sent, incoming] = await Promise.all([
        listSharedWithMe().catch(() => []),
        getSentInvites().catch(() => []),
        getIncomingInvites().catch(() => []),
      ])

      setSharedWithMe(withMe)
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

  // ─── Decrypt filenames for "With me" tab ─────

  useEffect(() => {
    if (!isUnlocked || sharedWithMe.length === 0) return
    let cancelled = false
    async function decryptAll() {
      const names: Record<number, string> = {}
      for (let i = 0; i < sharedWithMe.length; i++) {
        if (cancelled) return
        const item = sharedWithMe[i]
        if (item.file_id && item.sender_public_key) {
          try {
            const parsed = JSON.parse(item.file_name_encrypted) as {
              nonce: string
              ciphertext: string
            }
            const masterKey = getMasterKey()
            const myPrivate = await deriveX25519Private(masterKey)
            const theirPublic = fromBase64(item.sender_public_key)
            const sharedSecret = await x25519SharedSecret(myPrivate, theirPublic)
            const fileIdBytes = new TextEncoder().encode(item.file_id)
            const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
            names[i] = await decryptFilename(
              shareKey,
              fromBase64(parsed.nonce),
              fromBase64(parsed.ciphertext),
            )
          } catch {
            names[i] = item.file_name_encrypted
          }
        } else {
          try {
            const parsed = JSON.parse(item.file_name_encrypted)
            if (parsed.nonce && parsed.ciphertext) {
              names[i] = item.file_name_encrypted
            }
          } catch {
            names[i] = item.file_name_encrypted
          }
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [sharedWithMe, isUnlocked, getMasterKey])

  function displayName(item: SharedWithMeItem, index: number): string {
    return decryptedNames[index] ?? item.file_name_encrypted
  }

  // ─── Actions ──────────────────────────────────

  const handleCancelInvite = useCallback(async (invite: ShareInvite) => {
    setCancellingId(invite.id)
    try {
      await cancelInvite(invite.id)
      setSentInvited((prev) => prev.filter((i) => i.id !== invite.id))
      showToast({ icon: 'check', title: 'Invite cancelled', description: `Invite to ${invite.recipient_email} was cancelled.` })
    } catch (e) {
      showToast({ icon: 'x', title: 'Failed to cancel', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    } finally {
      setCancellingId(null)
    }
  }, [showToast])

  const handleRevokeShare = useCallback(async (invite: ShareInvite) => {
    setRevokingId(invite.id)
    try {
      await cancelInvite(invite.id)
      setSentApproved((prev) => prev.filter((i) => i.id !== invite.id))
      showToast({ icon: 'check', title: 'Share revoked', description: `Access for ${invite.recipient_email} was revoked.` })
    } catch (e) {
      showToast({ icon: 'x', title: 'Failed to revoke', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
    } finally {
      setRevokingId(null)
    }
  }, [showToast])

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
    if (sharedWithMe.length === 0) {
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
            gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
            gap: 14,
          }}
        >
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">From</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {sharedWithMe.map((item, i, arr) => {
            const isFolder = item.is_folder

            return (
              <div
                key={i}
                className="group hover:bg-paper-2 transition-colors cursor-pointer"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
                  gap: 14,
                  padding: '11px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                }}
              >
                <Icon
                  name={isFolder ? 'folder' : 'file'}
                  size={14}
                  className={isFolder ? 'text-amber-deep self-center' : 'text-ink-2 self-center'}
                />
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-medium truncate">{displayName(item, i)}</span>
                  <span className="text-[11px] text-ink-4 shrink-0">{timeAgo(item.created_at)}</span>
                </div>
                <span className="font-mono text-[11.5px] self-center text-ink-2 truncate">
                  {item.from_email}
                </span>
                <span className="font-mono text-[11px] text-ink-3 self-center">
                  {isFolder ? '--' : formatBytes(item.file_size)}
                </span>
                <div className="flex justify-end self-center">
                  <BBButton
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
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
            gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
            gap: 14,
          }}
        >
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
                gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
                gap: 14,
                padding: '11px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
              }}
            >
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
                  disabled={revokingId === invite.id}
                  onClick={() => handleRevokeShare(invite)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-3 hover:text-red"
                >
                  {revokingId === invite.id ? '...' : 'Revoke'}
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
                    disabled={cancellingId === invite.id}
                    onClick={() => handleCancelInvite(invite)}
                    className="text-ink-3 hover:text-red shrink-0"
                  >
                    {cancellingId === invite.id ? '...' : 'Cancel'}
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
    ? sharedWithMe.length
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
    </DriveLayout>
  )
}
