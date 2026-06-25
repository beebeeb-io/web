// ─── Search index context (B4, task 0871) ─────────────────────────────────
//
// ONE owned core-backed `CoreSearchIndex` for the whole app, exposed via React
// context so the command palette, the /search page, and the drive surfaces all
// query the SAME index instead of each fetching + decrypting their own copy
// (the pre-B4 three-load-site shape). The index lives on core's unified sharded
// primitive (`search-index-core.ts`); all crypto runs in core.
//
// DATA-COMPAT (A+B+D, blueprint §3): the search index is a derived cache, fully
// rebuildable on-device, so there is NO data loss. On first post-migration
// unlock the shard manifest is empty for every existing user; we:
//   (A) REBUILD shards from the live decrypted file tree (driven by
//       `reconcileFromTree`, called from drive-layout once the tree settles),
//   (B) keep the legacy `/api/v1/index` blob readable as a seed/fallback, and
//   (D) answer queries from that OLD blob WHILE the rebuild runs, so there is no
//       visible empty-search window. Queries flip to shard-backed once the core
//       index is populated (`shardReady`).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useKeys } from './key-context'
import type { SyncNode } from '@beebeeb/shared'
import { CoreSearchIndex } from './search-index-core'
// Legacy blob path — retained ONLY for the rebuild-window fallback/seed (B/D).
import {
  fetchIndex,
  searchIndex as scoreLegacyIndex,
  type SearchIndex as LegacyIndex,
} from './search-index'

/** Resolves a sync node's plaintext name (decrypt + cache lives in the caller). */
export type NodeNameResolver = (node: SyncNode) => Promise<string | null>

/**
 * The legacy `SearchIndexEntry` shape. Kept so drive.tsx's `indexFile` /
 * `reindexFields` call sites compile unchanged — the core index only consumes
 * `name`, the rest of the metadata now comes from the live sync tree at query
 * time (it is no longer stored in the index).
 */
export interface SearchIndexEntry {
  name: string
  path: string
  type: string
  size: number
  parent: string | null
  starred: boolean
  created: string
  modified: string
  tags: string[]
}

export interface SearchIndexContextValue {
  /** Add or update a file in the search index (only `entry.name` is used). */
  indexFile: (fileId: string, entry: SearchIndexEntry) => Promise<void>
  /** Patch an indexed entry's name (rename); move/path changes are no-ops now. */
  reindexFields: (fileId: string, fields: Partial<SearchIndexEntry>) => Promise<void>
  /** Remove a file from the index. */
  unindexFile: (fileId: string) => Promise<void>
  /** Remove multiple files in one pass. */
  unindexFiles: (fileIds: string[]) => Promise<void>
  /** Backfill from the full vault tree; ALSO the rebuild-on-empty entry point. */
  reconcileFromTree: (nodes: SyncNode[], resolveName: NodeNameResolver) => Promise<void>
  /**
   * Query the index → matching file_ids. Uses the shard-backed core index once
   * ready; falls back to the legacy blob during the first-unlock rebuild window
   * (so there is no empty-search gap). Returns `[]` when nothing is loaded yet.
   */
  query: (term: string) => Promise<string[]>
  /**
   * `true` once the core shard index is populated (queries are shard-backed).
   * `false` during the initial rebuild window (queries fall back to the blob).
   * Surfaces can subscribe to this to re-run an active query when it flips.
   */
  shardReady: boolean
  /** Monotonic tick bumped on any index mutation/rebuild — surfaces re-query. */
  version: number
}

const SearchIndexContext = createContext<SearchIndexContextValue | null>(null)

export function SearchIndexProvider({ children }: { children: ReactNode }) {
  const value = useProvideSearchIndex()
  return <SearchIndexContext.Provider value={value}>{children}</SearchIndexContext.Provider>
}

function useProvideSearchIndex(): SearchIndexContextValue {
  const { isUnlocked, getMasterKey } = useKeys()

  // The single owned core index for the session.
  const indexRef = useRef<CoreSearchIndex | null>(null)
  // A short-lived promise so concurrent callers (mutation racing the unlock
  // load) all await the SAME index init instead of building several.
  const initRef = useRef<Promise<CoreSearchIndex | null> | null>(null)
  // Legacy blob fallback for the rebuild window (D).
  const fallbackRef = useRef<LegacyIndex | null>(null)
  // True once we've REBUILT/loaded a populated core index → flip queries to core.
  const [shardReady, setShardReady] = useState(false)
  const shardReadyRef = useRef(false)
  const setReady = useCallback((v: boolean) => {
    shardReadyRef.current = v
    setShardReady(v)
  }, [])
  // Bumped on every mutation so query surfaces re-run their active query.
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  // True while a from-scratch rebuild is in flight (so a second reconcile pass
  // doesn't kick off a duplicate rebuild while the first is uploading).
  const rebuildingRef = useRef(false)
  // Ids whose prune arrived before the index was ready — flushed once it loads.
  const pendingPrunesRef = useRef<Set<string>>(new Set())

  // ── Unlock / lock lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (!isUnlocked) {
      // Free the worker-side WASM instance and reset everything on lock.
      const idx = indexRef.current
      indexRef.current = null
      initRef.current = null
      fallbackRef.current = null
      pendingPrunesRef.current.clear()
      rebuildingRef.current = false
      setReady(false)
      if (idx) void idx.dispose()
      return
    }

    let cancelled = false
    async function load() {
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      try {
        // Reconstruct from the server's shards. Empty manifest → empty index +
        // the rebuild signal (reconcileFromTree will populate it).
        const { index, manifest } = await CoreSearchIndex.fromShards(masterKey)
        if (cancelled) {
          void index.dispose()
          return
        }
        indexRef.current = index
        if (manifest.length > 0) {
          // Existing user already on shards (a returning device) → query core.
          setReady(true)
          flushPendingPrunes(masterKey)
          bump()
        } else {
          // First unlock after migration: shards empty. Seed the legacy blob as
          // the fallback so queries answer during the upcoming rebuild (D).
          setReady(false)
          try {
            fallbackRef.current = await fetchIndex(masterKey)
          } catch {
            fallbackRef.current = null
          }
          bump()
        }
      } catch {
        // Shard load failed (network/decrypt). Fall back to the legacy blob so
        // search still works; reconcileFromTree will later build core shards.
        if (cancelled) return
        try {
          fallbackRef.current = await fetchIndex(masterKey)
        } catch {
          fallbackRef.current = null
        }
        try {
          indexRef.current = await CoreSearchIndex.empty()
        } catch {
          indexRef.current = null
        }
        setReady(false)
        bump()
      }
    }

    function flushPendingPrunes(masterKey: Uint8Array) {
      const pending = pendingPrunesRef.current
      const idx = indexRef.current
      if (pending.size === 0 || !idx) return
      const ids = [...pending]
      pending.clear()
      void (async () => {
        const dirty = new Set<number>()
        for (const id of ids) {
          for (const b of await idx.remove(id)) dirty.add(b)
        }
        if (dirty.size > 0) {
          await idx.pushBuckets(masterKey, [...dirty]).catch(() => {})
          bump()
        }
      })()
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isUnlocked, getMasterKey, bump, setReady])

  /** Ensure an index exists (lazily create an empty one if the load hasn't run). */
  const ensureIndex = useCallback(async (): Promise<CoreSearchIndex | null> => {
    if (indexRef.current) return indexRef.current
    if (initRef.current) return initRef.current
    initRef.current = (async () => {
      try {
        const idx = await CoreSearchIndex.empty()
        indexRef.current = idx
        return idx
      } catch {
        return null
      } finally {
        initRef.current = null
      }
    })()
    return initRef.current
  }, [])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const indexFile = useCallback(
    async (fileId: string, entry: SearchIndexEntry) => {
      if (!isUnlocked) return
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      const idx = await ensureIndex()
      if (!idx) return
      const dirty = await idx.upsert(fileId, entry.name)
      await idx.pushBuckets(masterKey, dirty).catch(() => {
        /* best-effort cache: rebuilds on next load/reconcile */
      })
      bump()
    },
    [isUnlocked, getMasterKey, ensureIndex, bump],
  )

  const reindexFields = useCallback(
    async (fileId: string, fields: Partial<SearchIndexEntry>) => {
      if (!isUnlocked) return
      // The core index only stores names, so only a rename matters here. A
      // move/path-only change is a no-op (the path is derived from the live tree
      // at query time, never stored). Without a new name there is nothing to do.
      if (typeof fields.name !== 'string') return
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      const idx = indexRef.current
      if (!idx) return
      // upsert is insert-or-update; a rename of an indexed id updates in place.
      const dirty = await idx.upsert(fileId, fields.name)
      await idx.pushBuckets(masterKey, dirty).catch(() => {})
      bump()
    },
    [isUnlocked, getMasterKey, bump],
  )

  const unindexFile = useCallback(
    async (fileId: string) => {
      if (!isUnlocked) return
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      const idx = indexRef.current
      if (!idx) {
        // Index still loading — queue so the load's flush drops it.
        pendingPrunesRef.current.add(fileId)
        return
      }
      const dirty = await idx.remove(fileId)
      if (dirty.length === 0) return
      await idx.pushBuckets(masterKey, dirty).catch(() => {})
      bump()
    },
    [isUnlocked, getMasterKey, bump],
  )

  const unindexFiles = useCallback(
    async (fileIds: string[]) => {
      if (fileIds.length === 0 || !isUnlocked) return
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }
      const idx = indexRef.current
      if (!idx) {
        for (const id of fileIds) pendingPrunesRef.current.add(id)
        return
      }
      const dirty = new Set<number>()
      for (const id of fileIds) {
        for (const b of await idx.remove(id)) dirty.add(b)
      }
      if (dirty.size === 0) return
      await idx.pushBuckets(masterKey, [...dirty]).catch(() => {})
      bump()
    },
    [isUnlocked, getMasterKey, bump],
  )

  // ── Backfill + rebuild-on-empty (A) + cross-client self-heal ───────────────
  const reconcileFromTree = useCallback(
    async (nodes: SyncNode[], resolveName: NodeNameResolver) => {
      if (!isUnlocked || nodes.length === 0) return
      let masterKey: Uint8Array
      try {
        masterKey = getMasterKey()
      } catch {
        return
      }

      const liveNodes = nodes.filter((n) => !n.is_trashed)
      const byId = new Map<string, SyncNode>(nodes.map((n) => [n.id, n]))
      const liveIds = new Set<string>(liveNodes.map((n) => n.id))

      // Resolve plaintext names with the warm-up retry passes (the crypto worker
      // / key cache is still warming on a cold rebuild, so a chunk of decrypts
      // transiently fail). Only cache SUCCESSES so a transient failure is
      // re-attempted, never memoized as null.
      const nameCache = new Map<string, string>()
      let pendingIds = liveNodes.map((n) => n.id)
      const MAX_PASSES = 5
      for (let pass = 0; pass < MAX_PASSES && pendingIds.length > 0; pass++) {
        if (pass > 0) await new Promise((r) => setTimeout(r, 300 * pass))
        const stillPending: string[] = []
        for (const id of pendingIds) {
          const node = byId.get(id)
          if (!node) continue
          let name: string | null = null
          try {
            name = await resolveName(node)
          } catch {
            name = null
          }
          if (name) nameCache.set(id, name)
          else stillPending.push(id)
        }
        pendingIds = stillPending
      }

      const idx = await ensureIndex()
      if (!idx) return

      // ── Rebuild-on-empty (first unlock after migration) ──────────────────
      // If the core index is empty AND we have resolved names, do a full BUILD +
      // push-all-shards once. Guarded so two reconcile passes don't both rebuild.
      const fileCount = await idx.fileCount()
      if (fileCount === 0 && nameCache.size > 0 && !shardReadyRef.current) {
        if (rebuildingRef.current) return
        rebuildingRef.current = true
        try {
          const entries = liveNodes
            .map((n) => ({ fileId: n.id, name: nameCache.get(n.id) }))
            .filter((e): e is { fileId: string; name: string } => typeof e.name === 'string')
          // Rebuild a fresh index and publish ALL shards.
          const rebuilt = await CoreSearchIndex.buildFrom(entries)
          const previous = indexRef.current
          indexRef.current = rebuilt
          if (previous && previous !== rebuilt) void previous.dispose()
          await rebuilt.pushAllShards(masterKey).catch(() => {
            /* best-effort: a failed publish self-heals on the next reconcile */
          })
          // Shards now populated → queries flip to core; drop the blob fallback.
          fallbackRef.current = null
          setReady(true)
          bump()
          window.dispatchEvent(new Event('beebeeb:search-index-updated'))
        } finally {
          rebuildingRef.current = false
        }
        return
      }

      // ── Incremental self-heal (already-populated index) ──────────────────
      // Add new live nodes, refresh renamed ones (name drift), prune dead ones.
      const dirty = new Set<number>()
      for (const node of liveNodes) {
        const name = nameCache.get(node.id)
        if (!name) continue // undecryptable this pass — a later run retries
        // upsert is idempotent for an unchanged name (returns its bucket as
        // dirty, but re-encrypting an unchanged bucket is harmless + LWW).
        for (const b of await idx.upsert(node.id, name)) dirty.add(b)
      }
      // Prune entries whose node is trashed or gone. We can only enumerate the
      // index's file_ids indirectly, so prune any tree id that is no longer live
      // AND any node present in the snapshot but trashed. (A genuinely-absent id
      // that was indexed is dropped on the next full rebuild; the common
      // trash/delete path goes through unindexFile/WS prune already.)
      for (const node of nodes) {
        if (!liveIds.has(node.id)) {
          for (const b of await idx.remove(node.id)) dirty.add(b)
        }
      }

      if (dirty.size > 0) {
        await idx.pushBuckets(masterKey, [...dirty]).catch(() => {})
      }
      // Once we've reconciled with resolved names, the core index is the source
      // of truth → flip to shard-backed and drop the legacy fallback.
      if (!shardReadyRef.current && nameCache.size > 0) {
        fallbackRef.current = null
        setReady(true)
      }
      bump()
      window.dispatchEvent(new Event('beebeeb:search-index-updated'))
    },
    [isUnlocked, getMasterKey, ensureIndex, bump, setReady],
  )

  // ── Query (core when ready, legacy blob fallback during rebuild) ──────────
  const query = useCallback(async (term: string): Promise<string[]> => {
    if (!term.trim()) return []
    const idx = indexRef.current
    if (idx && shardReadyRef.current) {
      try {
        return await idx.query(term)
      } catch {
        return []
      }
    }
    // Fallback: score the legacy blob (D) so there is no empty-search window.
    const fb = fallbackRef.current
    if (fb) {
      return scoreLegacyIndex(fb, term).map((r) => r.id)
    }
    // Last resort: query whatever the core index has even if not flagged ready
    // (e.g. mid-rebuild). Better a partial result than none.
    if (idx) {
      try {
        return await idx.query(term)
      } catch {
        return []
      }
    }
    return []
  }, [])

  return {
    indexFile,
    reindexFields,
    unindexFile,
    unindexFiles,
    reconcileFromTree,
    query,
    shardReady,
    version,
  }
}

/**
 * Consume the shared search index. Throws if used outside `SearchIndexProvider`
 * — every authenticated surface is wrapped by it in `app.tsx`.
 */
export function useSearchIndex(): SearchIndexContextValue {
  const ctx = useContext(SearchIndexContext)
  if (!ctx) throw new Error('useSearchIndex must be used within a SearchIndexProvider')
  return ctx
}
