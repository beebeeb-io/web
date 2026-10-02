// ─── Search-index reconcile diff (task 1700) ───────────────────────────────
//
// `reconcileFromTree` used to `upsert` EVERY live node on every pass, and core
// dirties a bucket unconditionally on upsert — so each foreign sync op
// re-encrypted and re-PUT every search-index shard page (the shard PUT storm).
// This module computes the minimal work: only new/changed (renamed) ids are
// upserted, only ids this session indexed are pruned, and the union of dirty
// buckets is pushed in ONE call. An unchanged pass never reaches putShards.

import type { SyncNode } from './api'

/** A resolved plaintext name and the ciphertext it was decrypted from. */
export interface IndexNameCacheEntry {
  cipher: string
  name: string
}

export interface IndexReconcilePlan {
  upserts: { id: string; name: string }[]
  prunes: string[]
}

export interface IndexReconcileInput {
  /** All nodes of the pass — live and trashed. */
  nodes: SyncNode[]
  /** Resolved plaintext names for live nodes (undecryptable ids omitted). */
  resolved: Map<string, string>
  /** Ids this session has already written to the index (the prune set). */
  indexedIds: Set<string>
  /** Last resolved name per id, keyed by ciphertext to detect renames. */
  cachedNames: Map<string, IndexNameCacheEntry>
}

export function planIndexDiff(input: IndexReconcileInput): IndexReconcilePlan {
  const { nodes, resolved, indexedIds, cachedNames } = input
  const liveIds = new Set<string>()
  const upserts: { id: string; name: string }[] = []
  for (const node of nodes) {
    if (node.is_trashed) continue
    liveIds.add(node.id)
    const name = resolved.get(node.id)
    if (!name) continue // undecryptable this pass — a later pass retries
    // Unchanged name for an id we already indexed → no upsert (and therefore
    // no dirty bucket → no putShards).
    if (indexedIds.has(node.id) && cachedNames.get(node.id)?.name === name) continue
    upserts.push({ id: node.id, name })
  }
  const prunes: string[] = []
  for (const node of nodes) {
    if (liveIds.has(node.id)) continue
    if (indexedIds.has(node.id)) prunes.push(node.id)
  }
  return { upserts, prunes }
}

/** The subset of `CoreSearchIndex` the diff application needs (fake-able). */
export interface IndexDiffTarget {
  upsert(id: string, name: string): Promise<number[]>
  remove(id: string): Promise<number[]>
  pushBuckets(masterKey: Uint8Array, dirty: number[]): Promise<unknown>
}

/**
 * Apply a plan: mutate only the diff, then encrypt+PUT the union of dirty
 * buckets in ONE call. Returns the number of dirty buckets — 0 means nothing
 * was pushed.
 */
export async function applyIndexDiff(
  index: IndexDiffTarget,
  masterKey: Uint8Array,
  plan: IndexReconcilePlan,
): Promise<number> {
  const dirty = new Set<number>()
  for (const u of plan.upserts) {
    for (const b of await index.upsert(u.id, u.name)) dirty.add(b)
  }
  for (const id of plan.prunes) {
    for (const b of await index.remove(id)) dirty.add(b)
  }
  if (dirty.size === 0) return 0
  await index.pushBuckets(masterKey, [...dirty]).catch(() => {
    /* best-effort cache: rebuilds on next load/reconcile */
  })
  return dirty.size
}
