export function formatStorageSI(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`
  if (bytes < 1_000_000_000_000) return `${(bytes / 1_000_000_000).toFixed(0)} GB`
  return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`
}

export function formatBytes(bytes: number): string {
  return formatStorageSI(bytes)
}

/**
 * Format a document date for display ("12 Oct 2026").
 * A date-only value (`2026-10-12`, as invoices and credit notes carry) names a
 * calendar day, not an instant: it is formatted in UTC so it never shifts a day
 * for viewers west of UTC. A full timestamp is an instant and shows in local time.
 */
export function formatDocumentDate(iso: string): string {
  if (!iso) return '-'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const d = new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]))
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', opts)
}

/** Relative age as Files shows it ("just now", "3h ago", "2w ago"). */
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
