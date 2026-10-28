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
 * As merged in plan C: the id is written BEFORE any key from the custody
 * record is used, and a failed write refuses (the caller does not use the
 * key). An unreadable set (a stored value that is not an array of canonical
 * UUIDs, or storage that can't be read at all) counts as "every folder seen":
 * legacy is refused, and the value is never overwritten. Only canonical
 * lower-case hyphenated UUIDs are accepted. Every id is also kept in memory
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

/** The custody record was valid, but this device could not record it: its key is not used. */
export class CustodyMemoryWriteError extends FolderKeysUnavailableError {
  constructor() {
    super()
    this.message = "This device couldn't save this folder's sharing state, so it won't open it."
    this.name = 'CustodyMemoryWriteError'
  }
}

/** This page load's copy (canonical ids), persisted or not. */
const inMemory = new Set<string>()

function canonical(folderId: string): string {
  return folderId.toLowerCase()
}

/**
 * The durable set. `unreadable` is storage that can't be read (blocked), or a
 * stored value that is not an array of canonical UUIDs: it might have held
 * any folder, so it counts as all of them.
 */
function readStored(): { ids: Set<string>; unreadable: boolean } {
  let raw: string | null | undefined
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY)
  } catch {
    return { ids: new Set(), unreadable: true }
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
 * BEFORE the record's key is used: it throws CustodyMemoryWriteError when the
 * device can't record it durably (then the key must not be used), and
 * FolderKeysUnavailableError for an id that is not a canonical folder UUID.
 */
export function markCustodySeen(folderId: string): void {
  const id = canonical(folderId)
  if (!CANONICAL_UUID.test(id)) throw new FolderKeysUnavailableError()
  // First in memory: even if the durable write fails, legacy stays refused.
  inMemory.add(id)
  // No storage API at all (tests, server-side render): memory is all there is.
  const store = globalThis.localStorage
  if (!store) return
  const stored = readStored()
  // An unreadable set is never replaced (that could shrink it), so the id
  // can't be recorded: refuse.
  if (stored.unreadable) throw new CustodyMemoryWriteError()
  if (stored.ids.has(id)) return
  stored.ids.add(id)
  try {
    store.setItem(STORAGE_KEY, JSON.stringify([...stored.ids].sort()))
  } catch {
    throw new CustodyMemoryWriteError()
  }
}

export function hasSeenCustody(folderId: string): boolean {
  if (inMemory.has(canonical(folderId))) return true
  const stored = readStored()
  return stored.unreadable || stored.ids.has(canonical(folderId))
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
