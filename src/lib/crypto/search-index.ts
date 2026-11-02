// Encrypted search-index construction and querying over core-provided shards.
import { withProxy } from './service'

// ─── Search index (shared core WasmSearchIndex, handle-addressed) ───────────
//
// Like the streaming encryptor, `WasmSearchIndex` is a worker-owned stateful
// struct (a pointer into the worker's WASM linear memory) that cannot cross
// Comlink. The worker keeps the instance in a registry and hands back an opaque
// numeric handle; this proxy mirrors the handle on the main thread and round-
// trips it on every op. The master key crosses as 32 raw bytes; ALL crypto
// (per-shard key derivation, AES-256-GCM) runs in core.

/** An encrypted shard page exactly as core produces / consumes it. */
export interface CoreEncryptedShard {
  bucket: number
  page: number
  /** Opaque `nonce||ciphertext||tag` core ciphertext — never parsed in JS. */
  blob: Uint8Array
}

/**
 * Main-thread proxy over a worker-owned `WasmSearchIndex`. One proxy = one
 * index, single consumer. Call `dispose()` to free the worker-side instance
 * when the vault locks.
 */
export class SearchIndexProxy {
  #handle: number
  #disposed = false

  constructor(handle: number) {
    this.#handle = handle
  }

  /** Insert/update a file name. Returns the dirty bucket set. */
  async upsert(fileId: string, name: string): Promise<number[]> {
    return withProxy((p) => p.searchIndexUpsert(this.#handle, fileId, name))
  }

  /** Remove a file. Returns the dirty bucket set. */
  async remove(fileId: string): Promise<number[]> {
    return withProxy((p) => p.searchIndexRemove(this.#handle, fileId))
  }

  /** Query the index; returns matching file_ids. */
  async query(term: string): Promise<string[]> {
    return withProxy((p) => p.searchIndexQuery(this.#handle, term))
  }

  /** Encrypt EVERY non-empty shard page for a full rebuild push. */
  async encryptShards(masterKey: Uint8Array): Promise<CoreEncryptedShard[]> {
    return withProxy((p) => p.searchIndexEncryptShards(this.#handle, masterKey))
  }

  /** Encrypt only the dirty buckets for an incremental sync. */
  async encryptBuckets(masterKey: Uint8Array, buckets: number[]): Promise<CoreEncryptedShard[]> {
    return withProxy((p) => p.searchIndexEncryptBuckets(this.#handle, masterKey, buckets))
  }

  /** Encrypt every non-empty shard page under a shared folder key (2237b). */
  async encryptShardsWithFolderKey(folderKey: Uint8Array): Promise<CoreEncryptedShard[]> {
    return withProxy((p) => p.searchIndexEncryptShardsWithFolderKey(this.#handle, folderKey))
  }

  /** Encrypt only the dirty buckets under a shared folder key (2237b). */
  async encryptBucketsWithFolderKey(
    folderKey: Uint8Array,
    buckets: number[],
  ): Promise<CoreEncryptedShard[]> {
    return withProxy((p) => p.searchIndexEncryptBucketsWithFolderKey(this.#handle, folderKey, buckets))
  }

  /** Bucket count of this index. */
  async numShards(): Promise<number> {
    return withProxy((p) => p.searchIndexNumShards(this.#handle))
  }

  /** Number of indexed files. */
  async fileCount(): Promise<number> {
    return withProxy((p) => p.searchIndexFileCount(this.#handle))
  }

  /** Free the worker-side instance. Idempotent; never throws. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    try {
      await withProxy((p) => p.searchIndexDispose(this.#handle))
    } catch (err) {
      console.warn('[crypto] search index dispose failed', err)
    }
  }
}

/** Create a fresh empty search index with `numShards` buckets. */
export async function createSearchIndex(numShards: number): Promise<SearchIndexProxy> {
  const handle = await withProxy((p) => p.searchIndexNew(numShards))
  return new SearchIndexProxy(handle)
}

/** Build a search index from `[{fileId, name}]` pairs. */
export async function buildSearchIndex(
  files: Array<{ fileId: string; name: string }>,
  numShards: number,
): Promise<SearchIndexProxy> {
  const handle = await withProxy((p) => p.searchIndexBuild(files, numShards))
  return new SearchIndexProxy(handle)
}

/**
 * Reconstruct a search index from encrypted shards, decrypting each with the
 * 32-byte master key (in core).
 */
export async function searchIndexFromShards(
  masterKey: Uint8Array,
  shards: CoreEncryptedShard[],
  numShards: number,
): Promise<SearchIndexProxy> {
  const handle = await withProxy((p) => p.searchIndexFromShards(masterKey, shards, numShards))
  return new SearchIndexProxy(handle)
}

/**
 * A fresh shared-folder index built from `[{fileId, name}]` pairs (2237b).
 * The names come from decrypted listings, so no key is needed to build; the
 * shards are encrypted under the folder key on push.
 */
export async function createSharedSearchIndex(
  files: Array<{ fileId: string; name: string }>,
  numShards: number,
): Promise<SearchIndexProxy> {
  return buildSearchIndex(files, numShards)
}

/**
 * Reconstruct a shared-folder index from shards encrypted under its folder key
 * (2237b). Mirrors `searchIndexFromShards`, which is master-key only.
 */
export async function sharedSearchIndexFromShards(
  folderKey: Uint8Array,
  shards: CoreEncryptedShard[],
  numShards: number,
): Promise<SearchIndexProxy> {
  const handle = await withProxy((p) =>
    p.searchIndexFromShardsWithFolderKey(folderKey, shards, numShards),
  )
  return new SearchIndexProxy(handle)
}

/** A shard coordinate (bucket, page) — no version. */
export interface ShardCoordinate {
  bucket: number
  page: number
}

/** The result of `searchIndexSyncPlan` — shard coords to converge local↔remote. */
export interface ShardSyncPlan {
  toPut: ShardCoordinate[]
  toGet: ShardCoordinate[]
  toDelete: ShardCoordinate[]
}

/**
 * Pure manifest-diff (LWW) → which shards to PUT/GET/DELETE to converge the
 * client's `local` shard set with the server `remote` manifest. Runs the core
 * `search_sync::diff_manifest` planner. `local`/`remote` are
 * `[{bucket, page, version}]`.
 */
export async function searchIndexSyncPlan(
  local: Array<{ bucket: number; page: number; version: number }>,
  remote: Array<{ bucket: number; page: number; version: number }>,
  localIsAuthoritative: boolean,
): Promise<ShardSyncPlan> {
  return withProxy((p) => p.searchIndexSyncPlan(local, remote, localIsAuthoritative))
}
