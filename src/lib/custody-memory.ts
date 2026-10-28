/**
 * Decision L7c (plan C): custody is monotonic per client.
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
 * resolved its folder key), the folder id is remembered DURABLY (localStorage,
 * read on every call, so it survives a reload). From then on a "no record"
 * answer for it is FolderKeysUnavailableError, never the legacy reader.
 *
 * The entries state a fact about a folder, not about an account (a shared
 * folder's id is unique), so they only ever make a client stricter. They are
 * cleared with the keys on sign-out and on an account switch (key-context).
 * Nothing secret is stored: folder ids only.
 */

const STORAGE_KEY = 'beebeeb.custodySeen.v1'

/** The error for a folder this client has seen custody for, now answered as "no record". */
export class FolderKeysUnavailableError extends Error {
  constructor() {
    super("This folder's keys are unavailable.")
    this.name = 'FolderKeysUnavailableError'
  }
}

function read(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Remember that `folderId` has a valid custody record. */
export function markCustodySeen(folderId: string): void {
  const seen = read()
  if (seen.has(folderId)) return
  seen.add(folderId)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {
    // Storage full or unavailable: the folder is still L7 for this page load
    // (the caller had a record); only the cross-reload memory is lost.
  }
}

export function hasSeenCustody(folderId: string): boolean {
  return read().has(folderId)
}

/**
 * The server says `folderId` has no custody record. Legacy is allowed only for
 * a folder this client has never seen custody for; otherwise this throws.
 */
export function assertNeverSawCustody(folderId: string): void {
  if (hasSeenCustody(folderId)) throw new FolderKeysUnavailableError()
}

/** Sign-out and account switch: forget every folder, together with the keys. */
export function clearCustodyMemory(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
