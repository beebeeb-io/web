/**
 * 2275 T5.4 (L15 option A): "Share N items with this folder".
 *
 * From R's share panel the owner gets the items in R's tree that have no wrap
 * passing L14, listed by decrypted name and path. The owner confirms all or a
 * selection, and this module publishes exactly the deduplicated
 * (id, resolved key, name) tuples it showed — no re-list at confirm. Request
 * rows and plaintext-named items are listed as "can't be shared" and refused.
 *
 * The spec calls the list the server's, so a malicious server can add a private
 * item to it; the owner sees its name before confirming (R1 class, visible).
 * Paths are labelled as reported by the server.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L14: a wrap counts only when R's inventory has it, it opens under R's
 *        proven custody key, it equals the resolver key, and the name
 *        authenticates. The second and third checks are core's
 *        `childWrapMatches`.
 *   L15: "Share N items with this folder", at most 1,000 items per run.
 */
import { fromBase64, zeroize } from './crypto'
import { listFilesPage, publishSharedFolderKeys } from './api'
import { listSharedFolderKeys } from './api-folder-links'
import { sealChildKey } from './folder-share-crypto'
import { ownedItem, type KeyOrigin, type ResolvedOwnedItem } from './owned-item'

/** At most this many items are listed per run (L15). */
export const SHARE_LIST_LIMIT = 1000
const LIST_PAGE = 500
const PUBLISH_BATCH = 1000

export type ShareCandidateStatus = 'shareable' | 'already_shared' | 'request_row' | 'plaintext_name' | 'unresolvable'

/** One item the share panel shows the owner, by name and path. */
export interface ShareCandidate {
  id: string
  isFolder: boolean
  /** The decrypted name (every name is shown; never "+N more"). */
  name: string
  /** Root-relative path segments, from the server's listing. */
  path: string[]
  status: ShareCandidateStatus
  /** The resolver key to publish, when `status === 'shareable'`. */
  key?: Uint8Array
}

/** What the panel displays: "Share N items with this folder". */
export interface ShareCandidatesResult {
  candidates: ShareCandidate[]
  /** The shareable, deduplicated selection the owner may confirm. */
  shareable: ShareCandidate[]
  /** True when R's tree holds more than one run's list limit. */
  truncated: boolean
}

/** Origins whose key the resolver proved against the row's own name. */
const PROVEN_ORIGINS: ReadonlySet<KeyOrigin> = new Set(['derived', 'owner_wrap', 'folder_wrap'])

const EMPTY_NAME = '(no name)'
const PLAINTEXT_REASON = "can't be shared"

/** The line the panel shows for a row the owner cannot share. */
export function cannotShareReason(status: ShareCandidateStatus): string | null {
  if (status === 'request_row') return `${PLAINTEXT_REASON} (received through a file request)`
  if (status === 'plaintext_name') return `${PLAINTEXT_REASON} (its name is not sealed)`
  if (status === 'unresolvable') return PLAINTEXT_REASON
  return null
}

/** Every wrap R's inventory holds, by item id. */
async function inventoryWraps(rootId: string): Promise<Map<string, Uint8Array>> {
  const wraps = new Map<string, Uint8Array>()
  let cursor: string | undefined
  do {
    const page = await listSharedFolderKeys(rootId, { limit: 500, cursor })
    for (const row of page.keys) {
      try {
        wraps.set(row.file_id, fromBase64(row.encrypted_file_key))
      } catch {
        // A row whose wrap is not base64 is simply not an L14 wrap.
      }
    }
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return wraps
}

interface ListedRow {
  id: string
  isFolder: boolean
  nameEncrypted: string
  isRequest: boolean
  ownerWrap: string | null
  folderWrap: string | null
  viewerId: string | null
  uploadedBy: string | null
  actedViaShareId: string | null
  path: string[]
}

function rowFromListing(row: Record<string, unknown>, path: string[]): ListedRow {
  return {
    id: String(row.id),
    isFolder: !!row.is_folder,
    nameEncrypted: String(row.name_encrypted ?? ''),
    isRequest: !!row.file_request_id,
    ownerWrap: (row.owner_wrapped_file_key as string | null | undefined) ?? null,
    folderWrap: null,
    viewerId: null,
    uploadedBy: (row.uploaded_by as string | null | undefined) ?? null,
    actedViaShareId: (row.acted_via_share_id as string | null | undefined) ?? null,
    path,
  }
}

async function resolveRow(row: ListedRow, args: { masterKey: Uint8Array; rootId: string; folderKey: Uint8Array }): Promise<ResolvedOwnedItem | null> {
  if (!row.nameEncrypted) return null
  try {
    return await ownedItem.resolve({
      masterKey: args.masterKey,
      itemId: row.id,
      kind: row.isFolder ? 2 : 1,
      ownerWrap: row.ownerWrap ? fromBase64(row.ownerWrap) : null,
      nameEncrypted: row.nameEncrypted,
      sharedFolderId: args.rootId,
      folderKey: args.folderKey,
      folderWrap: row.folderWrap ? fromBase64(row.folderWrap) : null,
    })
  } catch {
    return null
  }
}

/**
 * List R's tree and classify every row: shareable, already shared, or refused
 * with a reason. Reads only; publishes nothing.
 */
export async function collectShareCandidates(args: {
  rootId: string
  masterKey: Uint8Array
  folderKey: Uint8Array
  viewerId?: string | null
}): Promise<ShareCandidatesResult> {
  const { rootId, masterKey, folderKey } = args
  const viewerId = args.viewerId ?? null
  const wraps = await inventoryWraps(rootId)
  const candidates: ShareCandidate[] = []
  let truncated = false

  const queue: { id: string; path: string[] }[] = [{ id: rootId, path: [] }]
  while (queue.length > 0 && !truncated) {
    const parent = queue.shift()!
    let cursor: string | undefined
    do {
      const page = await listFilesPage({ parentId: parent.id, limit: LIST_PAGE, cursor })
      for (const listed of page.files) {
        if (candidates.length >= SHARE_LIST_LIMIT) {
          truncated = true
          break
        }
        const row = rowFromListing(listed as unknown as Record<string, unknown>, parent.path)
        row.viewerId = viewerId
        const resolved = await resolveRow(row, { masterKey, rootId, folderKey })
        const name = resolved?.name?.name ?? resolved?.name?.plaintext ?? EMPTY_NAME

        let status: ShareCandidateStatus
        if (row.isRequest) {
          status = 'request_row'
        } else if (!row.nameEncrypted.startsWith('{')) {
          // A plaintext name has no key this client can prove; never guessed.
          status = 'plaintext_name'
        } else if (!resolved) {
          status = 'unresolvable'
        } else if (!PROVEN_ORIGINS.has(resolved.origin)) {
          status = 'plaintext_name'
        } else {
          const wrapped = wraps.get(row.id)
          const proven =
            !!wrapped &&
            (await ownedItem.childWrapMatches(folderKey, rootId, row.id, row.isFolder ? 2 : 1, wrapped, resolved.key))
          status = proven ? 'already_shared' : 'shareable'
        }

        candidates.push({
          id: row.id,
          isFolder: row.isFolder,
          name,
          path: parent.path,
          status,
          key: status === 'shareable' && resolved ? resolved.key : undefined,
        })
        if (status !== 'shareable' && resolved) zeroize(resolved.key)
        if (row.isFolder) queue.push({ id: row.id, path: [...parent.path, name] })
      }
      cursor = page.next_cursor ?? undefined
    } while (cursor && !truncated)
  }

  // The count is computed on the client; the confirm list is deduplicated by id.
  const seen = new Set<string>()
  const shareable = candidates.filter((candidate) => {
    if (candidate.status !== 'shareable' || seen.has(candidate.id)) return false
    seen.add(candidate.id)
    return true
  })
  return { candidates, shareable, truncated }
}

/**
 * Publish exactly the confirmed tuples: deduplicated by id, sealed under the
 * resolver keys collected above. No listing happens here, so the server cannot
 * change what the owner confirmed.
 */
export async function publishShareCandidates(args: {
  rootId: string
  folderKey: Uint8Array
  confirmed: ShareCandidate[]
}): Promise<{ written: number }> {
  const { rootId, folderKey, confirmed } = args
  const unique = new Map<string, ShareCandidate>()
  for (const candidate of confirmed) {
    if (candidate.status !== 'shareable' || !candidate.key) continue
    if (!unique.has(candidate.id)) unique.set(candidate.id, candidate)
  }
  const entries: { file_id: string; encrypted_file_key: string }[] = []
  for (const candidate of unique.values()) {
    entries.push({
      file_id: candidate.id,
      encrypted_file_key: await sealChildKey(
        folderKey,
        { rootId, itemId: candidate.id, isFolder: candidate.isFolder },
        candidate.key!,
      ),
    })
  }
  for (let start = 0; start < entries.length; start += PUBLISH_BATCH) {
    await publishSharedFolderKeys(rootId, entries.slice(start, start + PUBLISH_BATCH))
  }
  return { written: entries.length }
}

/** Drop the resolver keys a panel collected but did not publish. */
export function disposeShareCandidates(candidates: ShareCandidate[]): void {
  for (const candidate of candidates) {
    if (candidate.key) {
      zeroize(candidate.key)
      candidate.key = undefined
    }
  }
}

/** Names the panel shows for a row's server-reported path (L15 display). */
export function sharePathLabel(candidate: ShareCandidate, rootLabel: string): string {
  return [rootLabel, ...candidate.path].join(' > ')
}
