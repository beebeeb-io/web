import type { DriveFile } from './api'

function updatedAtMs(file: DriveFile): number {
  const parsed = Date.parse(file.updated_at)
  return Number.isFinite(parsed) ? parsed : 0
}

export function mergeRecentlyChangedFiles(
  liveFiles: DriveFile[],
  trashedFiles: DriveFile[],
  limit: number,
): DriveFile[] {
  const byId = new Map<string, DriveFile>()

  for (const file of [...liveFiles, ...trashedFiles]) {
    const existing = byId.get(file.id)
    if (!existing || updatedAtMs(file) >= updatedAtMs(existing)) {
      byId.set(file.id, file)
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => {
      const byUpdatedAt = updatedAtMs(b) - updatedAtMs(a)
      return byUpdatedAt !== 0 ? byUpdatedAt : b.id.localeCompare(a.id)
    })
    .slice(0, limit)
}
