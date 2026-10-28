/**
 * Decision L7c (plan C): custody is monotonic per client. Decision L7d: the
 * memory belongs to the DEVICE, and nothing the server says can shrink it.
 *
 * The server is untrusted. A folder's wrap format follows its custody record
 * (L7b): a record means L7, no record means a flag-off invite-only share read
 * with the legacy (unbound) reader. Without memory, a server that once served
 * a custody record could later answer 404 / 405 / 501 and push this client
 * onto the legacy reader, where a replayed unbound wrap publishes item A's
 * plaintext as item B.
 *
 * So once this client has seen a VALID custody record for a folder (the
 * owner's copy opened under the L6 key, or a member's custody answer that
 * resolved its folder key), the folder id is remembered DURABLY. From then on
 * "no record" for it, or for any folder under it, is FolderKeysUnavailableError,
 * never the legacy reader.
 *
 * L7d: one localStorage key (`beebeeb.custodySeen.v1`), a JSON array of
 * canonical (lower-case) folder UUIDs, shared by every account on this device.
 * Per account it could be emptied by the server: a forced sign-out, a
 * re-login, or another account id would start an empty memory and allow the
 * downgrade (proven on mobile and CLI). So sign-out, sign-in and an account
 * switch never clear it; only the user clearing site data does.
 *
 * The id is recorded BEFORE any key from the custody record is used. On web
 * (lead clarification of L7d, 2026-10-28), storage that can't be used
 * (blocked by browser policy or private mode, or full) means no DURABLE
 * memory: the id is kept in memory, the key is used, and nothing refuses. A
 * browser that can't persist the set can be downgraded after a reload
 * whatever this does (the new-device residual), so refusing would gain no
 * security and break every shared folder for those users. Only a stored value
 * that exists but is not an array of canonical UUIDs refuses: that could be
 * local tampering, and it might have held any folder, so it counts as all of
 * them (legacy refused) and is never overwritten. Ids are stored and
 * looked up in their canonical lower-case hyphenated form, whatever form the
 * server sent; an id that is no UUID refuses. Every id is also kept in memory
 * for the page load, so after a failed write the folder still refuses legacy
 * until a reload. Nothing secret is stored: folder ids only.
 */

const STORAGE_KEY = 'beebeeb.custodySeen.v1'
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The error for a folder this client has seen custody for, now answered as "no record". */
export class FolderKeysUnavailableError extends Error {
  constructor() {
    super("This folder's keys are unavailable.")
    this.name = 'FolderKeysUnavailableError'
  }
}

/** This page load's copy (canonical ids), persisted or not. */
const inMemory = new Set<string>()

/**
 * A folder id in its canonical form (lower-case, hyphenated), whatever form the
 * server sent: its UUID parser also takes the simple (32 hex), braced and
 * `urn:uuid:` forms, so a seen folder must not slip past the set in one of
 * them. Null when the id is no UUID at all: such an id counts as seen (it
 * refuses) and is never stored.
 */
function parseFolderId(folderId: string): string | null {
  let id = folderId
  if (id.length === 45 && id.slice(0, 9).toLowerCase() === 'urn:uuid:') id = id.slice(9)
  else if (id.length === 38 && id.startsWith('{') && id.endsWith('}')) id = id.slice(1, -1)
  if (id.length === 32 && /^[0-9a-f]{32}$/i.test(id)) {
    const hex = id.toLowerCase()
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  const lower = id.toLowerCase()
  return CANONICAL_UUID.test(lower) ? lower : null
}

/**
 * The durable set. `unreadable` is a stored value that exists but is not an
 * array of canonical UUIDs: it might have held any folder, so it counts as
 * all of them. Storage that can't be read at all (blocked) has no durable set:
 * the in-memory copy is all there is, as on a new device.
 */
function readStored(): { ids: Set<string>; unreadable: boolean } {
  let raw: string | null | undefined
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY)
  } catch {
    return { ids: new Set(), unreadable: false }
  }
  if (raw === null || raw === undefined) return { ids: new Set(), unreadable: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string' && CANONICAL_UUID.test(id))) {
      return { ids: new Set(parsed as string[]), unreadable: false }
    }
  } catch {
    // fall through: unreadable
  }
  return { ids: new Set(), unreadable: true }
}

/**
 * Remember that `folderId` has a valid custody record. Only ever adds. Call it
 * BEFORE the record's key is used. It throws FolderKeysUnavailableError only
 * for an id that is no UUID (never stored). When storage can't take the id
 * (blocked, full) or holds an unreadable value (never overwritten), the id is
 * kept in memory only and the caller goes on.
 */
export function markCustodySeen(folderId: string): void {
  const id = parseFolderId(folderId)
  if (!id) throw new FolderKeysUnavailableError()
  inMemory.add(id)
  const stored = readStored()
  if (stored.unreadable || stored.ids.has(id)) return
  stored.ids.add(id)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...stored.ids].sort()))
  } catch {
    // No durable memory on this browser: the in-memory copy keeps the folder
    // L7 for this page load (the new-device residual after a reload).
  }
}

/** Seen with custody, in any form of its id. An id that is no UUID counts as seen. */
export function hasSeenCustody(folderId: string): boolean {
  const id = parseFolderId(folderId)
  if (!id || inMemory.has(id)) return true
  const stored = readStored()
  return stored.unreadable || stored.ids.has(id)
}

/** Whether this device has seen custody for any folder at all. */
export function hasSeenAnyCustody(): boolean {
  if (inMemory.size > 0) return true
  const stored = readStored()
  return stored.unreadable || stored.ids.size > 0
}

/**
 * The server says `folderId` has no custody record. Legacy is allowed only for
 * a folder this client has never seen custody for; otherwise this throws.
 */
export function assertNeverSawCustody(folderId: string): void {
  if (hasSeenCustody(folderId)) throw new FolderKeysUnavailableError()
}

/** How far up the ancestor walk goes; a deeper chain can't be cleared, so it refuses. */
const MAX_ANCESTOR_WALK = 64

/**
 * L7d: legacy is refused when ANY ancestor of the item is in the set, not only
 * the root a shared-root walk stopped at (a server can make that walk stop
 * early, e.g. with an invite on an inner folder). Walks up from `startId`
 * (the item's folder, or the root itself) through every parent. A parent this
 * account can't see (403 / 404: above a member's shared root) ends the walk;
 * any other failure refuses. With nothing in the set, it asks nothing.
 */
export async function assertNoSeenAncestor(
  startId: string,
  parentOf: (id: string) => Promise<string | null>,
): Promise<void> {
  // An id that is no UUID refuses even with nothing in the set.
  if (!parseFolderId(startId)) throw new FolderKeysUnavailableError()
  if (!hasSeenAnyCustody()) return
  let cursor: string | null = startId
  for (let depth = 0; cursor; depth += 1) {
    if (depth >= MAX_ANCESTOR_WALK || hasSeenCustody(cursor)) throw new FolderKeysUnavailableError()
    try {
      cursor = await parentOf(cursor)
    } catch (error) {
      const status = (error as { status?: unknown } | null | undefined)?.status
      if (status === 403 || status === 404) return
      throw error
    }
  }
}

/** Test hook only: what a page reload does to this module (the durable set stays). */
export function forgetPageMemoryForTests(): void {
  inMemory.clear()
}

/** Test hook only. No product code shrinks the set (L7d); a guard test pins it. */
export function resetCustodyMemoryForTests(): void {
  inMemory.clear()
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
