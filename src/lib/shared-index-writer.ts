/**
 * 2275 T5.6 / L14 — the shared-folder search index is written ONLY from rows
 * that pass all four L14 checks. An index entry is a name→id pair a link
 * holder will act on, so anything this client cannot prove is left out and
 * counted:
 *
 *  1. R's own inventory carries an L7 wrap for (R, X, kind);
 *  2. that wrap opens under R's proven custody key;
 *  3. the opened key equals the resolver's key for X (constant time, in core),
 *  4. X's name authenticates under that path.
 *
 * Request rows and plaintext names are never indexed. A failing row is
 * skipped and counted; nothing about it is published.
 */
import { zeroize } from './crypto'
import { ownedItem, type KeyOrigin } from './owned-item'
import type { IndexFileEntry } from './shared-folder-index'

/** Origins whose key this client can prove is the item's own (L12). */
const PROVEN_ORIGINS: ReadonlySet<KeyOrigin> = new Set<KeyOrigin>([
  'derived',
  'owner_wrap',
  'folder_wrap',
])

/** One listing row, as the server sent it (never trusted on its own). */
export interface IndexCandidateRow {
  id: string
  nameEncrypted?: string | null
  isFolder?: boolean
  /** Set on a request-upload row: always refused, never indexed. */
  fileRequestId?: string | null
}

export interface IndexRowSkipCounts {
  requestRow: number
  plaintextName: number
  noWrap: number
  unproven: number
}

export interface FilterIndexRowsArgs {
  rows: readonly IndexCandidateRow[]
  /** The shared root R whose inventory wraps are being checked. */
  rootId: string
  folderKey: Uint8Array
  masterKey: Uint8Array
  /** R's inventory: item id -> the L7 wrap the server holds for it. */
  wraps: ReadonlyMap<string, Uint8Array>
}

export interface FilterIndexRowsResult {
  entries: IndexFileEntry[]
  skipped: IndexRowSkipCounts
}

/** True when core's resolver returns a name that authenticated. */
function authenticatedName(resolved: {
  name: { name?: string | null; plaintext?: string | null } | null
}): string | null {
  return resolved.name?.name ?? resolved.name?.plaintext ?? null
}

/**
 * Apply the four L14 checks to every candidate. Order matters only for the
 * counts: a request row or a plaintext name never reaches core at all.
 */
export async function filterIndexRowsForSharing(
  args: FilterIndexRowsArgs,
): Promise<FilterIndexRowsResult> {
  const entries: IndexFileEntry[] = []
  const skipped: IndexRowSkipCounts = { requestRow: 0, plaintextName: 0, noWrap: 0, unproven: 0 }

  for (const row of args.rows) {
    if (row.fileRequestId) {
      skipped.requestRow += 1
      continue
    }
    const nameEncrypted = row.nameEncrypted?.trim() ?? ''
    // A plaintext name is not a name this client can authenticate: never indexed.
    if (!nameEncrypted.startsWith('{')) {
      skipped.plaintextName += 1
      continue
    }
    const wrap = args.wraps.get(row.id)
    if (!wrap) {
      skipped.noWrap += 1
      continue
    }

    const kind = row.isFolder ? 2 : 1
    let resolved
    try {
      resolved = await ownedItem.resolve({
        masterKey: args.masterKey,
        itemId: row.id,
        kind,
        nameEncrypted,
        sharedFolderId: args.rootId,
        folderKey: args.folderKey,
        folderWrap: wrap,
      })
    } catch {
      // Checks 2 and 4 failed: the wrap did not open or the name did not authenticate.
      skipped.unproven += 1
      continue
    }

    let matches = false
    try {
      if (PROVEN_ORIGINS.has(resolved.origin)) {
        const name = authenticatedName(resolved)
        if (name !== null) {
          matches = await ownedItem.childWrapMatches(
            args.folderKey,
            args.rootId,
            row.id,
            kind,
            wrap,
            resolved.key,
          )
          if (matches) entries.push({ fileId: row.id, name })
        }
      }
    } catch {
      matches = false
    } finally {
      zeroize(resolved.key)
      if (resolved.contentKey) zeroize(resolved.contentKey)
    }
    if (!matches) skipped.unproven += 1
  }

  return { entries, skipped }
}
