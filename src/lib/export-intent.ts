export const PENDING_EXPORT_KEY = 'bb_pending_export'
export const DATA_EXPORT_ROUTE = '/settings/privacy'

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
  storage?.setItem(PENDING_EXPORT_KEY, '1')
}

export function hasPendingExport(storage = browserStorage()): boolean {
  return storage?.getItem(PENDING_EXPORT_KEY) === '1'
}

export function consumePendingExport(storage = browserStorage()): boolean {
  if (!hasPendingExport(storage)) return false
  storage?.removeItem(PENDING_EXPORT_KEY)
  return true
}

export function getPostLoginPath(storage = browserStorage()): string {
  return hasPendingExport(storage) ? DATA_EXPORT_ROUTE : '/'
}

export function dataExportDownloadFilename(now = new Date()): string {
  return `beebeeb-export-${now.toISOString().slice(0, 10)}.zip`
}
