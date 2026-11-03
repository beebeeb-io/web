// The /shared route: shares received and sent.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { FileList } from '../components/file-list'
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
import { buildShareLink, canRebuildShareLink } from '../lib/share-link'
import { userFriendlyError } from '../lib/user-friendly-error'
import { readNameMetadata, decryptFileMetadata, decryptChunk, fromBase64, x25519SharedSecret, deriveShareKey, deriveX25519Private, zeroize } from '../lib/crypto'
import { encryptedDownload } from '../lib/encrypted-download'
import { encryptedUpload } from '../lib/encrypted-upload'
import { ownedItem } from '../lib/owned-item'
import { useWsEvent } from '../lib/ws-context'
import { EmptyShared } from '../components/empty-states/empty-shared'
import { LoadingSkeleton, SectionHeader } from './shared/sections'
import { SharedLinkCard } from './shared/share-link-card'
import { SharedInviteRow } from './shared/shared-invite-row'
import { sharedItemOf, sharedItemFile } from './shared/shared-item'

// ─── Helpers ───────────────────────────────────────

export { bundleChipLabel } from './shared/format'

// ─── Tab types ───────────────────────────────────

type TabId = 'with-me' | 'by-me' | 'pending'

// ─── Component ───────────────────────────────────

export function Shared() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isUnlocked, getMasterKey, getFileKey } = useKeys()
  const { showToast } = useToast()
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
  const [revokingAll, setRevokingAll] = useState(false)

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
  const [forwardIsFolder, setForwardIsFolder] = useState(false)

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

            // Core's display reader (task 1943): the name subkey first, then
            // the legacy raw key, and the NAME out of a {name, mime_type}
            // plaintext (the raw-key decrypt used to show that JSON verbatim).
            names[invite.id] = (await readNameMetadata(fileKey, invite.file_name_encrypted)).name

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
      showToast({ icon: 'x', title: 'Failed to cancel', description: userFriendlyError(e), danger: true })
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
          // F9: the create's id is core's; its tag travels with the upload.
          const newItemId = await ownedItem.mint(getMasterKey(), 'owner')
          const newFileId = newItemId.idText
          const newFileKey = await getFileKey(newFileId)
          await encryptedUpload(file, newFileId, newFileKey, getMasterKey(), undefined, () => {}, undefined, undefined, undefined, { newItemId })
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
          setForwardIsFolder(!!invite.is_folder)
        }
        break
      }
      case 'remove-shared':
        try {
          await hideInvite(inviteId)
          showToast({ icon: 'check', title: 'Removed', description: 'Removed from your shared list.' })
          fetchAll()
        } catch (e) {
          showToast({ icon: 'x', title: 'Failed', description: userFriendlyError(e), danger: true })
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
            showToast({ icon: 'x', title: 'Failed to revoke', description: userFriendlyError(e), danger: true })
          }
        }
        break
      }
      case 'resend-email':
        try {
          await resendInvite(inviteId)
          showToast({ icon: 'mail', title: 'Email resent', description: 'Invite email was resent.' })
        } catch (e) {
          showToast({ icon: 'x', title: 'Failed to resend', description: userFriendlyError(e), danger: true })
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
          showToast({ icon: 'x', title: 'Failed to withdraw', description: userFriendlyError(e), danger: true })
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
      showToast({ icon: 'x', title: 'Bulk revoke failed', description: userFriendlyError(e), danger: true })
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
      showToast({ icon: 'x', title: 'Bulk remove failed', description: userFriendlyError(e), danger: true })
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
      showToast({ icon: 'x', title: 'Bulk cancel failed', description: userFriendlyError(e), danger: true })
    }
  }

  // ─── Map invite to DriveFile-like object ──────

  function inviteToFile(invite: ShareInvite, subtitle: string): DriveFile {
    return {
      id: invite.id,
      name_encrypted: invite.file_name_encrypted ?? 'Encrypted file',
      mime_type: subtitle,
      size_bytes: invite.size_bytes ?? 0,
      is_folder: invite.is_folder ?? false,
      is_trashed: false,
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
    const items = withMeInvites.map((i) =>
      sharedItemOf(inviteToFile(i, i.sender_email ? `Shared by ${i.sender_email}` : 'Shared file')),
    )
    return (
      <FileList
        files={items.map(sharedItemFile)}
        loading={loading}
        emptyState={<EmptyShared tab="with-me" onGoToDrive={() => navigate('/')} onShareFile={() => navigate('/')} />}
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

  async function handleRevokeAllShareLinks() {
    const count = myShareLinks.length
    if (count === 0) return
    const confirmed = confirm(
      `This will immediately revoke all ${count} share link${count !== 1 ? 's' : ''}. Files will no longer be accessible to anyone with a link.`,
    )
    if (!confirmed) return
    setRevokingAll(true)
    const results = await Promise.allSettled(myShareLinks.map((s) => revokeShare(s.id)))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = count - failed
    setMyShareLinks([])
    setExpandedShareId(null)
    if (failed === 0) {
      showToast({ icon: 'check', title: `All ${count} share link${count !== 1 ? 's' : ''} revoked` })
    } else {
      showToast({
        icon: 'x',
        title: `${succeeded} revoked, ${failed} failed`,
        description: 'Some links could not be revoked. Refresh to see current state.',
        danger: true,
      })
      fetchAll()
    }
    setRevokingAll(false)
  }

  async function copyShareLinkFor(share: MyShare) {
    // Rebuild the working /s/<token>#key=<K_c> link from the owner-wrapped pair.
    // NEVER copy share.url — it carried the wrong key for double-encrypted shares.
    const link = await buildShareLink(share, { isUnlocked, getMasterKey })
    if (!link) {
      showToast({
        icon: 'lock',
        title: 'Key not stored on this device',
        description: 'Use the full link from when you created the share, or revoke and create a new one.',
        danger: true,
      })
      return
    }
    const writeLegacy = () => {
      const ta = document.createElement('textarea')
      ta.value = link
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    navigator.clipboard.writeText(link).catch(writeLegacy)
    showToast({ icon: 'check', title: 'Link copied', description: 'Includes the decryption key.' })
  }

  const renderByMe = () => {
    const files = sentApproved.map((i) =>
      sharedItemFile(sharedItemOf(inviteToFile(i, i.recipient_email ? `Shared with ${i.recipient_email}` : 'Shared file'))),
    )
    const byMeNames: Record<string, string> = {}
    for (const i of sentApproved) {
      byMeNames[i.id] = i.file_name_encrypted ?? 'Encrypted file'
    }
    return (
      <div className="flex-1 flex flex-col overflow-y-auto min-h-0">
        {/* ── Share links section ─────────────────────────── */}
        {myShareLinks.length > 0 && (
          <div className="border-b border-line">
            <div className="px-5 py-2.5 bg-paper-2 flex items-center gap-2">
              <Icon name="link" size={12} className="text-ink-3" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Share links
              </span>
              <BBChip className="text-[9px]">{myShareLinks.length}</BBChip>
              <div className="ml-auto">
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="text-red hover:text-red border-red/20 hover:border-red/40 text-[11px] gap-1"
                  onClick={() => void handleRevokeAllShareLinks()}
                  disabled={revokingAll}
                >
                  <Icon name="trash" size={11} />
                  {revokingAll ? 'Revoking…' : 'Revoke all links'}
                </BBButton>
              </div>
            </div>
            <div className="divide-y divide-line">
              {myShareLinks.map((share) => (
                <SharedLinkCard
                  key={share.id}
                  share={share}
                  name={shareLinksDecryptedNames[share.id] ?? 'Encrypted file'}
                  isExpanded={expandedShareId === share.id}
                  canCopy={canRebuildShareLink(share, isUnlocked)}
                  isRevoking={revokingShareId === share.id}
                  onToggleExpanded={() => setExpandedShareId(expandedShareId === share.id ? null : share.id)}
                  onCopy={() => void copyShareLinkFor(share)}
                  onRevoke={() => void handleRevokeShareLink(share.id)}
                />
              ))}
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
        <div className="flex-1 overflow-y-auto min-h-0">
          <SectionHeader title="Needs your action" count={0} />
          <div className="px-5 py-4">
            <ShareApprove onUpdate={fetchAll} />
          </div>
          <EmptyShared tab="pending" onGoToDrive={() => navigate('/')} />
        </div>
      )
    }

    return (
      <div className="flex-1 overflow-y-auto min-h-0">
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
                <SharedInviteRow
                  key={invite.id}
                  variant="claim"
                  invite={invite}
                  onClaim={async (row) => {
                    try {
                      await claimInvite(row.id)
                      showToast({ icon: 'check', title: 'Claimed', description: 'Waiting for sender to approve access.' })
                      fetchAll()
                    } catch (e) {
                      showToast({ icon: 'x', title: 'Failed to claim', description: userFriendlyError(e), danger: true })
                    }
                  }}
                />
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
                <SharedInviteRow
                  key={invite.id}
                  variant="waiting-to-claim"
                  invite={invite}
                  onOpenMenu={(row, e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setCtxMenu({
                      open: true, x: rect.left, y: rect.bottom + 4,
                      inviteId: row.id, tab: 'pending', status: 'invited', role: 'sender',
                    })
                  }}
                />
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
                <SharedInviteRow
                  key={invite.id}
                  variant="waiting-approval"
                  invite={invite}
                  onOpenMenu={(row, e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setCtxMenu({
                      open: true, x: rect.left, y: rect.bottom + 4,
                      inviteId: row.id, tab: 'pending', status: 'claimed', role: 'recipient',
                    })
                  }}
                />
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
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Shared files" className="px-5 border-b border-line flex items-center gap-0">
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
              role="tab"
              aria-selected={isActive}
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
                      backgroundColor: 'var(--color-amber)',
                      color: 'var(--color-ink)',
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
          isFolder={forwardIsFolder}
        />
      )}
    </DriveLayout>
  )
}
