export const PENDING_EXPORT_KEY = 'bb_pending_export'
export const DATA_EXPORT_ROUTE = '/settings/privacy'

// The captured intent is stamped with a timestamp and only resumes within this
// window — so a capture can't resurface on an UNRELATED login days/weeks later
// (task 0720 lead nit). The capture→bounce→re-login flow is seconds-to-minutes.
const PENDING_EXPORT_TTL_MS = 10 * 60 * 1000 // 10 minutes

interface ExportIntentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): ExportIntentStorage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function markPendingExport(storage = browserStorage()): void {
  storage?.setItem(PENDING_EXPORT_KEY, String(Date.now()))
}

export function hasPendingExport(storage = browserStorage()): boolean {
  const raw = storage?.getItem(PENDING_EXPORT_KEY)
  if (!raw) return false
  const stampedAt = Number.parseInt(raw, 10)
  if (!Number.isFinite(stampedAt)) return false
  return Date.now() - stampedAt < PENDING_EXPORT_TTL_MS
}

export function consumePendingExport(storage = browserStorage()): boolean {
  const fresh = hasPendingExport(storage)
  // Always clear — consume a fresh intent, or evict a stale one so it can't linger.
  storage?.removeItem(PENDING_EXPORT_KEY)
  return fresh
}

export function dataExportDownloadFilename(now = new Date()): string {
  return `beebeeb-export-${now.toISOString().slice(0, 10)}.zip`
}
