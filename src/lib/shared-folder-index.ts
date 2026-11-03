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
import {
  filterIndexRowsForSharing,
  type IndexCandidateRow,
  type IndexRowSkipCounts,
} from './shared-index-writer'

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
  #l14Entries: readonly IndexFileEntry[] | null

  /**
   * `l14Entries` is the proof that every entry came through the L14 filter
   * (`filterIndexRowsForSharing`): only `assembleVerifiedSharedIndex` passes
   * it. An index loaded from the server's shards carries no proof, so it can
   * be searched but never written.
   */
  constructor(proxy: SearchIndexProxy, numShards: number, l14Entries: readonly IndexFileEntry[] | null = null) {
    this.#proxy = proxy
    this.numShards = numShards
    this.#l14Entries = l14Entries
  }

  /** The L14-verified entries behind this index, or null when unproven. */
  get l14Entries(): readonly IndexFileEntry[] | null {
    return this.#l14Entries
  }

  /**
   * Add or update an entry. Writes carry the same L14 duty as a push: an index
   * with no proof refuses every upsert, and a proven index accepts only an
   * entry the filter itself produced (same id and same name). A caller that
   * needs a new name rebuilds from the listing instead of upserting it in.
   */
  async upsert(fileId: string, name: string): Promise<number[]> {
    const proof = this.#l14Entries
    if (!proof) throw new UnverifiedSharedIndexError()
    if (!proof.some((entry) => entry.fileId === fileId && entry.name === name)) {
      throw new UnverifiedSharedIndexError()
    }
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

  // No `l14Entries` proof: these pages came from the server, not from this
  // client's L14 filter, so the index may be searched but not pushed.
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

/** A write refused because its index, or the entry, has no L14 proof. */
export class UnverifiedSharedIndexError extends Error {
  constructor() {
    super('shared index writes require entries built by the L14 filter (rebuildSharedIndexFromListing)')
    this.name = 'UnverifiedSharedIndexError'
  }
}

/** The only index shape a push accepts: one carrying its L14 proof. */
type PushableIndex = Pick<SharedSearchIndex, 'encryptBuckets' | 'encryptAll' | 'l14Entries'>

function assertL14Verified(index: PushableIndex): void {
  if (!index.l14Entries) throw new UnverifiedSharedIndexError()
}

export interface PushSharedIndexDeltaArgs {
  transport: IndexTransport
  index: PushableIndex
  folderKey: Uint8Array
  dirtyBuckets: number[]
}

/**
 * Encrypt and PUT the dirty buckets. A 409 re-reads the server's current
 * version and retries (at most `INDEX_CONFLICT_RETRIES` attempts per page);
 * a bucket that never lands is returned in `dirtyBuckets`.
 *
 * L14/T5.6: an index built through `rebuildSharedIndexFromListing` (its filter
 * is the only way an entry enters a written index) carries its proof; a push
 * of any other index — notably one loaded from the server, whose pages this
 * client never verified — throws `UnverifiedSharedIndexError`.
 */
export async function pushSharedIndexDelta(
  args: PushSharedIndexDeltaArgs,
): Promise<{ written: number; conflicts: number; dirtyBuckets: number[] }> {
  assertL14Verified(args.index)
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
  /** The listing rows to consider; the L14 filter decides which are indexed. */
  rows: readonly IndexCandidateRow[]
  rootId: string
  folderKey: Uint8Array
  masterKey: Uint8Array
  /** R's inventory wraps (item id -> L7 wrap). */
  wraps: ReadonlyMap<string, Uint8Array>
  numShards?: number
}

export interface RebuildSharedIndexResult {
  index: SharedSearchIndex
  truncated: boolean
  fileCount: number
  /** What the L14 filter dropped, by reason. */
  skipped: IndexRowSkipCounts
  /** The verified entries that were indexed. */
  entries: IndexFileEntry[]
}

/**
 * T5.6 / L14: build the shared index from a listing, keeping ONLY rows that
 * pass every L14 check (`filterIndexRowsForSharing`). Request rows and
 * plaintext names are never indexed; a failing row is skipped and counted.
 * Entries past `SEARCH_INDEX_MAX_ENTRIES` are dropped and reported.
 */
export async function rebuildSharedIndexFromListing(
  args: RebuildSharedIndexArgs,
): Promise<RebuildSharedIndexResult> {
  const { entries, skipped } = await filterIndexRowsForSharing(args)
  const built = await assembleVerifiedSharedIndex({ entries, numShards: args.numShards })
  return { ...built, skipped, entries }
}

/**
 * Assemble an index from entries the L14 filter already verified. Not a
 * listing writer: callers must go through `rebuildSharedIndexFromListing`.
 * Entries past `SEARCH_INDEX_MAX_ENTRIES` are dropped and reported as
 * `truncated`, so a hostile or enormous listing can never grow the index
 * without bound.
 */
export async function assembleVerifiedSharedIndex(args: {
  entries: IndexFileEntry[]
  numShards?: number
}): Promise<{ index: SharedSearchIndex; truncated: boolean; fileCount: number }> {
  const numShards = args.numShards ?? SHARED_INDEX_NUM_SHARDS
  const kept = args.entries.slice(0, SEARCH_INDEX_MAX_ENTRIES)
  const truncated = args.entries.length > SEARCH_INDEX_MAX_ENTRIES
  const proxy = await createSharedSearchIndex(kept, numShards)
  // The proof travels with the index so a push can prove its provenance.
  const index = new SharedSearchIndex(proxy, numShards, kept)
  return { index, truncated, fileCount: kept.length }
}

/** Every page the index currently holds, for a full first push. */
export async function pushSharedIndexFull(args: {
  transport: IndexTransport
  index: PushableIndex
  folderKey: Uint8Array
}): Promise<{ written: number }> {
  assertL14Verified(args.index)
  const shards = await args.index.encryptAll(args.folderKey)
  for (const shard of shards) {
    await args.transport.putShard(shard, 0)
  }
  return { written: shards.length }
}
