import { useState, useEffect, useCallback } from 'react'
import { BBButton } from './bb-button'
import { Icon } from './icons'
import { useToast } from './toast'
import {
  getPendingApprovals,
  approveInvite,
  denyInvite,
  type ShareInvite,
} from '../lib/api'
import { useKeys } from '../lib/key-context'
import {
  encryptFileKeyForSharing,
  fromBase64,
  toBase64,
  zeroize,
} from '../lib/crypto'

interface ShareApproveProps {
  onUpdate?: () => void
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

export function ShareApprove({ onUpdate }: ShareApproveProps) {
  const { getFileKey, getMasterKey, isUnlocked } = useKeys()
  const { showToast } = useToast()

  const [invites, setInvites] = useState<ShareInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    try {
      const pending = await getPendingApprovals()
      setInvites(pending)
    } catch {
      // Silently fail — the component is non-critical UI
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const handleApprove = useCallback(
    async (invite: ShareInvite) => {
      if (!isUnlocked) {
        showToast({
          icon: 'lock',
          title: 'Vault is locked',
          description: 'Unlock your vault to approve share requests.',
          danger: true,
        })
        return
      }

      if (!invite.recipient_public_key) {
        showToast({
          icon: 'x',
          title: 'Cannot approve',
          description: 'Recipient has not set up encryption yet.',
          danger: true,
        })
        return
      }

      setActionInProgress(invite.id)

      try {
        const masterKey = getMasterKey()
        const fileKey = await getFileKey(invite.file_id)
        const recipientPubKey = fromBase64(invite.recipient_public_key)

        const { encryptedFileKey, nonce } = await encryptFileKeyForSharing(
          masterKey,
          recipientPubKey,
          invite.file_id,
          fileKey,
        )

        // Zero the file key after use
        zeroize(fileKey)

        // Combine nonce + ciphertext for transport
        const combined = new Uint8Array(nonce.length + encryptedFileKey.length)
        combined.set(nonce, 0)
        combined.set(encryptedFileKey, nonce.length)

        await approveInvite(invite.id, toBase64(combined))

        // Remove from local state
        setInvites((prev) => prev.filter((i) => i.id !== invite.id))

        showToast({
          icon: 'check',
          title: 'Share approved',
          description: `${invite.recipient_email} can now access the file.`,
        })

        onUpdate?.()
      } catch (e) {
        showToast({
          icon: 'x',
          title: 'Failed to approve',
          description: e instanceof Error ? e.message : 'Something went wrong. Try again.',
          danger: true,
        })
      } finally {
        setActionInProgress(null)
      }
    },
    [isUnlocked, getMasterKey, getFileKey, showToast, onUpdate],
  )

  const handleDeny = useCallback(
    async (invite: ShareInvite) => {
      setActionInProgress(invite.id)

      try {
        await denyInvite(invite.id)

        // Remove from local state
        setInvites((prev) => prev.filter((i) => i.id !== invite.id))

        showToast({
          icon: 'x',
          title: 'Share denied',
          description: `Request from ${invite.recipient_email} was denied.`,
        })

        onUpdate?.()
      } catch (e) {
        showToast({
          icon: 'x',
          title: 'Failed to deny',
          description: e instanceof Error ? e.message : 'Something went wrong. Try again.',
          danger: true,
        })
      } finally {
        setActionInProgress(null)
      }
    },
    [showToast, onUpdate],
  )

  // Render nothing while loading or if empty
  if (loading || invites.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {invites.map((invite) => {
        const isProcessing = actionInProgress === invite.id

        return (
          <div
            key={invite.id}
            className="flex items-center gap-3 border border-line rounded-lg bg-paper px-4 py-3 transition-colors"
            style={{ borderLeftWidth: 3, borderLeftColor: 'oklch(0.82 0.17 84)' }}
          >
            {/* Icon */}
            <div className="shrink-0 w-[30px] h-[30px] rounded-[8px] bg-amber-bg flex items-center justify-center">
              <Icon name="mail" size={13} className="text-amber-deep" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-ink leading-snug truncate">
                <span className="font-mono text-xs">{invite.recipient_email}</span>
                {' '}wants access
              </div>
              <div className="text-[11.5px] text-ink-3 mt-0.5 leading-snug">
                Encrypted file
                {invite.claimed_at && (
                  <span className="ml-1.5 text-ink-4">
                    — claimed {timeAgo(invite.claimed_at)}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="shrink-0 flex items-center gap-1.5">
              <BBButton
                variant="amber"
                size="sm"
                disabled={isProcessing}
                onClick={() => handleApprove(invite)}
                className="gap-1"
              >
                <Icon name="check" size={11} />
                {isProcessing && actionInProgress === invite.id ? 'Encrypting...' : 'Approve'}
              </BBButton>
              <BBButton
                variant="ghost"
                size="sm"
                disabled={isProcessing}
                onClick={() => handleDeny(invite)}
                className="text-ink-3 hover:text-red"
              >
                Deny
              </BBButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}
