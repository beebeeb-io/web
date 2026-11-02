import type { MyShare } from '../../lib/api'

export function timeAgo(dateStr: string): string {
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

/**
 * Task 1545, finding 4: an owner's "Shared → By me" list rendered a
 * multi-file bundle share as if it were a single file, hiding how many
 * files (and thus how much content) the link actually exposes. Server
 * response (list_my_shares) already carries `share_type` + `item_count`;
 * this reads them. Returns null for a plain file share (no chip shown).
 */
export function bundleChipLabel(share: Pick<MyShare, 'share_type' | 'item_count'>): string | null {
  if (share.share_type !== 'bundle') return null
  const n = share.item_count ?? 0
  return `bundle · ${n} ${n === 1 ? 'file' : 'files'}`
}

export function formatExpiry(iso: string | null): string {
  if (!iso) return 'No expiry'
  const d = new Date(iso)
  if (d < new Date()) return 'Expired'
  const days = Math.floor((d.getTime() - Date.now()) / 86_400_000)
  if (days === 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  return `Expires in ${days}d`
}

/** Returns a date string like "May 17" for use in expiry badges. */
export function formatExpiryDate(iso: string | null): string {
  if (!iso) return 'No expiry'
  const d = new Date(iso)
  const now = new Date()
  if (d < now) return 'Expired'
  return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function isExpired(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso) < new Date()
}
