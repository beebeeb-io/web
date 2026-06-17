// ─── Search index hook ──────────────────────────
// Manages the encrypted search index lifecycle.
// Fetch, decrypt, update entries on file changes, and persist.

import { useCallback, useEffect, useRef } from 'react'
import { useKeys } from '../lib/key-context'
import {
  fetchIndex,
  saveIndex,
  createEmptyIndex,
  updateIndexEntry,
  removeIndexEntry,
  type SearchIndex,
  type SearchIndexEntry,
} from '../lib/search-index'

interface UseSearchIndex {
  /** Add or update a file in the search index, then persist. */
  indexFile: (fileId: string, entry: SearchIndexEntry) => Promise<void>
  /** Remove a file from the search index, then persist. */
  unindexFile: (fileId: string) => Promise<void>
  /** Remove multiple files from the search index in one pass, then persist once. */
  unindexFiles: (fileIds: string[]) => Promise<void>
}

/**
 * Hook that loads the encrypted search index into memory and
 * provides functions to update it when files change.
 *
 * The index is fetched once when the vault is unlocked, then
 * kept in a ref. Updates are encrypted and persisted to the server.
 */
export function useSearchIndex(): UseSearchIndex {
  const { isUnlocked, getMasterKey } = useKeys()
  const indexRef = useRef<SearchIndex | null>(null)
  const etagRef = useRef<string | null>(null)
  // Ids whose prune was requested while the index was still loading (indexRef
  // null). We can't drop them yet, so we remember them and flush once the index
  // first becomes available. A Set so repeated events for the same id coalesce;
  // it's drained on flush so it never grows unbounded.
  const pendingPrunesRef = useRef<Set<string>>(new Set())

  // Load index on unlock
  useEffect(() => {
    if (!isUnlocked) {
      indexRef.current = null
      etagRef.current = null
      pendingPrunesRef.current.clear()
      return
    }

    let cancelled = false
    async function load() {
      // Capture the key once: getMasterKey() throws if the vault locked between
      // the isUnlocked check and now. If it does, bail — the unlock-effect will
      // re-run when isUnlocked flips, and pendingPrunesRef is cleared on lock.
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      try {
        const idx = await fetchIndex(masterKey)
        if (!cancelled) {
          indexRef.current = idx ?? createEmptyIndex()
          flushPendingPrunes(masterKey)
        }
      } catch {
        if (!cancelled) {
          indexRef.current = createEmptyIndex()
          flushPendingPrunes(masterKey)
        }
      }
    }

    // Apply any prunes that arrived before the index finished loading. Each is
    // membership-guarded inside removeIndexEntry, so an id that was never in the
    // index is a no-op. Persists once if anything actually changed.
    function flushPendingPrunes(masterKey: Uint8Array) {
      const pending = pendingPrunesRef.current
      if (pending.size === 0 || !indexRef.current) return
      let changed = false
      for (const id of pending) {
        const next = removeIndexEntry(indexRef.current, id)
        if (next !== indexRef.current) {
          indexRef.current = next
          changed = true
        }
      }
      pending.clear()
      if (!changed) return
      // Fire-and-forget persist of the pruned index (best-effort cache).
      saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
        .then((newEtag) => { if (newEtag) etagRef.current = newEtag })
        .catch(() => { /* Non-fatal: index rebuilds on next load */ })
    }

    load()
    return () => { cancelled = true }
  }, [isUnlocked, getMasterKey])

  const indexFile = useCallback(async (fileId: string, entry: SearchIndexEntry) => {
    if (!isUnlocked) return
    const masterKey = getMasterKey()

    // Ensure index is loaded
    if (!indexRef.current) {
      indexRef.current = createEmptyIndex()
    }

    indexRef.current = updateIndexEntry(indexRef.current, fileId, entry)

    // Persist (fire-and-forget -- index is a best-effort cache)
    try {
      const newEtag = await saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
      if (newEtag) etagRef.current = newEtag
    } catch {
      // Non-fatal: index will be rebuilt on next load
    }
  }, [isUnlocked, getMasterKey])

  const unindexFile = useCallback(async (fileId: string) => {
    if (!isUnlocked) return
    const masterKey = getMasterKey()

    // Index still loading (initial fetchIndex in flight): we can't prune yet.
    // Queue the id so the load effect drops it the moment the index is ready,
    // instead of silently losing the delete. Drained on flush — no growth.
    if (!indexRef.current) {
      pendingPrunesRef.current.add(fileId)
      return
    }

    const next = removeIndexEntry(indexRef.current, fileId)
    // Short-circuit when the id wasn't in the index: removeIndexEntry returns
    // the same reference, so there's nothing to persist — skip the encrypt+PUT.
    if (next === indexRef.current) return
    indexRef.current = next

    try {
      const newEtag = await saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
      if (newEtag) etagRef.current = newEtag
    } catch {
      // Non-fatal
    }
  }, [isUnlocked, getMasterKey])

  const unindexFiles = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return
    if (!isUnlocked) return

    // Index still loading: queue all ids so flushPendingPrunes handles them in
    // one pass (with one saveIndex call) once the index is ready.
    if (!indexRef.current) {
      for (const id of fileIds) pendingPrunesRef.current.add(id)
      return
    }

    let masterKey: Uint8Array
    try {
      masterKey = getMasterKey()
    } catch {
      return
    }

    let changed = false
    for (const id of fileIds) {
      const next = removeIndexEntry(indexRef.current, id)
      // removeIndexEntry returns the same reference when the id wasn't present.
      if (next !== indexRef.current) {
        indexRef.current = next
        changed = true
      }
    }
    if (!changed) return

    try {
      const newEtag = await saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
      if (newEtag) etagRef.current = newEtag
    } catch {
      // Non-fatal
    }
  }, [isUnlocked, getMasterKey])

  return { indexFile, unindexFile, unindexFiles }
}
