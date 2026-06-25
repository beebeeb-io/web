// ─── Core-backed search index (B4, task 0871) ─────────────────────────────
//
// The web client's E2E-encrypted file-name search index, built on core's
// unified sharded `WasmSearchIndex` (HKDF label `beebeeb-search-index-shard-v1`,
// 64 buckets, AES-256-GCM per shard). This module is the thin domain layer that
// joins the worker-owned crypto proxy (`crypto.ts` `SearchIndexProxy`) to the
// shard storage client (`search-index-shards.ts`).
//
// Why this exists: web and mobile must produce BYTE-IDENTICAL shard keys so a
// vault's index follows the user across devices. Both clients route through the
// same core `derive_search_index_key`, so equality is structural — proven by the
// KAT in `__tests__/search-index-kat.test.ts`. NO crypto is hand-written here;
// the master key crosses into the worker as 32 raw bytes and is never logged.

import {
  buildSearchIndex,
  createSearchIndex,
  searchIndexFromShards as proxyFromShards,
  searchIndexSyncPlan as proxySyncPlan,
  type SearchIndexProxy,
  type CoreEncryptedShard,
  type ShardSyncPlan,
} from './crypto'
import {
  fetchShardManifest,
  getShards,
  putShards,
  deleteShard,
  type EncryptedShard,
  type ShardRef,
} from './search-index-shards'

/** Default bucket count — MUST match core `DEFAULT_NUM_SHARDS` (64). */
export const DEFAULT_NUM_SHARDS = 64

export type { CoreEncryptedShard, ShardSyncPlan, ShardRef }

/** A `(fileId, name)` pair fed into `build`. */
export interface IndexFileEntry {
  fileId: string
  name: string
}

/**
 * A core-backed search index plus its shard sync glue.
 *
 * Lifecycle:
 *  - `CoreSearchIndex.buildFrom(files)` — fresh build (rebuild-on-empty path).
 *  - `CoreSearchIndex.fromShards(mk)` — reconstruct from the server manifest.
 *  - `upsert`/`remove` mutate AND return the dirty bucket set; call
 *    `pushBuckets(mk, dirty)` to encrypt+PUT only those.
 *  - `query(term)` → file_ids.
 *  - `dispose()` frees the worker-side WASM instance.
 *
 * The proxy owns the WASM struct; this wraps it with the storage round-trips.
 */
export class CoreSearchIndex {
  #proxy: SearchIndexProxy
  readonly numShards: number

  private constructor(proxy: SearchIndexProxy, numShards: number) {
    this.#proxy = proxy
    this.numShards = numShards
  }

  /** Build a fresh index from a `(fileId, name)` list (rebuild path). */
  static async buildFrom(
    files: IndexFileEntry[],
    numShards: number = DEFAULT_NUM_SHARDS,
  ): Promise<CoreSearchIndex> {
    const proxy = await buildSearchIndex(files, numShards)
    return new CoreSearchIndex(proxy, numShards)
  }

  /** Create an empty index (used when there is nothing to build from yet). */
  static async empty(numShards: number = DEFAULT_NUM_SHARDS): Promise<CoreSearchIndex> {
    const proxy = await createSearchIndex(numShards)
    return new CoreSearchIndex(proxy, numShards)
  }

  /**
   * Reconstruct the index from the server's shards. Fetches the manifest, pulls
   * every shard page, and decrypts them in core under `masterKey`. Returns the
   * built index plus the manifest it was built from (so the caller can seed its
   * LWW version map). If the manifest is empty, returns an empty index and an
   * empty manifest — the caller's signal to REBUILD from the live file tree.
   */
  static async fromShards(
    masterKey: Uint8Array,
    numShards: number = DEFAULT_NUM_SHARDS,
  ): Promise<{ index: CoreSearchIndex; manifest: ShardRef[] }> {
    const manifest = await fetchShardManifest()
    if (manifest.length === 0) {
      return { index: await CoreSearchIndex.empty(numShards), manifest }
    }
    const shards = await getShards(manifest.map((m) => ({ bucket: m.bucket, page: m.page })))
    const proxy = await proxyFromShards(masterKey, shards as CoreEncryptedShard[], numShards)
    return { index: new CoreSearchIndex(proxy, numShards), manifest }
  }

  /** Insert/update a file name. Returns the dirty bucket set. */
  async upsert(fileId: string, name: string): Promise<number[]> {
    return this.#proxy.upsert(fileId, name)
  }

  /** Remove a file. Returns the dirty bucket set. */
  async remove(fileId: string): Promise<number[]> {
    return this.#proxy.remove(fileId)
  }

  /** Search; returns matching file_ids. */
  async query(term: string): Promise<string[]> {
    return this.#proxy.query(term)
  }

  /** Number of indexed files. */
  async fileCount(): Promise<number> {
    return this.#proxy.fileCount()
  }

  /**
   * Encrypt EVERY non-empty shard page and PUT them all. Used for the initial
   * rebuild-and-publish. Returns the shards that were pushed (so the caller can
   * record their post-PUT versions if it diffed the manifest).
   */
  async pushAllShards(masterKey: Uint8Array): Promise<CoreEncryptedShard[]> {
    const shards = await this.#proxy.encryptShards(masterKey)
    await putShards(shards as EncryptedShard[])
    return shards
  }

  /**
   * Encrypt ONLY the given dirty buckets and PUT them (incremental sync, the
   * steady-state write path). Buckets that produced NO page (emptied) have their
   * page-0 shard DELETEd so a stale page can't linger. Returns the pushed shards.
   *
   * `dirty` is the union of bucket sets returned by `upsert`/`remove`.
   */
  async pushBuckets(masterKey: Uint8Array, dirty: number[]): Promise<CoreEncryptedShard[]> {
    if (dirty.length === 0) return []
    const shards = await this.#proxy.encryptBuckets(masterKey, dirty)
    await putShards(shards as EncryptedShard[])

    // A dirty bucket that yielded no shard page emptied — delete its page 0 so a
    // previously-written page for that bucket doesn't survive as a phantom. Core
    // pages a bucket from page 0 upward, so for the common single-page bucket
    // this is exactly the page that needs clearing. (A multi-page hot bucket that
    // shrinks is reconciled on the next full rebuild — bounded, rare.)
    const wrote = new Set(shards.map((s) => s.bucket))
    const emptied = dirty.filter((b) => !wrote.has(b))
    for (const bucket of emptied) {
      await deleteShard(bucket, 0).catch(() => {
        /* best-effort: index is a derived cache; a stale page self-heals on rebuild */
      })
    }
    return shards
  }

  /** Free the worker-side WASM instance. Idempotent. */
  async dispose(): Promise<void> {
    await this.#proxy.dispose()
  }
}

/**
 * Passthrough to core's LWW manifest planner. `local`/`remote` are
 * `[{bucket, page, version}]`; returns the shard coords to PUT/GET/DELETE.
 * Exposed for callers that want to converge against a remote manifest rather
 * than do a full rebuild (a future cross-device delta-sync optimization).
 */
export function syncPlan(
  local: ShardRef[],
  remote: ShardRef[],
  localIsAuthoritative: boolean,
): Promise<ShardSyncPlan> {
  return proxySyncPlan(local, remote, localIsAuthoritative)
}
