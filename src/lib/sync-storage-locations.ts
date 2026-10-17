/**
 * Keep a file's real storage city across sync-derived drive refreshes (task 1919,
 * review thread on web#167).
 *
 * `GET /api/v1/files` puts the server's `storage_location` on every file row;
 * `GET /api/v1/sync/snapshot` (and the sync ops) do not — a sync node carries only
 * its `storage_pool_id`. The drive re-derives its rows from the sync tree on every
 * tree bump (a remote upload, a rename elsewhere), which dropped the location and
 * turned "AES-256-GCM · Europe · <city>" into "AES-256-GCM · Europe" until the
 * next API refresh.
 *
 * The location belongs to the POOL, not to the file id: a new version uploaded
 * after the person picked another datacenter lives in another pool, and a per-id
 * memory would keep showing the old city. So the page learns `pool -> location`
 * by joining an API row to the sync node of the same file, and a sync-derived row
 * takes the location of ITS node's pool. A pool never seen in an API row stays
 * unknown: the row says "Europe" and names no city, never a guessed one.
 *
 * A null `storage_pool_id` is the server's default pool (the list handler resolves
 * it with `default_pool_id()`), so it is learned and applied under its own key.
 *
 * The map lives in a ref owned by the page, not in the list state, for the same
 * reason as `sync-thumb-flags.ts`: a sync refresh can pass through an empty list.
 */
import { fileStorageCity } from './storage-regions'

/** The fields of a sync node this needs. */
export interface PoolNode {
  id: string
  updated_at?: string
  storage_pool_id?: string | null
}

/** The fields of an API file row this needs. */
export interface LocatedRow {
  id: string
  updated_at?: string
  storage_location?: unknown
}

/** Map key for a node's pool; the server's default pool when the node has none. */
export function poolKey(storagePoolId: string | null | undefined): string {
  return storagePoolId ?? ''
}

/**
 * Learn `pool -> location` from API rows that name a real city, joined to the sync
 * node of the same file. A pair is only trusted when both sides describe the same
 * moment (`updated_at` equal): a node that moved on (a new version, possibly in
 * another pool) must not teach its new pool the old row's city.
 */
export function learnPoolLocations(
  known: Map<string, unknown>,
  nodes: readonly PoolNode[],
  rows: readonly LocatedRow[],
): void {
  if (rows.length === 0 || nodes.length === 0) return
  const byId = new Map<string, PoolNode>()
  for (const n of nodes) byId.set(n.id, n)
  for (const r of rows) {
    if (fileStorageCity(r) === null) continue
    const n = byId.get(r.id)
    if (!n) continue
    if (n.updated_at !== r.updated_at) continue
    known.set(poolKey(n.storage_pool_id), r.storage_location)
  }
}

/** The learned location of this node's pool, or undefined when the pool is unknown. */
export function knownPoolLocation(known: ReadonlyMap<string, unknown>, node: PoolNode): unknown {
  return known.get(poolKey(node.storage_pool_id))
}
