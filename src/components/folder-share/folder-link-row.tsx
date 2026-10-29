/**
 * Task 2237b — one row in the owner's folder share list.
 *
 * The copy rules live in exported pure functions so the strings are pinned by
 * tests without a DOM: "Untitled link", "Can view / Can add / Can edit",
 * "Expires in N days" / "Never expires", "1.2 GB of 5 GB used", "4 downloads".
 */
import { Icon } from '@beebeeb/shared'
import { formatBytes } from '../../lib/format'
import type { FolderLink } from '../../lib/folder-link-types'

export function linkTitle(label: string | null): string {
  const trimmed = label?.trim()
  return trimmed ? trimmed : 'Untitled link'
}

export function levelChipLabel(level: FolderLink['access_level']): string {
  if (level === 'add') return 'Can add'
  if (level === 'edit') return 'Can edit'
  return 'Can view'
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** "Expires in 3 days", "Expires in 5 hours", "Expired" or "Never expires". */
export function expiryLabel(expiresAt: string | null, now: number = Date.now()): string {
  if (!expiresAt) return 'Never expires'
  const at = Date.parse(expiresAt)
  if (!Number.isFinite(at)) return 'Never expires'
  const left = at - now
  if (left <= 0) return 'Expired'
  if (left >= DAY_MS) {
    const days = Math.round(left / DAY_MS)
    return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`
  }
  const hours = Math.max(1, Math.round(left / HOUR_MS))
  return `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export function usageLabel(link: Pick<FolderLink, 'download_count'>): string {
  const n = link.download_count
  return `${n} ${n === 1 ? 'download' : 'downloads'}`
}

/** Caps read in GB with one decimal ("1.2 GB of 5 GB used"); smaller sizes via formatBytes. */
export function formatCapBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes >= 1_000_000_000) {
    const gb = (bytes / 1_000_000_000).toFixed(1)
    return `${gb.replace(/\.0$/, '')} GB`
  }
  return formatBytes(bytes)
}

/** null when the link has no cap, so the row renders no progress line. */
export function capProgressLabel(
  link: Pick<FolderLink, 'cap_bytes' | 'cap_used_bytes'>,
): string | null {
  if (link.cap_bytes === null || link.cap_bytes === undefined) return null
  return `${formatCapBytes(link.cap_used_bytes)} of ${formatCapBytes(link.cap_bytes)} used`
}

export function capPercent(link: Pick<FolderLink, 'cap_bytes' | 'cap_used_bytes'>): number | null {
  if (!link.cap_bytes) return null
  return Math.min(100, Math.round((link.cap_used_bytes / link.cap_bytes) * 100))
}

export function pauseActionLabel(paused: boolean): string {
  return paused ? 'Resume' : 'Pause'
}

/** Revoke is two-step and never copies. */
export type RevokeState = { confirming: boolean }
export type RevokeAction = 'click' | 'cancel'

export function revokeReducer(
  state: RevokeState,
  action: RevokeAction,
): { next: RevokeState; revoke: boolean } {
  if (action === 'cancel') return { next: { confirming: false }, revoke: false }
  if (!state.confirming) return { next: { confirming: true }, revoke: false }
  return { next: { confirming: false }, revoke: true }
}

export function revokeLabel(confirming: boolean): string {
  return confirming ? 'Revoke link?' : 'Revoke'
}

export interface FolderLinkRowProps {
  link: FolderLink
  /** Decrypted label, or null when it has none / could not be read. */
  label: string | null
  /** Full link URL for Copy. */
  url: string
  onTogglePause: (link: FolderLink) => void
  onCopy: (link: FolderLink, url: string) => void
  onRevoke: (link: FolderLink) => void
  /** Copy confirmation, keyed by link id. */
  copiedId?: string | null
  /** Two-step revoke: the second click is the one that revokes. */
  confirmingRevoke?: boolean
  /** Overridable clock for the expiry copy. */
  now?: number
}

export function FolderLinkRow({
  link,
  label,
  url,
  onTogglePause,
  onCopy,
  onRevoke,
  copiedId,
  confirmingRevoke,
  now,
}: FolderLinkRowProps) {
  const cap = capProgressLabel(link)
  const percent = capPercent(link)
  return (
    <li
      data-testid="folder-link-row"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-1 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{linkTitle(label)}</span>
          {link.passphrase_protected && (
            <span title="Passphrase protected" aria-label="Passphrase protected" className="text-ink-3">
              <Icon name="lock" size={12} />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-ink-3">
          <span>{levelChipLabel(link.access_level)}</span>
          <span aria-hidden="true">·</span>
          <span>{expiryLabel(link.expires_at, now)}</span>
          <span aria-hidden="true">·</span>
          <span>{usageLabel(link)}</span>
          {link.paused && (
            <>
              <span aria-hidden="true">·</span>
              <span>Paused</span>
            </>
          )}
        </div>
        {cap && (
          <div className="mt-1.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-paper-2">
              <div className="h-full bg-amber" style={{ width: `${percent ?? 0}%` }} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-ink-3">{cap}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onTogglePause(link)}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 disabled:opacity-60"
        >
          {pauseActionLabel(link.paused)}
        </button>
        <button
          type="button"
          onClick={() => onCopy(link, url)}
          disabled={!url}
          title={url ? undefined : "This link's key isn't stored for this account, so it can't be copied again."}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 disabled:opacity-60"
        >
          {copiedId === link.id ? 'Link copied.' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={() => onRevoke(link)}
          className="rounded-md px-2 py-1 text-xs font-medium text-red"
        >
          {revokeLabel(confirmingRevoke === true)}
        </button>
      </div>
    </li>
  )
}
