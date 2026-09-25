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
 * every read rejects a stored entry that claims a DIFFERENT account —
 * except a pre-fix, never-tagged vault entry, which vault.ts trusts ONCE
 * (the password/keyCheck already constitute a real proof) and immediately
 * re-stamps, so existing users are not locked out of their own correct
 * password by this fix. key-context.tsx's in-memory watchdog effect (which
 * reacts to this at the React layer) has no DOM/React harness under
 * `bun test` — see key-cache.ts's own doc comment for why that layer's
 * logic is factored out to be directly testable instead; this file covers
 * the storage functions that same effect and every unlock path call into.
 */
const fakeIdb = installFakeIndexedDB()
beforeEach(() => {
  fakeIdb.reset()
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

const { wrapAndStore, unwrap, wrapAndStoreWithPasskey, unwrapWithPasskey } = await import('../src/lib/vault')
const { initSessionVault, cacheVaultKey, getVaultKey } = await import('../src/lib/session-vault-cache')
const { persistSession, restoreSession } = await import('../src/lib/session-persist')

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

const ACCOUNT_A = 'user-aaaaaaaa-0000-0000-0000-000000000000'
const ACCOUNT_B = 'user-bbbbbbbb-0000-0000-0000-000000000000'

describe('task 1531/1534 (P0): vault.ts password-vault rejects a right-password-wrong-account unwrap', () => {
  test('unwrap(rightPassword, wrongExpectedUserId) returns null even though the password IS correct', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'shared-password-123', ACCOUNT_A)

    // Same password (e.g. reused across two accounts by the same human), but
    // asking to unlock as B while this entry is A's.
    expect(await unwrap('shared-password-123', ACCOUNT_B)).toBeNull()
    // A's own unlock still works — this isn't a general breakage.
    expect(await unwrap('shared-password-123', ACCOUNT_A)).toEqual(key)
  })

  test('unwrap(rightPassword, matchingUserId) succeeds normally', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', ACCOUNT_A)
    expect(await unwrap('a-real-password-123', ACCOUNT_A)).toEqual(key)
  })

  test('a pre-fix (never-tagged) entry is trusted ONCE on the right password, then re-stamped — a later cross-account attempt is rejected', async () => {
    const key = randomKey()
    // Simulate an entry written before this fix shipped: wrapAndStore's
    // CURRENT code always tags userId, so drop straight to the DB to
    // reproduce the untagged shape (same technique 1529's test file uses
    // for its own pre-fix shapes).
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
      new TextEncoder().encode('legacy-password-123'),
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
      key as unknown as BufferSource,
    )
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      key as unknown as BufferSource,
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

    // First unlock ever since this fix shipped, as account A — trusted
    // (password already proves it) and silently re-stamped for A.
    expect(await unwrap('legacy-password-123', ACCOUNT_A)).toEqual(key)

    // Now the entry is tagged for A. The SAME right password, claimed as a
    // DIFFERENT account, is rejected — the self-heal closed the gap.
    expect(await unwrap('legacy-password-123', ACCOUNT_B)).toBeNull()
    // A can still unlock normally.
    expect(await unwrap('legacy-password-123', ACCOUNT_A)).toEqual(key)
  })
})

describe('task 1531/1534 (P0): vault.ts passkey-vault rejects a wrong-account unwrap', () => {
  test('unwrapWithPasskey(rightWrapKey, wrongExpectedUserId) returns null', async () => {
    const key = randomKey()
    const wrapKey = crypto.getRandomValues(new Uint8Array(32))
    await wrapAndStoreWithPasskey(key, wrapKey, ACCOUNT_A)

    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_B)).toBeNull()
    expect(await unwrapWithPasskey(wrapKey, ACCOUNT_A)).toEqual(key)
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
