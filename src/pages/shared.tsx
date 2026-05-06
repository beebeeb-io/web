import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileList } from '../components/file-list'
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
  getShareStats,
  listMyShares,
  revokeShare,
  cancelInvite,
  claimInvite,
  resendInvite,
  withdrawInvite,
  hideInvite,
  type ShareInvite,
  type ShareStats,
  type DriveFile,
  type MyShare,
} from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFilename, decryptFileMetadata, decryptChunk, fromBase64, x25519SharedSecret, deriveShareKey, deriveX25519Private, zeroize } from '../lib/crypto'
import { encryptedDownload } from '../lib/encrypted-download'
import { encryptedUpload } from '../lib/encrypted-upload'
import { SharedRowSkeleton } from '../components/skeleton'
import { useWsEvent } from '../lib/ws-context'
import { EmptyShared } from '../components/empty-states/empty-shared'

// ─── Helpers ───────────────────────────────────────


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
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isUnlocked, getMasterKey, getFileKey } = useKeys()
  const { showToast } = useToast()
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  const [tab, setTab] = useState<TabId>(() => {
    const p = searchParams.get('tab')
    if (p === 'by-me' || p === 'pending') return p
    return 'with-me'
  })
  const [loading, setLoading] = useState(true)

  // Share stats
  const [stats, setStats] = useState<ShareStats | null>(null)

  // "With me" state — approved incoming invites
  const [withMeInvites, setWithMeInvites] = useState<ShareInvite[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})

  // "By me" state — approved sent invites
  const [sentApproved, setSentApproved] = useState<ShareInvite[]>([])

  // Direct share links (from share-dialog, not invite flow)
  const [myShareLinks, setMyShareLinks] = useState<MyShare[]>([])
  const [shareLinksDecryptedNames, setShareLinksDecryptedNames] = useState<Record<string, string>>({})
  // Which share link has its insights panel expanded
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null)
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null)

  // "Pending" state
  const [sentInvited, setSentInvited] = useState<ShareInvite[]>([])
  const [incomingInvited, setIncomingInvited] = useState<ShareInvite[]>([])
  const [incomingClaimed, setIncomingClaimed] = useState<ShareInvite[]>([])

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; inviteId: string; tab: SharedMenuTab;
    status?: 'invited' | 'claimed'; role?: 'sender' | 'recipient'; canReshare?: boolean;
  }>({ open: false, x: 0, y: 0, inviteId: '', tab: 'with-me' })

  // Permissions popover
  const [permPopover, setPermPopover] = useState<{
    open: boolean; x: number; y: number; inviteId: string;
    recipientEmail: string; canReshare: boolean; expiresAt: string | null;
  }>({ open: false, x: 0, y: 0, inviteId: '', recipientEmail: '', canReshare: false, expiresAt: null })

  // Activity modal
  const [activityInviteId, setActivityInviteId] = useState<string | null>(null)

  // Forward share dialog
  const [forwardFileId, setForwardFileId] = useState<string | null>(null)
  const [forwardFileName, setForwardFileName] = useState<string>('')
  const [forwardFileSize, setForwardFileSize] = useState(0)

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastClickedIdRef = useRef<string | null>(null)

  // ─── Fetch all data ────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sent, incoming, shareStats, shareLinks] = await Promise.all([
        getSentInvites().catch(() => []),
        getIncomingInvites().catch(() => []),
        getShareStats().catch(() => null),
        listMyShares().catch(() => []),
      ])
      setMyShareLinks(shareLinks.filter((s) => !s.revoked))

      setWithMeInvites(incoming.filter((i) => i.status === 'approved'))
      setSentApproved(sent.filter((i) => i.status === 'approved'))
      setSentInvited(sent.filter((i) => i.status === 'invited'))
      setIncomingInvited(incoming.filter((i) => i.status === 'invited'))
      setIncomingClaimed(incoming.filter((i) => i.status === 'claimed'))
      setStats(shareStats)
    } catch (err) {
      console.error('[Shared] Failed to load shared items:', err)
      showToast({ icon: 'x', title: 'Failed to load shared items', danger: true })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Decrypt file names for share links when vault is unlocked
  useEffect(() => {
    if (!isUnlocked || myShareLinks.length === 0) return
    let cancelled = false
    async function decryptNames() {
      const names: Record<string, string> = {}
      for (const share of myShareLinks) {
        if (cancelled) return
        try {
          const fileKey = await getFileKey(share.file_id)
          const { name } = await decryptFileMetadata(fileKey, share.file.name_encrypted)
          names[share.id] = name
        } catch {
          names[share.id] = 'Encrypted file'
        }
      }
      if (!cancelled) setShareLinksDecryptedNames(names)
    }
    decryptNames()
    return () => { cancelled = true }
  }, [myShareLinks, isUnlocked, getFileKey])

  // Real-time: refresh share list when shares are created or revoked
  useWsEvent(
    ['share.created', 'share.revoked'],
    useCallback(() => {
      fetchAll()
    }, [fetchAll]),
  )

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
        if (invite.file_id && invite.sender_public_key && invite.encrypted_file_key && invite.file_name_encrypted) {
          try {
            const masterKey = getMasterKey()
            const myPrivate = await deriveX25519Private(masterKey)
            const theirPublic = fromBase64(invite.sender_public_key)
            const sharedSecret = await x25519SharedSecret(myPrivate, theirPublic)
            const fileIdBytes = new TextEncoder().encode(invite.file_id)
            const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)

            const efkBytes = fromBase64(invite.encrypted_file_key)
            const fileKey = await decryptChunk(shareKey, efkBytes.slice(0, 12), efkBytes.slice(12))

            const parsed = JSON.parse(invite.file_name_encrypted) as { nonce: string; ciphertext: string }
            names[invite.id] = await decryptFilename(fileKey, fromBase64(parsed.nonce), fromBase64(parsed.ciphertext))

            zeroize(myPrivate)
            zeroize(sharedSecret)
            zeroize(shareKey)
            zeroize(fileKey)
          } catch {
            names[invite.id] = 'Encrypted file'
          }
        } else {
          // Legacy/plaintext share path. The server occasionally still
          // ships ZK-style JSON ciphertext (`{"nonce":"…","ciphertext":"…"}`)
          // here when a sender's public key is absent — rendering that
          // verbatim leaks raw ciphertext to the recipient. Detect it and
          // substitute the standard placeholder.
          const raw = invite.file_name_encrypted
          if (raw && raw.trim().startsWith('{')) {
            try {
              const probe = JSON.parse(raw)
              if (probe && typeof probe === 'object' && ('nonce' in probe || 'ciphertext' in probe)) {
                names[invite.id] = 'Encrypted file'
                continue
              }
            } catch {
              // Not JSON — fall through to use as-is.
            }
          }
          names[invite.id] = raw ?? 'Encrypted file'
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

  // ─── Workspace suggestion (hidden until spec 009 ships) ─────────────
  // The team suggestion banner + /team page are hidden pre-launch.
  // All team-suggestion state below is commented out; restore when
  // encrypted team workspaces (spec 009) are implemented.
  //
  // const TEAM_SUGGESTION_THRESHOLD = 3
  // const TEAM_SUGGESTION_DISMISS_KEY = 'bb_team_suggest_dismissed'
  // const [dismissedRecipients, setDismissedRecipients] = useState<Set<string>>(() => {
  //   try {
  //     const raw = localStorage.getItem(TEAM_SUGGESTION_DISMISS_KEY)
  //     return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  //   } catch { return new Set() }
  // })

  // teamSuggestion + dismissTeamSuggestion hidden until spec 009 (team
  // encryption) ships — the suggestion banner pointed to /team which is a
  // placeholder page that would embarrass us at launch.
  // const teamSuggestion = useMemo(() => {
  //   const counts = new Map<string, number>()
  //   for (const invite of sentApproved) {
  //     const email = invite.recipient_email
  //     if (!email || dismissedRecipients.has(email)) continue
  //     counts.set(email, (counts.get(email) ?? 0) + 1)
  //   }
  //   let topEmail: string | null = null
  //   let topCount = 0
  //   for (const [email, count] of counts) {
  //     if (count > topCount) { topEmail = email; topCount = count }
  //   }
  //   if (!topEmail || topCount < TEAM_SUGGESTION_THRESHOLD) return null
  //   return { recipientEmail: topEmail, shareCount: topCount }
  // }, [sentApproved, dismissedRecipients])
  //
  // const dismissTeamSuggestion = useCallback((email: string) => {
  //   setDismissedRecipients((prev) => {
  //     const next = new Set(prev)
  //     next.add(email)
  //     try { localStorage.setItem(TEAM_SUGGESTION_DISMISS_KEY, JSON.stringify([...next])) } catch {}
  //     return next
  //   })
  // }, [])

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

  // ─── Derive file key from a shared invite ─────

  async function deriveSharedFileKey(invite: ShareInvite): Promise<Uint8Array> {
    if (!invite.sender_public_key || !invite.encrypted_file_key) {
      throw new Error('Missing encryption data for this share')
    }
    const masterKey = getMasterKey()
    const myPrivate = await deriveX25519Private(masterKey)
    const theirPublic = fromBase64(invite.sender_public_key)
    const sharedSecret = await x25519SharedSecret(myPrivate, theirPublic)
    const fileIdBytes = new TextEncoder().encode(invite.file_id)
    const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
    const efkBytes = fromBase64(invite.encrypted_file_key)
    const fileKey = await decryptChunk(shareKey, efkBytes.slice(0, 12), efkBytes.slice(12))
    zeroize(myPrivate)
    zeroize(sharedSecret)
    zeroize(shareKey)
    return fileKey
  }

  // ─── Context menu action handler ──────────────

  const handleSharedAction = useCallback(async (action: string, inviteId: string) => {
    switch (action) {
      case 'download': {
        const invite = withMeInvites.find((i) => i.id === inviteId)
        if (!invite) break
        try {
          const fileKey = await deriveSharedFileKey(invite)
          await encryptedDownload(
            invite.file_id,
            fileKey,
            invite.file_name_encrypted ?? '',
            invite.mime_type ?? 'application/octet-stream',
            invite.chunk_count ?? 1,
            invite.size_bytes ?? 0,
          )
          zeroize(fileKey)
        } catch (e) {
          showToast({ icon: 'x', title: 'Download failed', description: e instanceof Error ? e.message : 'Could not decrypt the file.', danger: true })
        }
        break
      }
      case 'save-copy': {
        const invite = withMeInvites.find((i) => i.id === inviteId)
        if (!invite) break
        try {
          showToast({ icon: 'folder', title: 'Saving copy...', description: 'Downloading, re-encrypting, and uploading.' })
          const sharedFileKey = await deriveSharedFileKey(invite)
          // Download + decrypt using the shared key (same as encryptedDownload but keep the blob)
          const { decryptToBlob } = await import('../lib/encrypted-download')
          const { plaintext, filename } = await decryptToBlob(
            invite.file_id,
            sharedFileKey,
            invite.file_name_encrypted ?? '',
            invite.mime_type ?? 'application/octet-stream',
            invite.chunk_count ?? 1,
            invite.size_bytes ?? 0,
          )
          zeroize(sharedFileKey)
          // Re-encrypt with own key and upload
          const file = new File([plaintext], filename, { type: invite.mime_type ?? 'application/octet-stream' })
          const newFileId = crypto.randomUUID()
          const newFileKey = await getFileKey(newFileId)
          await encryptedUpload(file, newFileId, newFileKey, undefined, () => {})
          zeroize(newFileKey)
          showToast({ icon: 'check', title: 'Copy saved', description: `${filename} saved to your vault.` })
        } catch (e) {
          showToast({ icon: 'x', title: 'Save failed', description: e instanceof Error ? e.message : 'Could not save copy.', danger: true })
        }
        break
      }
      case 'forward': {
        const invite = withMeInvites.find((i) => i.id === inviteId)
        if (invite?.file_id) {
          setForwardFileId(invite.file_id)
          setForwardFileName(displayName(invite))
          setForwardFileSize(invite.size_bytes ?? 0)
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
      case 'share-settings': {
        const invite = sentApproved.find((i) => i.id === inviteId) ?? sentInvited.find((i) => i.id === inviteId)
        if (invite) {
          setPermPopover({
            open: true, x: ctxMenu.x, y: ctxMenu.y, inviteId,
            recipientEmail: invite.recipient_email,
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

  // ─── Loading skeleton ──────────────────────────

  const LoadingSkeleton = () => (
    <div>
      {Array.from({ length: 6 }, (_, i) => (
        <SharedRowSkeleton key={i} />
      ))}
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

  // ─── Map invite to DriveFile-like object ──────

  function inviteToFile(invite: ShareInvite, subtitle: string): DriveFile {
    return {
      id: invite.id,
      name_encrypted: invite.file_name_encrypted ?? 'Encrypted file',
      mime_type: subtitle,
      size_bytes: invite.size_bytes ?? 0,
      is_folder: invite.is_folder ?? false,
      parent_id: null,
      chunk_count: invite.chunk_count ?? 1,
      is_starred: false,
      has_thumbnail: false,
      created_at: invite.created_at,
      updated_at: invite.approved_at ?? invite.created_at,
    }
  }

  // ─── Tab content: With me ─────────────────────

  const renderWithMe = () => {
    const files = withMeInvites.map((i) =>
      inviteToFile(i, i.sender_email ? `Shared by ${i.sender_email}` : 'Shared file'),
    )
    return (
      <FileList
        files={files}
        loading={loading}
        emptyState={<EmptyShared tab="with-me" onGoToDrive={() => navigate('/')} />}
        sortable={false}
        externalDecryptedNames={decryptedNames}
        renderActions={(file) => (
          <BBButton
            size="sm"
            variant="ghost"
            className="md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const inv = withMeInvites.find((i) => i.id === file.id)
              setCtxMenu({
                open: true, x: rect.left, y: rect.bottom + 4,
                inviteId: file.id, tab: 'with-me', canReshare: inv?.can_reshare ?? false,
              })
            }}
          >
            <Icon name="more" size={13} />
          </BBButton>
        )}
      />
    )
  }

  // ─── Tab content: By me ───────────────────────

  async function handleRevokeShareLink(shareId: string) {
    setRevokingShareId(shareId)
    try {
      await revokeShare(shareId)
      setMyShareLinks((prev) => prev.filter((s) => s.id !== shareId))
      setExpandedShareId(null)
      showToast({ icon: 'check', title: 'Share link revoked' })
    } catch (err) {
      showToast({ icon: 'x', title: 'Failed to revoke', description: err instanceof Error ? err.message : undefined, danger: true })
    } finally {
      setRevokingShareId(null)
    }
  }

  function copyShareLink(url: string) {
    navigator.clipboard.writeText(url).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    })
    showToast({ icon: 'check', title: 'Link copied' })
  }

  function formatExpiry(iso: string | null): string {
    if (!iso) return 'No expiry'
    const d = new Date(iso)
    if (d < new Date()) return 'Expired'
    const days = Math.floor((d.getTime() - Date.now()) / 86_400_000)
    if (days === 0) return 'Expires today'
    if (days === 1) return 'Expires tomorrow'
    return `Expires in ${days}d`
  }

  const renderByMe = () => {
    const files = sentApproved.map((i) =>
      inviteToFile(i, i.recipient_email ? `Shared with ${i.recipient_email}` : 'Shared file'),
    )
    const byMeNames: Record<string, string> = {}
    for (const i of sentApproved) {
      byMeNames[i.id] = i.file_name_encrypted ?? 'Encrypted file'
    }
    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* ── Share links section ─────────────────────────── */}
        {myShareLinks.length > 0 && (
          <div className="border-b border-line">
            <div className="px-5 py-2.5 bg-paper-2 flex items-center gap-2">
              <Icon name="link" size={12} className="text-ink-3" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Share links
              </span>
              <BBChip className="text-[9px]">{myShareLinks.length}</BBChip>
            </div>
            <div className="divide-y divide-line">
              {myShareLinks.map((share) => {
                const name = shareLinksDecryptedNames[share.id] ?? 'Encrypted file'
                const isExpanded = expandedShareId === share.id
                return (
                  <div key={share.id} className="border-b border-line last:border-b-0">
                    {/* Link row */}
                    <button
                      type="button"
                      onClick={() => setExpandedShareId(isExpanded ? null : share.id)}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-paper-2 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-lg bg-amber-bg border border-amber/20 flex items-center justify-center shrink-0">
                        <Icon name="link" size={12} className="text-amber-deep" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate">{name}</div>
                        <div className="flex items-center gap-2 text-[11px] text-ink-3 mt-0.5">
                          <span>{share.open_count ?? 0} opens</span>
                          {share.max_opens && <><span>·</span><span>/ {share.max_opens} max</span></>}
                          <span>·</span>
                          <span>{formatExpiry(share.expires_at)}</span>
                          {share.has_passphrase && <><span>·</span><span className="text-amber-deep">Passphrase</span></>}
                        </div>
                      </div>
                      <Icon
                        name="chevron-down"
                        size={13}
                        className={`shrink-0 text-ink-3 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Insights panel */}
                    {isExpanded && (
                      <div className="px-5 pb-4 pt-2 bg-paper-2 border-t border-line">
                        {/* URL row */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-mono text-[11px] text-ink-2 truncate flex-1 min-w-0 bg-paper border border-line rounded px-2 py-1.5">
                            {share.url}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyShareLink(share.url)}
                            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-paper border border-line text-[12px] font-medium text-ink hover:bg-paper-3 transition-colors cursor-pointer"
                          >
                            <Icon name="copy" size={12} />
                            Copy link
                          </button>
                        </div>

                        {/* KPI row */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="rounded-lg bg-paper border border-line p-2.5">
                            <div className="text-[10px] text-ink-4 mb-0.5">Opens</div>
                            <div className="font-mono text-[13px] font-semibold">
                              {share.open_count ?? 0}
                              {share.max_opens ? ` / ${share.max_opens}` : ''}
                            </div>
                          </div>
                          <div className="rounded-lg bg-paper border border-line p-2.5">
                            <div className="text-[10px] text-ink-4 mb-0.5">Expiry</div>
                            <div className="text-[12px] font-medium">{formatExpiry(share.expires_at)}</div>
                          </div>
                          <div className="rounded-lg bg-paper border border-line p-2.5">
                            <div className="text-[10px] text-ink-4 mb-0.5">Created</div>
                            <div className="text-[12px]">{timeAgo(share.created_at)}</div>
                          </div>
                        </div>

                        {/* Revoke */}
                        <div className="flex justify-end">
                          <BBButton
                            size="sm"
                            variant="ghost"
                            className="text-red hover:text-red border-red/20 hover:border-red/40"
                            onClick={() => void handleRevokeShareLink(share.id)}
                            disabled={revokingShareId === share.id}
                          >
                            {revokingShareId === share.id ? 'Revoking…' : 'Revoke link'}
                          </BBButton>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Sent invites (FileList) ─────────────────── */}
        <div className="flex-1">
        <FileList
        files={files}
        loading={loading}
        emptyState={<EmptyShared tab="by-me" onGoToDrive={() => navigate('/')} />}
        sortable={false}
        externalDecryptedNames={byMeNames}
        renderActions={(file) => (
          <BBButton
            size="sm"
            variant="ghost"
            className="md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setCtxMenu({ open: true, x: rect.left, y: rect.bottom + 4, inviteId: file.id, tab: 'by-me' })
            }}
          >
            <Icon name="more" size={13} />
          </BBButton>
        )}
      />
        </div>
      </div>
    )
  }

  // ─── Tab content: Pending ─────────────────────

  const renderPending = () => {
    if (loading) return <LoadingSkeleton />

    const hasWaiting = sentInvited.length > 0
    const hasIncomingInvited = incomingInvited.length > 0
    const hasWaitingSender = incomingClaimed.length > 0

    if (!hasWaiting && !hasIncomingInvited && !hasWaitingSender) {
      // Only show ShareApprove section — it handles its own empty state
      return (
        <div className="flex-1 overflow-y-auto">
          <SectionHeader title="Needs your action" count={0} />
          <div className="px-5 py-4">
            <ShareApprove onUpdate={fetchAll} />
          </div>
          <EmptyShared tab="pending" onGoToDrive={() => navigate('/')} />
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

        {/* Section: Shared with you — claim to access */}
        {hasIncomingInvited && (
          <>
            <SectionHeader title="Shared with you" count={incomingInvited.length} />
            <div className="divide-y divide-line">
              {incomingInvited.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-paper-2 transition-colors"
                >
                  <div className="shrink-0 w-[30px] h-[30px] rounded-[8px] bg-amber-bg border border-line flex items-center justify-center">
                    <Icon name="share" size={13} className="text-amber-deep" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">
                      {invite.sender_email ?? 'Someone'} shared a file
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      {timeAgo(invite.created_at)}
                    </div>
                  </div>
                  <BBButton
                    variant="amber"
                    size="sm"
                    className="shrink-0 gap-1"
                    onClick={async () => {
                      try {
                        await claimInvite(invite.id)
                        showToast({ icon: 'check', title: 'Claimed', description: 'Waiting for sender to approve access.' })
                        fetchAll()
                      } catch (e) {
                        showToast({ icon: 'x', title: 'Failed to claim', description: e instanceof Error ? e.message : 'Something went wrong.', danger: true })
                      }
                    }}
                  >
                    <Icon name="check" size={11} />
                    Claim
                  </BBButton>
                </div>
              ))}
            </div>
          </>
        )}

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
    : sentInvited.length + incomingInvited.length + incomingClaimed.length

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
        {stats && (
          <div className="flex items-center gap-1.5 ml-2">
            <BBChip variant="default" className="text-[10px] gap-1">
              <span className="font-mono">{stats.active_links}</span> active link{stats.active_links !== 1 ? 's' : ''}
            </BBChip>
            <span className="text-ink-4 text-[10px]">&middot;</span>
            <BBChip variant={stats.pending_invites > 0 ? 'amber' : 'default'} className="text-[10px] gap-1">
              <span className="font-mono">{stats.pending_invites}</span> pending invite{stats.pending_invites !== 1 ? 's' : ''}
            </BBChip>
            <span className="text-ink-4 text-[10px]">&middot;</span>
            <BBChip variant="default" className="text-[10px] gap-1">
              <span className="font-mono">{stats.total_downloads}</span> total download{stats.total_downloads !== 1 ? 's' : ''}
            </BBChip>
          </div>
        )}
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
            ? sentInvited.length + incomingInvited.length + incomingClaimed.length
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

      {/* Smart workspace recommendation — hidden until spec 009 (team encryption) ships.
          The /team page is a placeholder; showing "Create a team" on the Shared page
          would send users to a dead end at launch. Re-enable once workspaces
          + encrypted team keys are fully implemented.
      {teamSuggestion && (
        <div className="px-5 pt-3.5">
          <div className="flex items-start gap-3 rounded-md border border-amber/30 bg-amber-bg px-3.5 py-3">
            <Icon name="users" size={14} className="text-amber-deep shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-ink leading-snug">
                You&apos;ve shared{' '}
                <span className="font-mono text-[12px]">{teamSuggestion.shareCount}</span>{' '}
                files with{' '}
                <span className="font-medium">{teamSuggestion.recipientEmail}</span>.
                A team workspace keeps shared files in one place and skips the per-file invite step.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <BBButton size="sm" variant="amber" onClick={() => navigate('/team')}>
                Create a team
              </BBButton>
              <button
                type="button"
                onClick={() => dismissTeamSuggestion(teamSuggestion.recipientEmail)}
                className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
                aria-label="Dismiss suggestion"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
      */}

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
          fileSize={forwardFileSize}
        />
      )}
    </DriveLayout>
  )
}
