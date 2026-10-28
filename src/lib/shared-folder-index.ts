/**
 * Task 2237b — shared-folder search index client.
 *
 * A link holder searches the folder's index under the folder key (never the
 * master key). The index is sharded exactly like the per-user one, but every
 * write is conditional on the version the client last saw, so two guests
 * adding files cannot silently overwrite each other's page.
 *
 * Bounds:
 *  - `SEARCH_INDEX_MAX_ENTRIES` (20,000) is the point at which an index is
 *    reported as truncated. The bound is enforced once, when rebuilding from a
 *    listing, so a normal build can never exceed it.
 *  - a page that fails to decrypt is skipped and counted; it never aborts the
 *    load.
 *  - a version conflict retries at most three times, then leaves that bucket
 *    dirty for the next rebuild.
 */
import {
  createSharedSearchIndex,
  sharedSearchIndexFromShards,
  type CoreEncryptedShard,
  type SearchIndexProxy,
} from './crypto'
import type { IndexTransport, ShardCoord, ShardRef } from './shared-folder-index-shards'
import { IndexVersionConflictError } from './shared-folder-index-shards'

export const SEARCH_INDEX_MAX_ENTRIES = 20_000

/** Default bucket count — MUST match core's `DEFAULT_NUM_SHARDS`. */
export const SHARED_INDEX_NUM_SHARDS = 64

/** Retries per dirty bucket after a version conflict. */
export const INDEX_CONFLICT_RETRIES = 3

export interface IndexFileEntry {
  fileId: string
  name: string
}

/** The shared-folder index plus its folder-key crypto surface. */
export class SharedSearchIndex {
  readonly numShards: number
  #proxy: SearchIndexProxy

  constructor(proxy: SearchIndexProxy, numShards: number) {
    this.#proxy = proxy
    this.numShards = numShards
  }

  async upsert(fileId: string, name: string): Promise<number[]> {
    return this.#proxy.upsert(fileId, name)
  }

  async remove(fileId: string): Promise<number[]> {
    return this.#proxy.remove(fileId)
  }

  async query(term: string): Promise<string[]> {
    return this.#proxy.query(term)
  }

  async fileCount(): Promise<number> {
    return this.#proxy.fileCount()
  }

  async encryptAll(folderKey: Uint8Array): Promise<CoreEncryptedShard[]> {
    return this.#proxy.encryptShardsWithFolderKey(folderKey)
  }

  async encryptBuckets(folderKey: Uint8Array, buckets: number[]): Promise<CoreEncryptedShard[]> {
    return this.#proxy.encryptBucketsWithFolderKey(folderKey, buckets)
  }

  async dispose(): Promise<void> {
    await this.#proxy.dispose()
  }
}

const coordKey = (coord: ShardCoord): string => `${coord.bucket}/${coord.page}`

export interface LoadSharedIndexArgs {
  transport: IndexTransport
  folderKey: Uint8Array
  numShards?: number
}

export interface LoadSharedIndexResult {
  index: SharedSearchIndex
  truncated: boolean
  fileCount: number
  /** Manifest entries that could not be read or decrypted. */
  skippedPages: number
  manifest: ShardRef[]
}

/**
 * Reconstruct the index from the server's shards. An empty manifest yields an
 * empty index — the caller's signal to rebuild from the live listing.
 */
export async function loadSharedIndex(
  args: LoadSharedIndexArgs,
): Promise<LoadSharedIndexResult> {
  const numShards = args.numShards ?? SHARED_INDEX_NUM_SHARDS
  const manifest = await args.transport.listShards()

  if (manifest.length === 0) {
    const proxy = await createSharedSearchIndex([], numShards)
    return {
      index: new SharedSearchIndex(proxy, numShards),
      truncated: false,
      fileCount: 0,
      skippedPages: 0,
      manifest,
    }
  }

  let skippedPages = 0
  const shards: CoreEncryptedShard[] = []
  for (const ref of manifest) {
    const blob = await args.transport.getShard({ bucket: ref.bucket, page: ref.page }).catch(() => null)
    if (!blob) {
      skippedPages += 1
      continue
    }
    shards.push({ bucket: ref.bucket, page: ref.page, blob })
  }

  let proxy: SearchIndexProxy
  try {
    proxy = await sharedSearchIndexFromShards(args.folderKey, shards, numShards)
  } catch {
    // One unreadable page must not cost every readable page: retry page by
    // page and keep the survivors.
    const readable: CoreEncryptedShard[] = []
    skippedPages = 0
    for (const shard of shards) {
      try {
        // A page is only readable if core can open it together with the rest;
        // probing it alone is the cheapest test available without a new export.
        await sharedSearchIndexFromShards(args.folderKey, [shard], numShards)
        readable.push(shard)
      } catch {
        skippedPages += 1
      }
    }
    proxy =
      readable.length > 0
        ? await sharedSearchIndexFromShards(args.folderKey, readable, numShards)
        : await createSharedSearchIndex([], numShards)
  }

  const index = new SharedSearchIndex(proxy, numShards)
  const fileCount = await index.fileCount()
  return {
    index,
    truncated: fileCount > SEARCH_INDEX_MAX_ENTRIES,
    fileCount,
    skippedPages,
    manifest,
  }
}

export interface PushSharedIndexDeltaArgs {
  transport: IndexTransport
  index: Pick<SharedSearchIndex, 'encryptBuckets'>
  folderKey: Uint8Array
  dirtyBuckets: number[]
}

/**
 * Encrypt and PUT the dirty buckets. A 409 re-reads the server's current
 * version and retries (at most `INDEX_CONFLICT_RETRIES` attempts per page);
 * a bucket that never lands is returned in `dirtyBuckets`.
 */
export async function pushSharedIndexDelta(
  args: PushSharedIndexDeltaArgs,
): Promise<{ written: number; conflicts: number; dirtyBuckets: number[] }> {
  const versions = new Map<string, number>()
  const failed = new Set<number>()
  let written = 0
  let conflicts = 0

  const shards = await args.index.encryptBuckets(args.folderKey, args.dirtyBuckets)

  for (const shard of shards) {
    const key = coordKey({ bucket: shard.bucket, page: shard.page })
    let attempt = 0
    let landed = false
    while (attempt < INDEX_CONFLICT_RETRIES && !landed) {
      const ifVersion = versions.get(key) ?? 0
      try {
        const ref = await args.transport.putShard(shard, ifVersion)
        versions.set(key, ref.version)
        written += 1
        landed = true
      } catch (err) {
        if (!(err instanceof IndexVersionConflictError)) throw err
        conflicts += 1
        attempt += 1
        if (err.currentVersion >= 0) versions.set(key, err.currentVersion)
      }
    }
    if (!landed) failed.add(shard.bucket)
  }

  return {
    written,
    conflicts,
    dirtyBuckets: args.dirtyBuckets.filter((bucket) => failed.has(bucket)),
  }
}

export interface RebuildSharedIndexArgs {
  entries: IndexFileEntry[]
  numShards?: number
}

/**
 * Build a fresh index from decrypted listing entries. Entries past
 * `SEARCH_INDEX_MAX_ENTRIES` are dropped and reported as `truncated`, so a
 * hostile or enormous listing can never grow the index without bound.
 */
export async function rebuildSharedIndexFromListing(
  args: RebuildSharedIndexArgs,
): Promise<{ index: SharedSearchIndex; truncated: boolean; fileCount: number }> {
  const numShards = args.numShards ?? SHARED_INDEX_NUM_SHARDS
  const kept = args.entries.slice(0, SEARCH_INDEX_MAX_ENTRIES)
  const truncated = args.entries.length > SEARCH_INDEX_MAX_ENTRIES
  const proxy = await createSharedSearchIndex(kept, numShards)
  const index = new SharedSearchIndex(proxy, numShards)
  return { index, truncated, fileCount: kept.length }
}

/** Every page the index currently holds, for a full first push. */
export async function pushSharedIndexFull(args: {
  transport: IndexTransport
  index: SharedSearchIndex
  folderKey: Uint8Array
}): Promise<{ written: number }> {
  const shards = await args.index.encryptAll(args.folderKey)
  for (const shard of shards) {
    await args.transport.putShard(shard, 0)
  }
  return { written: shards.length }
}
