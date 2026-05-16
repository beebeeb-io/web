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
