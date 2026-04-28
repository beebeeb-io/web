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

  // Load index on unlock
  useEffect(() => {
    if (!isUnlocked) {
      indexRef.current = null
      etagRef.current = null
      return
    }

    let cancelled = false
    async function load() {
      try {
        const masterKey = getMasterKey()
        const idx = await fetchIndex(masterKey)
        if (!cancelled) {
          indexRef.current = idx ?? createEmptyIndex()
        }
      } catch {
        if (!cancelled) {
          indexRef.current = createEmptyIndex()
        }
      }
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

    if (!indexRef.current) return

    indexRef.current = removeIndexEntry(indexRef.current, fileId)

    try {
      const newEtag = await saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
      if (newEtag) etagRef.current = newEtag
    } catch {
      // Non-fatal
    }
  }, [isUnlocked, getMasterKey])

  return { indexFile, unindexFile }
}
