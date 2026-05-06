/**
 * ShareInfoModal — modal listing all active share links for a single file.
 *
 * Triggered from the file-list context menu's "Manage shares" item. Unlike
 * SharePopover (which is anchored to a badge and feels transient), this is a
 * full modal: the user can read, copy, revoke, and create new shares without
 * losing focus to the underlying drive view.
 *
 * The modal seeds its list from the parent-provided `myShares` prop (filtered
 * to this file) and re-fetches authoritative state via getSharesForFile on
 * mount so we never show stale data.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import {
  getSharesForFile,
  revokeShare,
  type MyShare,
} from '../lib/api'
import { useToast } from './toast'
import { useKeys } from '../lib/key-context'
import { toBase64 } from '../lib/crypto'

interface ShareInfoModalProps {
  fileId: string
  fileName: string
  isOpen: boolean
  onClose: () => void
  /** Pre-loaded shares from the drive page; used to seed the list before
   *  the authoritative fetch returns. Filtered by file_id internally. */
  myShares?: MyShare[]
  /** Open the create-share dialog for this file. */
  onCreateNew?: () => void
  /** Called with the revoked share id so the parent can refresh share counts. */
  onRevoked?: (shareId: string) => void
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const diff = d.getTime() - Date.now()
  if (diff < 0) return 'Expired'
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  return `Expires in ${days}d`
}

function isShareActive(share: MyShare): boolean {
  if (share.revoked) return false
  if (share.expires_at) {
    const exp = new Date(share.expires_at).getTime()
    if (Number.isFinite(exp) && exp <= Date.now()) return false
  }
  return true
}

export function ShareInfoModal({
  fileId,
  fileName,
  isOpen,
  onClose,
  myShares,
  onCreateNew,
  onRevoked,
}: ShareInfoModalProps) {
  const { showToast } = useToast()
  const { getFileKey, isUnlocked, cryptoReady } = useKeys()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [shares, setShares] = useState<MyShare[]>(() =>
    (myShares ?? []).filter((s) => s.file_id === fileId && isShareActive(s)),
  )
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)

  // Authoritative fetch on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    getSharesForFile(fileId)
      .then((s) => { if (!cancelled) setShares(s.filter(isShareActive)) })
      .catch(() => { /* keep seeded list */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, fileId])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleRevoke = useCallback(async (share: MyShare) => {
    setRevokingId(share.id)
    try {
      await revokeShare(share.id)
      setShares((prev) => prev.filter((s) => s.id !== share.id))
      onRevoked?.(share.id)
      showToast({ icon: 'check', title: 'Share revoked' })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to revoke',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setRevokingId(null)
    }
  }, [onRevoked, showToast])

  const handleCopy = useCallback(async (share: MyShare) => {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Unlock the vault to build a share link with the decryption key.',
        danger: true,
      })
      return
    }
    setCopyingId(share.id)
    try {
      const fileKey = await getFileKey(fileId)
      const keyB64 = toBase64(fileKey)
      const url = `${window.location.origin}/s/${share.token}#key=${encodeURIComponent(keyB64)}`
      await navigator.clipboard.writeText(url)
      showToast({
        icon: 'check',
        title: 'Share link copied',
        description: 'Includes the decryption key.',
      })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to copy link',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setCopyingId(null)
    }
  }, [cryptoReady, fileId, getFileKey, isUnlocked, showToast])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Manage share links"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[500px] mx-4 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line flex items-center gap-2.5">
          <Icon name="link" size={14} className="text-amber-deep" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink">Manage shares</div>
            <div className="text-[11px] text-ink-3 truncate" title={fileName}>{fileName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && shares.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-ink-4">Loading…</div>
          ) : shares.length === 0 ? (
            <div className="py-10 px-5 text-center">
              <div className="text-[13px] text-ink-2 mb-1">No active share links</div>
              <div className="text-[11.5px] text-ink-4">
                Create one to send this file with end-to-end encryption.
              </div>
            </div>
          ) : (
            shares.map((share) => (
              <div
                key={share.id}
                className="px-5 py-3.5 border-b border-line last:border-b-0 flex flex-col gap-2"
              >
                {/* Token + meta */}
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[11px] text-ink-2 truncate flex-1 min-w-0"
                    title={share.token}
                  >
                    {share.token.slice(0, 12)}…{share.token.slice(-4)}
                  </span>
                  <span className="text-[11px] text-ink-4 shrink-0">
                    {formatExpiry(share.expires_at)}
                  </span>
                </div>

                {/* Opens count */}
                <div className="text-[11px] text-ink-4">
                  {share.max_opens
                    ? `${share.open_count} / ${share.max_opens} opens`
                    : `${share.open_count} ${share.open_count === 1 ? 'open' : 'opens'}`}
                  {share.has_passphrase && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-deep">
                      <Icon name="lock" size={10} />
                      Password
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2">
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleCopy(share)}
                    disabled={copyingId === share.id}
                    className="gap-1.5"
                  >
                    <Icon name="copy" size={12} />
                    {copyingId === share.id ? 'Copying…' : 'Copy link'}
                  </BBButton>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRevoke(share)}
                    disabled={revokingId === share.id}
                    className="text-red hover:text-red"
                  >
                    {revokingId === share.id ? 'Revoking…' : 'Revoke'}
                  </BBButton>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-paper-2 border-t border-line flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-4 leading-snug">
            Each link includes the decryption key after <span className="font-mono">#key=</span>.
            We never see it.
          </p>
          {onCreateNew && (
            <BBButton
              variant="amber"
              size="sm"
              onClick={() => { onCreateNew(); onClose() }}
              className="gap-1.5 shrink-0"
            >
              <Icon name="plus" size={12} />
              Create new share
            </BBButton>
          )}
        </div>
      </div>
    </div>
  )
}
