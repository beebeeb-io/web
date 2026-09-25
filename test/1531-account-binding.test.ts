import { describe, test, expect, beforeEach } from 'bun:test'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

// Minimal in-memory localStorage stub — see 1529-vault-empty-password.test.ts
// for why bun test needs this (no built-in localStorage global).
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

/**
 * Task 1531/1534 (P0): cross-account master-key confusion.
 *
 * Web's key-caching/persistence layer (vault.ts's password/passkey vault,
 * session-persist.ts, session-vault-cache.ts) is a SINGLE, per-origin slot —
 * not namespaced by account. Nothing verified that a resident/cached/
 * restored key actually belongs to whichever account is CURRENTLY
 * authenticated, so a passkey/password sign-in as a DIFFERENT account in the
 * same browser tab could silently keep operating under the wrong account's
 * key (login.tsx's handlePasskeyLogin `if (isUnlocked)` shortcut was the
 * most direct instance). This file exercises the storage-layer half of the
 * fix: every wrap/cache call now takes the account id it was proven for, and
 * every read rejects a stored entry that claims a DIFFERENT account.
 *
 * P0 CONTINUATION (web PR #85, crypto-security-reviewer): the vault.ts
 * password/passkey entries no longer self-heal an untagged (pre-fix) entry
 * on local proof alone either — see the dedicated describe block below for
 * why, and key-context.tsx's `unlockVault` for the server-side
 * `verifyRecoveryCheck` gate that now decides whether an untagged entry gets
 * tagged at all. session-vault-cache.ts / session-persist.ts go further
 * still: an untagged CACHED/PERSISTED key entry is deleted on read rather
 * than handed back at all (a cached/persisted entry, unlike the vault, can
 * only ever have come from a pre-1531/1534 write — every current call site
 * always supplies a real userId — so there is no legitimate "first unlock
 * since the fix shipped" case to accommodate there, unlike the vault).
 *
 * key-context.tsx's in-memory watchdog effect (which reacts to this at the
 * React layer) has no DOM/React harness under `bun test` — see
 * key-cache.ts's own doc comment for why that layer's logic is factored out
 * to be directly testable instead; this file covers the storage functions
 * that same effect and every unlock path call into.
 */
const fakeIdb = installFakeIndexedDB()
beforeEach(() => {
  fakeIdb.reset()
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

const {
  wrapAndStore,
  unwrap,
  wrapAndStoreWithPasskey,
  unwrapWithPasskey,
  tagVaultEntry,
  tagPasskeyVaultEntry,
} = await import('../src/lib/vault')
const { initSessionVault, cacheVaultKey, getVaultKey } = await import('../src/lib/session-vault-cache')
const { persistSession, restoreSession } = await import('../src/lib/session-persist')
const { isKeyBoundToUser } = await import('../src/lib/key-context')

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

const ACCOUNT_A = 'user-aaaaaaaa-0000-0000-0000-000000000000'
const ACCOUNT_B = 'user-bbbbbbbb-0000-0000-0000-000000000000'

/**
 * Writes an UNTAGGED 'master' vault entry directly on disk, bypassing
 * wrapAndStore (which always tags userId now) — reproduces the on-disk shape
 * a device that predates task 1531/1534 would already have. Shared helper
 * for every "untagged entry" test below.
 */
async function writeUntaggedVaultEntry(masterKey: Uint8Array, password: string): Promise<void> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('beebeeb_vault', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKeyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 600_000, hash: 'SHA-256' },
    wrappingKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    wrappingKey,
    masterKey as unknown as BufferSource,
  )
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    masterKey as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const keyCheck = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode('beebeeb-vault-check')),
  )
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    const req = tx.objectStore('keys').put({ id: 'master', wrappedKey, salt, nonce, keyCheck, checked: true })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  db.close()
}

describe('task 1531/1534 (P0): vault.ts password-vault rejects a right-password-wrong-account unwrap', () => {
  test('unwrap(rightPassword, wrongExpectedUserId) returns null even though the password IS correct', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'shared-password-123', ACCOUNT_A)

    // Same password (e.g. reused across two accounts by the same human), but
    // asking to unlock as B while this entry is A's.
    expect(await unwrap('shared-password-123', ACCOUNT_B)).toBeNull()
    // A's own unlock still works — this isn't a general breakage.
    expect(await unwrap('shared-password-123', ACCOUNT_A)).toEqual({ key, untagged: false })
  })

  test('unwrap(rightPassword, matchingUserId) succeeds normally', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', ACCOUNT_A)
    expect(await unwrap('a-real-password-123', ACCOUNT_A)).toEqual({ key, untagged: false })
  })
})

/**
 * P0 CONTINUATION (web PR #85, crypto-security-reviewer): the ORIGINAL
 * 1531/1534 fix (above) still let an UNTAGGED pre-fix entry be adopted +
 * silently re-stamped on the local password/keyCheck alone — but that local
 * proof only shows "this password unwraps SOME account's vault", not
 * SPECIFICALLY the account asking. Two DIFFERENT beebeeb accounts on the SAME
 * device, sharing a password (plausible — humans reuse passwords), would let
 * account B's login silently adopt account A's still-untagged key and
 * PERMANENTLY re-tag it for B — after which A's OWN correct password no
 * longer unlocks A's own vault. vault.ts no longer performs this self-heal
 * at all: `unwrap`/`unwrapWithPasskey` return `untagged: true` and do NOT
 * write anything; only an explicit `tagVaultEntry`/`tagPasskeyVaultEntry`
 * call (which key-context.tsx only makes after a server-side
 * `verifyRecoveryCheck` proof — see key-context.tsx's `unlockVault`) may tag
 * it. This file covers the storage-layer contract; the server-verification
 * decision itself is key-context.tsx logic with no DOM/React harness here
 * (see 1531-cross-account-key.spec.ts for the end-to-end proof).
 */
describe('task 1531/1534 P0 continuation (web #85): vault.ts NEVER self-heals an untagged entry', () => {
  test('unwrap on an untagged entry returns { untagged: true } and does NOT write anything — repeated calls stay untagged', async () => {
    const key = randomKey()
    await writeUntaggedVaultEntry(key, 'legacy-password-123')

    // Account A's login attempt: local proof succeeds, but vault.ts refuses
    // to silently decide this is A's — it hands the decision up.
    expect(await unwrap('legacy-password-123', ACCOUNT_A)).toEqual({ key, untagged: true })
    // Nothing was written by that call: a SECOND read (as a DIFFERENT
    // account, B) sees the exact same untagged state — not "already claimed
    // by A". This is the actual bug fix: the OLD code would have silently
    // tagged it for A on the first call, permanently locking B out of an
    // entry that (for all vault.ts can prove) might equally be B's.
    expect(await unwrap('legacy-password-123', ACCOUNT_B)).toEqual({ key, untagged: true })
  })

  test('tagVaultEntry stamps the entry — ONLY after that does a cross-account unwrap get rejected', async () => {
    const key = randomKey()
    await writeUntaggedVaultEntry(key, 'legacy-password-123')

    // Still untagged before any explicit tag call.
    expect(await unwrap('legacy-password-123', ACCOUNT_A)).toEqual({ key, untagged: true })

    // Simulates key-context.tsx's unlockVault AFTER verifyRecoveryCheck
    // returned true for A.
    await tagVaultEntry(ACCOUNT_A)

    expect(await unwrap('legacy-password-123', ACCOUNT_B)).toBeNull()
    expect(await unwrap('legacy-password-123', ACCOUNT_A)).toEqual({ key, untagged: false })
  })

  test('unwrapWithPasskey on an untagged entry returns { untagged: true } and does NOT write anything', async () => {
    const key = randomKey()
    const wrapKey = crypto.getRandomValues(new Uint8Array(32))
    // wrapAndStoreWithPasskey always tags now — write the untagged shape
    // directly, same technique as writeUntaggedVaultEntry but for the
    // passkey entry id.
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const cryptoKey = await crypto.subtle.importKey('raw', wrapKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt'])
    const wrappedKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
      cryptoKey,
      key as unknown as BufferSource,
    )
    const hmacKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const keyCheck = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode('beebeeb-vault-check')))
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('beebeeb_vault', 1)
      req.onupgradeneeded = () => {
        const database = req.result
        if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      const req = tx.objectStore('keys').put({ id: 'master-passkey', wrappedKey, salt: new Uint8Array(0), nonce, keyCheck })
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    db.close()

    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_A)).toEqual({ key, untagged: true })
    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_B)).toEqual({ key, untagged: true })

    await tagPasskeyVaultEntry(ACCOUNT_A)
    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_B)).toBeNull()
    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_A)).toEqual({ key, untagged: false })
  })
})

describe('task 1531/1534 (P0): vault.ts passkey-vault rejects a wrong-account unwrap', () => {
  test('unwrapWithPasskey(rightWrapKey, wrongExpectedUserId) returns null', async () => {
    const key = randomKey()
    const wrapKey = crypto.getRandomValues(new Uint8Array(32))
    await wrapAndStoreWithPasskey(key, wrapKey, ACCOUNT_A)

    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_B)).toBeNull()
    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_A)).toEqual({ key, untagged: false })
  })
})

describe('task 1531/1534 (P0): the persisted/cached key stores stamp + return the account id', () => {
  test('session-vault-cache: cacheVaultKey/getVaultKey round-trip the userId alongside the key', async () => {
    const key = randomKey()
    await initSessionVault()
    await cacheVaultKey(key, ACCOUNT_A)

    const restored = await getVaultKey()
    expect(restored).toEqual({ key, userId: ACCOUNT_A })
    // The caller (key-context.tsx's watchdog effect) is what actually
    // REJECTS a mismatch (a purely local ref comparison, not re-testable
    // here without a DOM/React harness — see this file's own header
    // comment) — but it can only do that if the id round-trips correctly,
    // which is what this asserts.
    expect(restored?.userId).not.toBe(ACCOUNT_B)
  })

  test('session-persist: persistSession/restoreSession round-trip the userId alongside the key', async () => {
    const key = randomKey()
    await persistSession(key, ACCOUNT_A)

    const restored = await restoreSession()
    expect(restored).toEqual({ key, userId: ACCOUNT_A })
    expect(restored?.userId).not.toBe(ACCOUNT_B)
  })
})

/**
 * Strips the `userId` field from an already-written cache/persist entry,
 * in place, WITHOUT touching the encrypted payload — reproduces the exact
 * on-disk shape a pre-1531/1534 write left behind (every CURRENT call site
 * always supplies a real userId, so this is the only way to get an untagged
 * entry back on disk for a test). Generic over the small differences
 * between the two stores' schemas.
 */
async function stripUserId(dbName: string, storeName: string, entryId: string): Promise<void> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const entry: Record<string, unknown> = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(entryId)
    req.onsuccess = () => resolve(req.result as Record<string, unknown>)
    req.onerror = () => reject(req.error)
  })
  delete entry.userId
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  db.close()
}

/**
 * P0 CONTINUATION (web PR #85, crypto-security-reviewer): "Untagged
 * session-persist and session-cache entries: DELETE on read (don't load
 * then lock)." Before this, `getVaultKey`/`restoreSession` handed back
 * `{ key, userId: null }` for an untagged entry and left the CALLER
 * (key-context.tsx's boot effect) to load the key into `masterKeyRef`
 * first and only lock it moments later once the watchdog effect noticed the
 * mismatch — a real window where an unbound key sat resident and callable.
 * Since a cache/persist entry can ONLY be untagged as a pre-1531/1534
 * leftover (every current writer always supplies a real userId), there is
 * no legitimate case to preserve here — it is simply stale and is deleted
 * outright, never handed back at all.
 */
describe('task 1531/1534 P0 continuation (web #85): an untagged cache/persist entry is deleted on read, never loaded', () => {
  test('session-vault-cache: getVaultKey deletes an untagged entry and returns null (not the key)', async () => {
    const key = randomKey()
    await initSessionVault()
    await cacheVaultKey(key, ACCOUNT_A)
    await stripUserId('beebeeb_session_cache', 'cache', 'master')

    // Not handed back — not even alongside userId: null.
    expect(await getVaultKey()).toBeNull()
    // And it's actually gone, not just filtered — a second read (which would
    // re-decrypt if the entry were still there) still comes back null.
    expect(await getVaultKey()).toBeNull()
  })

  test('session-persist: restoreSession deletes an untagged entry and returns null (not the key)', async () => {
    const key = randomKey()
    await persistSession(key, ACCOUNT_A)
    await stripUserId('beebeeb_session_persist', 'session', 'persist')

    expect(await restoreSession()).toBeNull()
    expect(await restoreSession()).toBeNull()
  })
})

/**
 * P1 (crypto-security-reviewer, web PR #85): `getMasterKey`/`getFileKey`/
 * `getFileKeyForFile` (key-context.tsx) must refuse an UNBOUND key —
 * `residentKeyUserIdRef.current !== target user_id` — not just "is some key
 * resident". `isKeyBoundToUser` is the exact pure boolean those accessors'
 * guard is built on (`if (!isBoundTo(expectedUserId)) throw ...`), factored
 * out for direct testing since key-context.tsx itself is a React component
 * with no DOM/React-rendering harness here.
 */
describe('task 1531/1534 P0 continuation (web #85), crypto-security-reviewer P1: isKeyBoundToUser — the getMasterKey guard', () => {
  test('no key resident → never bound, regardless of ids matching', () => {
    expect(isKeyBoundToUser(false, null, null)).toBe(false)
    expect(isKeyBoundToUser(false, ACCOUNT_A, ACCOUNT_A)).toBe(false)
  })

  test('key resident but tagged for a DIFFERENT account than the target → NOT bound (the exact cross-account case)', () => {
    expect(isKeyBoundToUser(true, ACCOUNT_A, ACCOUNT_B)).toBe(false)
  })

  test('key resident, tag matches the target exactly → bound', () => {
    expect(isKeyBoundToUser(true, ACCOUNT_A, ACCOUNT_A)).toBe(true)
  })

  test('key resident but UNTAGGED (residentUserId null) against a real target → NOT bound (fail closed, never auto-trusted)', () => {
    expect(isKeyBoundToUser(true, null, ACCOUNT_A)).toBe(false)
  })

  test('key resident, tag real, but target unknown (null — e.g. auth still loading) → NOT bound', () => {
    // This is the exact window search-index-context.tsx's boot effect used
    // to race through: `isUnlocked` could already read true (a key WAS
    // resident) before `user` resolved from useAuth()'s getMe() round trip.
    // targetUserId is `user?.user_id ?? null` at that point — null, not
    // "unknown, so trust it" — so this must read NOT bound.
    expect(isKeyBoundToUser(true, ACCOUNT_A, null)).toBe(false)
  })

  test('nothing resident AND nothing authenticated → both null → still NOT bound (no key to hand out regardless)', () => {
    expect(isKeyBoundToUser(false, null, null)).toBe(false)
  })
})
