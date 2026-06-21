// ─── Search index hook ──────────────────────────
// Manages the encrypted search index lifecycle.
// Fetch, decrypt, update entries on file changes, and persist.

import { useCallback, useEffect, useRef } from 'react'
import { useKeys } from '../lib/key-context'
import type { SyncNode } from '@beebeeb/shared'
import {
  fetchIndex,
  saveIndex,
  createEmptyIndex,
  updateIndexEntry,
  removeIndexEntry,
  type SearchIndex,
  type SearchIndexEntry,
} from '../lib/search-index'

/** Resolves a sync node's plaintext name (decrypt + cache lives in the caller). */
export type NodeNameResolver = (node: SyncNode) => Promise<string | null>

interface UseSearchIndex {
  /** Add or update a file in the search index, then persist. */
  indexFile: (fileId: string, entry: SearchIndexEntry) => Promise<void>
  /** Remove a file from the search index, then persist. */
  unindexFile: (fileId: string) => Promise<void>
  /** Remove multiple files from the search index in one pass, then persist once. */
  unindexFiles: (fileIds: string[]) => Promise<void>
  /**
   * Backfill the index from the full vault tree (task 0840). The on-upload
   * `indexFile` path only ever sees files created in THIS web client, so files
   * uploaded by desktop/CLI/mobile — or in folders never browsed here — were
   * unsearchable. The sync snapshot holds the entire tree; this decrypts the
   * names of any nodes missing from the index, adds them (with a computed path),
   * prunes entries whose node is now trashed or gone, and persists once.
   */
  reconcileFromTree: (nodes: SyncNode[], resolveName: NodeNameResolver) => Promise<void>
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

  const reconcileFromTree = useCallback(async (nodes: SyncNode[], resolveName: NodeNameResolver) => {
    if (!isUnlocked || nodes.length === 0) return
    let masterKey: Uint8Array
    try {
      masterKey = getMasterKey()
    } catch {
      return
    }
    if (!indexRef.current) indexRef.current = createEmptyIndex()
    const prev = indexRef.current

    const byId = new Map<string, SyncNode>(nodes.map((n) => [n.id, n]))
    const liveNodes = nodes.filter((n) => !n.is_trashed)
    // ALL live ids — used for pruning. A node whose name didn't decrypt this pass
    // is still live and must NOT be pruned; it just isn't added yet.
    const liveIds = new Set<string>(liveNodes.map((n) => n.id))

    // Phase 1 — resolve every live node's name, with retry passes. On a
    // from-scratch rebuild the crypto worker / key cache is still warming, so a
    // chunk of getFileKey/decrypt calls transiently fail. Skipping them
    // permanently (the index only re-runs on a treeVersion bump that may never
    // come) left gaps — deep files silently unsearchable. So we retry the
    // stragglers a few times with backoff and only ever cache SUCCESSES, so a
    // transient failure is re-attempted rather than memoized as null.
    const nameCache = new Map<string, string>()
    let pendingIds = liveNodes.filter((n) => !(n.id in prev.files)).map((n) => n.id)
    const MAX_PASSES = 5
    for (let pass = 0; pass < MAX_PASSES && pendingIds.length > 0; pass++) {
      if (pass > 0) await new Promise((r) => setTimeout(r, 300 * pass))
      const stillPending: string[] = []
      for (const id of pendingIds) {
        const node = byId.get(id)
        if (!node) continue
        let name: string | null = null
        try { name = await resolveName(node) } catch { name = null }
        if (name) nameCache.set(id, name)
        else stillPending.push(id)
      }
      pendingIds = stillPending
    }
    // Resolve ancestor names too (for path building) — some ancestors may be
    // already-indexed and thus weren't in pendingIds. Best-effort, cached.
    const resolveAncestor = async (id: string): Promise<string | null> => {
      if (nameCache.has(id)) return nameCache.get(id) as string
      const node = byId.get(id)
      if (!node) return null
      let name: string | null = null
      try { name = await resolveName(node) } catch { name = null }
      if (name) nameCache.set(id, name)
      return name
    }

    // Folder path from root → parent (excludes the node's own name), from the
    // in-memory tree. Bounded against pathological cycles.
    const buildPath = async (node: SyncNode): Promise<string> => {
      const parts: string[] = []
      let currentId = node.parent_id
      for (let depth = 0; depth < 50 && currentId; depth++) {
        const parent = byId.get(currentId)
        if (!parent) break
        const pname = await resolveAncestor(parent.id)
        if (pname) parts.unshift(pname)
        currentId = parent.parent_id
      }
      return parts.join('/')
    }

    const files: Record<string, SearchIndexEntry> = { ...prev.files }
    let changed = false

    // Phase 2 — add every newly-resolved node with its computed path.
    for (const node of liveNodes) {
      if (node.id in files) continue // already indexed — leave as-is
      const name = nameCache.get(node.id)
      if (!name) continue // still undecryptable after retries — a later run retries
      files[node.id] = {
        name,
        path: await buildPath(node),
        type: node.is_folder ? 'folder' : 'file',
        size: node.size_bytes,
        parent: node.parent_id,
        starred: node.is_starred,
        created: node.created_at,
        modified: node.updated_at,
        tags: [],
      }
      changed = true
    }

    // Prune entries whose node is trashed (in the tree, is_trashed → not live)
    // or permanently gone (absent from the full own-vault snapshot). The index
    // only ever holds own-vault files — `indexFile` is called solely on web
    // upload — so there are no shared-folder entries to protect; dropping
    // anything not live is safe. The caller gates this on a ready snapshot, so
    // the tree is complete and absence is genuine, not transient.
    for (const id of Object.keys(files)) {
      if (liveIds.has(id)) continue
      delete files[id]
      changed = true
    }

    if (!changed) return
    indexRef.current = { ...prev, updated_at: new Date().toISOString(), files }
    try {
      const newEtag = await saveIndex(indexRef.current, masterKey, etagRef.current ?? undefined)
      if (newEtag) etagRef.current = newEtag
      // Tell open search surfaces (palette, /search) to reload the now-complete
      // index so a just-backfilled deep file becomes findable without a reload.
      window.dispatchEvent(new Event('beebeeb:search-index-updated'))
    } catch {
      // Non-fatal: rebuilds on next pass.
    }
  }, [isUnlocked, getMasterKey])

  return { indexFile, unindexFile, unindexFiles, reconcileFromTree }
}
