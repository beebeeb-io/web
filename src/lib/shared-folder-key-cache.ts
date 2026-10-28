/**
 * Task 2237b — a per-folder index (file id → wrapped key, or share id → link
 * label) fetched once and reused for the drive session.
 *
 * Owns no plaintext key material: the values are wraps or display labels.
 * - A successful load is reused.
 * - A lookup that misses refreshes the folder's index ONCE (a guest may have
 *   added the file after the first load); concurrent misses share that one
 *   refetch, and a key that is still missing afterwards is a miss, not a loop.
 * - A rejected load is evicted, so a later lookup recovers instead of serving
 *   the failure for the rest of the session.
 */
export function createSharedFolderKeyCache<V = string>(
  load: (folderId: string) => Promise<Map<string, V>>,
) {
  const entries = new Map<string, Promise<Map<string, V>>>()
  function get(folderId: string): Promise<Map<string, V>> {
    let pending = entries.get(folderId)
    if (!pending) {
      const started = load(folderId)
      pending = started
      entries.set(folderId, started)
      void started.catch(() => {
        if (entries.get(folderId) === started) entries.delete(folderId)
      })
    }
    return pending
  }
  return {
    async forFile(folderId: string, fileId: string): Promise<Map<string, V>> {
      const pending = get(folderId)
      const index = await pending
      if (index.has(fileId)) return index
      // Refresh on a miss once. Concurrent misses share the replacement fetch.
      if (entries.get(folderId) === pending) entries.delete(folderId)
      return get(folderId)
    },
    clear: () => entries.clear(),
  }
}
