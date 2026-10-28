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
 * Per account (rv-web198d P3, L7c "never shared across accounts"): each account
 * has its own entry, keyed by the id of the account whose master key opened the
 * record (key-context registers that id as the provider). Every id is also kept
 * in memory for the page load, so a storage failure (full, private mode) still
 * leaves the folder L7 until a reload. Entries are cleared with the keys on
 * sign-out and on an account switch. Nothing secret is stored: folder ids only.
 */

const STORAGE_PREFIX = 'beebeeb.custodySeen.v1:'

/** The error for a folder this client has seen custody for, now answered as "no record". */
export class FolderKeysUnavailableError extends Error {
  constructor() {
    super("This folder's keys are unavailable.")
    this.name = 'FolderKeysUnavailableError'
  }
}

let accountProvider: (() => string | null) | null = null

/**
 * The account whose keys are resident (key-context). A custody record only
 * opens under a master key, so a read or mark without an account cannot happen
 * in the app; if it does, the id lives in memory only, under no account.
 */
export function setCustodyAccountProvider(fn: (() => string | null) | null): void {
  accountProvider = fn
}

function currentAccount(): string | null {
  return accountProvider?.() ?? null
}

/** This page load's copy, per account ('' = no account known). */
const inMemory = new Map<string, Set<string>>()

function memoryFor(account: string | null): Set<string> {
  const slot = account ?? ''
  let set = inMemory.get(slot)
  if (!set) {
    set = new Set()
    inMemory.set(slot, set)
  }
  return set
}

function readStored(account: string | null): Set<string> {
  if (!account) return new Set()
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + account)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function seenBy(account: string | null): Set<string> {
  return new Set([...readStored(account), ...memoryFor(account)])
}

/** Remember that `folderId` has a valid custody record. */
export function markCustodySeen(folderId: string): void {
  const account = currentAccount()
  memoryFor(account).add(folderId)
  if (!account) return
  const stored = readStored(account)
  if (stored.has(folderId)) return
  stored.add(folderId)
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + account, JSON.stringify([...stored]))
  } catch {
    // Storage full or unavailable: the in-memory copy keeps the folder L7 for
    // this page load; only the cross-reload memory is lost.
  }
}

export function hasSeenCustody(folderId: string): boolean {
  return seenBy(currentAccount()).has(folderId)
}

/** Whether this account has seen custody for any folder at all. */
export function hasSeenAnyCustody(): boolean {
  return seenBy(currentAccount()).size > 0
}

/**
 * The server says `folderId` has no custody record. Legacy is allowed only for
 * a folder this client has never seen custody for; otherwise this throws.
 */
export function assertNeverSawCustody(folderId: string): void {
  if (hasSeenCustody(folderId)) throw new FolderKeysUnavailableError()
}

/**
 * Sign-out and account switch: forget every folder of `account` (by default the
 * resident one), together with its keys. Other accounts are left alone.
 */
export function clearCustodyMemory(account: string | null = currentAccount()): void {
  inMemory.delete(account ?? '')
  if (!account) return
  try {
    globalThis.localStorage?.removeItem(STORAGE_PREFIX + account)
  } catch {
    // ignore
  }
}
