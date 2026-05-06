/**
 * SharePopover — anchored dropdown that lists active share links for a file.
 *
 * Opens when the user clicks the share-count badge (link icon) in the file list.
 * Each row shows: link (truncated), opens count, expiry, copy button, revoke button.
 *
 * Usage:
 *   <SharePopover
 *     fileId="uuid"
 *     anchorRect={badgeRect}
 *     onClose={() => setOpen(false)}
 *     onRevoked={(shareId) => decrementShareCount(fileId)}
 *   />
 */

import { useState, useEffect, useRef } from 'react'
import { getSharesForFile, revokeShare, type MyShare } from '../lib/api'
import { useToast } from './toast'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'

interface SharePopoverProps {
  fileId: string
  /** DOMRect of the badge that triggered the popover (for positioning) */
  anchorRect: DOMRect
  onClose: () => void
  /** Called with the revoked share's id so the parent can decrement share_count */
  onRevoked?: (shareId: string) => void
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'No expiry'
  const d = new Date(iso)
  const diff = d.getTime() - Date.now()
  if (diff < 0) return 'Expired'
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  return `Expires in ${days}d`
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  })
}

export function SharePopover({ fileId, anchorRect, onClose, onRevoked }: SharePopoverProps) {
  const { showToast } = useToast()
  const popoverRef = useRef<HTMLDivElement>(null)
  const [shares, setShares] = useState<MyShare[]>([])
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Load shares for this file on mount
  useEffect(() => {
    let cancelled = false
    getSharesForFile(fileId)
      .then((s) => { if (!cancelled) { setShares(s); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fileId])

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  async function handleRevoke(share: MyShare) {
    setRevokingId(share.id)
    try {
      await revokeShare(share.id)
      setShares((prev) => prev.filter((s) => s.id !== share.id))
      onRevoked?.(share.id)
      showToast({ icon: 'check', title: 'Share revoked' })
      if (shares.length <= 1) onClose()
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
  }

  function handleCopy(share: MyShare) {
    copyToClipboard(share.url)
    showToast({ icon: 'check', title: 'Link copied' })
  }

  // Position: below the anchor badge, left-aligned, shifted up if near viewport bottom
  const vw = window.innerWidth
  const vh = window.innerHeight
  const POPOVER_WIDTH = 360
  const POPOVER_EST_HEIGHT = 80 + shares.length * 68

  let left = anchorRect.left
  if (left + POPOVER_WIDTH > vw - 8) left = Math.max(8, vw - POPOVER_WIDTH - 8)

  let top = anchorRect.bottom + 6
  if (top + POPOVER_EST_HEIGHT > vh - 8) top = anchorRect.top - POPOVER_EST_HEIGHT - 6

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Active share links"
      className="fixed z-[80] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      style={{ left, top, width: POPOVER_WIDTH }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-paper-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <Icon name="link" size={12} className="text-amber-deep" />
          Active share links
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-4 hover:text-ink transition-colors"
          aria-label="Close"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[320px] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-ink-4">Loading…</div>
        ) : shares.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-ink-3">No active shares</div>
        ) : (
          shares.map((share) => (
            <div
              key={share.id}
              className="px-4 py-3 border-b border-line last:border-b-0 flex flex-col gap-1.5"
            >
              {/* URL + copy */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-2 truncate flex-1 min-w-0">
                  {share.url}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(share)}
                  className="shrink-0 text-ink-3 hover:text-amber-deep transition-colors"
                  aria-label="Copy link"
                >
                  <Icon name="copy" size={13} />
                </button>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-[11px] text-ink-4">
                <span>{share.open_count ?? 0} opens</span>
                {share.max_opens && (
                  <span>/ {share.max_opens} max</span>
                )}
                <span className="ml-auto">{formatExpiry(share.expires_at)}</span>
              </div>

              {/* Revoke */}
              <div className="flex justify-end">
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="text-red hover:text-red text-[11px] px-2 py-0.5"
                  onClick={() => void handleRevoke(share)}
                  disabled={revokingId === share.id}
                >
                  {revokingId === share.id ? 'Revoking…' : 'Revoke'}
                </BBButton>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
