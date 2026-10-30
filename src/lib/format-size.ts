/**
 * One binary-unit size format for preview surfaces (LD-0001 PR-C review,
 * reuse item): the file info rail and the progress copy share this, so a
 * transfer never says "12.4 MB" next to an info panel saying "13 MB".
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
