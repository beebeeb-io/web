import { describe, test, expect, beforeEach, spyOn } from 'bun:test'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

// Minimal in-memory localStorage stub (same pattern as
// test/pending-checkout-0957.test.ts / test/1471-isloggedin-auth-context.test.ts)
// — `bun test` has no built-in localStorage global (verified:
// `typeof localStorage` is `undefined` under bun 1.3.4, same as indexedDB).
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

// Task 1529 (P0): passkey login + phrase restore was wrapping the master
// key with vault.ts wrapAndStore(key, '') — anyone with read access to the
// browser's IndexedDB could unwrap it with no secret at all. Guus's ruling
// (2026-09-25, "Session only"): wrapAndStore must refuse an empty secret,
// the passkey path must use setMasterKeyDirect (in-memory, session-only,
// nothing persisted) instead, and a pre-existing empty-password vault must
// be detected and cleared at startup.
//
// bun test has no `indexedDB` global (verified: `typeof indexedDB` is
// `undefined` under bun 1.3.4) — vault.ts is otherwise plain WebCrypto +
// IndexedDB with no worker/Comlink dependency, so a minimal in-memory
// IndexedDB stand-in (test/helpers/fake-indexeddb.ts) is enough to exercise
// the real production vault.ts code directly.
const fakeIdb = installFakeIndexedDB()
beforeEach(() => {
  fakeIdb.reset()
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

// vault.ts reads `indexedDB` off the global at CALL time (not import time),
// so importing it before or after installFakeIndexedDB() both work — kept
// after for clarity that the fake must be installed first.
const { wrapAndStore, unwrap, hasVault, clearEmptyPasswordVault } = await import('../src/lib/vault')

// Continuation (web #73): the caching/remediation/decision logic these
// tests also exercise — see each module's own doc comments for why they
// were factored out of key-context.tsx / device-provision.tsx (both React
// components; this repo has no DOM/React-rendering harness under
// `bun test`).
const { cacheKeyPersistent, cacheKeySessionOnly } = await import('../src/lib/key-cache')
const { remediateEmptyPasswordVault } = await import('../src/lib/vault-remediation')
const { initSessionVault, getVaultKey } = await import('../src/lib/session-vault-cache')
const { restoreSession } = await import('../src/lib/session-persist')
const { shouldWrapWithPassword, distributeWords } = await import('../src/lib/device-provision-logic')

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

// Task 1531/1534 (P0, cross-account master-key confusion): every wrap/cache
// call now takes the account id it was proven for. A single fixed id is
// enough for these tests — they're about the empty-password/session-only
// behavior, not account binding (see 1531-account-binding.test.ts for that).
const TEST_USER_ID = 'test-user-1529'

// ─── Simulating a pre-fix device ────────────────────────────────────────
//
// wrapAndStore('') now throws (that's the fix under test), so there is no
// way to reproduce a pre-existing empty-password vault through the current
// public API. This duplicates vault.ts's PRE-FIX wrap logic (PBKDF2('')
// derive → AES-256-GCM encrypt → store) to write that on-disk shape
// directly, exactly as a device that hit the bug before this fix shipped
// would already have on disk — so clearEmptyPasswordVault has something
// real to detect.
const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const NONCE_BYTES = 12
const VAULT_CHECK_CONSTANT = 'beebeeb-vault-check'

async function deriveWrappingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function computeKeyCheck(masterKey: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    masterKey as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(VAULT_CHECK_CONSTANT))
  return new Uint8Array(signature)
}

/**
 * Writes a 'master' vault entry directly on disk, bypassing wrapAndStore —
 * so a test can produce shapes wrapAndStore itself refuses to write
 * anymore: an empty-secret entry (the pre-1529-fix bug), or a real-secret
 * entry WITHOUT the `checked` marker (a legacy entry from before the
 * continuation's checked-flag fix, item 7 — wrapAndStore has set
 * `checked: true` on every entry it writes since that fix, so this is the
 * only way to reproduce an unmarked-but-legitimate entry now).
 */
async function writeLegacyVaultEntry(
  masterKey: Uint8Array,
  password: string,
  opts: { checked?: boolean } = {},
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const wrappingKey = await deriveWrappingKey(password, salt)
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    wrappingKey,
    masterKey as unknown as BufferSource,
  )
  const keyCheck = await computeKeyCheck(masterKey)

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('beebeeb_vault', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('keys')) {
        database.createObjectStore('keys', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    const store = tx.objectStore('keys')
    const entry: Record<string, unknown> = { id: 'master', wrappedKey, salt, nonce, keyCheck }
    if (opts.checked !== undefined) entry.checked = opts.checked
    const put = store.put(entry)
    put.onsuccess = () => resolve()
    put.onerror = () => reject(put.error)
  })
  db.close()
}

const writeLegacyEmptyPasswordVault = (masterKey: Uint8Array): Promise<void> =>
  writeLegacyVaultEntry(masterKey, '')

describe('task 1529: wrapAndStore refuses an empty secret', () => {
  test('wrapAndStore(key, "") throws and persists nothing', async () => {
    const key = randomKey()
    await expect(wrapAndStore(key, '', TEST_USER_ID)).rejects.toThrow()
    expect(await hasVault()).toBe(false)
  })

  test('wrapAndStore(key, realPassword) still works (control — the guard is specific to empty secrets)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', TEST_USER_ID)
    expect(await hasVault()).toBe(true)
    expect(await unwrap('a-real-password-123', TEST_USER_ID)).toEqual({ key, untagged: false })
  })

  // Continuation (web #73, Codex P2): a whitespace-only secret PBKDF2-derives
  // to a real (non-empty) key, so it's a DIFFERENT bug from the literal ''
  // case above — but the same "no real secret" mistake, so it's refused the
  // same way.
  test('wrapAndStore(key, "   ") — spaces only — throws and persists nothing', async () => {
    const key = randomKey()
    await expect(wrapAndStore(key, '   ', TEST_USER_ID)).rejects.toThrow()
    expect(await hasVault()).toBe(false)
  })

  test('wrapAndStore(key, "\\t\\n") — tabs/newlines only — throws and persists nothing', async () => {
    const key = randomKey()
    await expect(wrapAndStore(key, '\t\n', TEST_USER_ID)).rejects.toThrow()
    expect(await hasVault()).toBe(false)
  })

  test('a real password with surrounding whitespace still works (control — trim() only rejects an ALL-whitespace secret)', async () => {
    const key = randomKey()
    await wrapAndStore(key, '  a-real-password-123  ', TEST_USER_ID)
    expect(await hasVault()).toBe(true)
  })
})

describe('task 1529: clearEmptyPasswordVault remediation', () => {
  test('detects and clears a pre-existing empty-password vault', async () => {
    const key = randomKey()
    await writeLegacyEmptyPasswordVault(key)
    expect(await hasVault()).toBe(true)

    const cleared = await clearEmptyPasswordVault()

    expect(cleared).toBe(true)
    expect(await hasVault()).toBe(false)
    expect(await unwrap('', TEST_USER_ID)).toBeNull()
  })

  test('does NOT clear a real-password vault (no false positive)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', TEST_USER_ID)

    const cleared = await clearEmptyPasswordVault()

    expect(cleared).toBe(false)
    expect(await hasVault()).toBe(true)
    expect(await unwrap('a-real-password-123', TEST_USER_ID)).toEqual({ key, untagged: false })
  })

  test('returns false when there is no vault at all', async () => {
    expect(await hasVault()).toBe(false)
    expect(await clearEmptyPasswordVault()).toBe(false)
  })
})

// Continuation (web #73, Codex P2 + crypto-security-reviewer): the probe
// inside clearEmptyPasswordVault performs a 600,000-iteration PBKDF2
// derivation — expensive enough that running it on EVERY boot, forever, for
// every device with a legitimate password vault is itself a real cost. The
// `checked` flag on the vault entry makes this run at most once per entry.
describe('task 1529 continuation (web #73): the PBKDF2 probe runs at most once per vault entry', () => {
  test('a vault written by the current wrapAndStore is never probed at all (checked: true from the write)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', TEST_USER_ID)

    const deriveKeySpy = spyOn(crypto.subtle, 'deriveKey')
    try {
      expect(await clearEmptyPasswordVault()).toBe(false)
      expect(deriveKeySpy).not.toHaveBeenCalled()
      expect(await clearEmptyPasswordVault()).toBe(false)
      expect(deriveKeySpy).not.toHaveBeenCalled()
    } finally {
      deriveKeySpy.mockRestore()
    }
  })

  test('a legacy (unmarked) real-password entry is probed exactly once, then never again', async () => {
    const key = randomKey()
    await writeLegacyVaultEntry(key, 'a-real-password-123') // no `checked` field — simulates a pre-continuation entry

    const deriveKeySpy = spyOn(crypto.subtle, 'deriveKey')
    try {
      expect(await clearEmptyPasswordVault()).toBe(false)
      expect(deriveKeySpy).toHaveBeenCalledTimes(1)

      deriveKeySpy.mockClear()
      expect(await clearEmptyPasswordVault()).toBe(false)
      expect(deriveKeySpy).not.toHaveBeenCalled()
    } finally {
      deriveKeySpy.mockRestore()
    }
  })

  test('an unmarked legacy EMPTY-password vault is still cleared — the checked flag never protects the actual bug', async () => {
    const key = randomKey()
    await writeLegacyEmptyPasswordVault(key) // no `checked` field, password === ''
    expect(await clearEmptyPasswordVault()).toBe(true)
    expect(await hasVault()).toBe(false)
  })
})

// Continuation (web #73): replaces the source-contract tests that used to
// live here (regex/string-matching device-provision.tsx and
// key-context.tsx's source text). Those checks were also incomplete in a
// real way — "setMasterKeyDirect never calls wrapAndStore" was true even
// WITH the Codex P1 bug this lane fixes (setMasterKeyDirect never called
// wrapAndStore; it called cacheKey, which called persistSession, which is
// where the leak actually was). key-cache.ts, vault-remediation.ts and
// device-provision-logic.ts (below) are the real logic factored out of
// those two React components specifically so it's directly, behaviorally
// testable instead — real IndexedDB/localStorage I/O and real return
// values, not string matches against the calling code.
describe('task 1529 continuation (web #73, Codex P1): the passkey session-only path persists NOTHING', () => {
  test('cacheKeySessionOnly caches the tab session key but writes no bb_spt / beebeeb_session_persist entry', async () => {
    const key = randomKey()
    await initSessionVault()
    await cacheKeySessionOnly(key, TEST_USER_ID)

    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await restoreSession()).toBeNull()
    // Still cached for THIS tab (memory-bound — dies on refresh since
    // session-vault-cache.ts's wrapping key lives only in module memory).
    expect(await getVaultKey()).toEqual({ key, userId: TEST_USER_ID })
  })

  test('cacheKeyPersistent (every OTHER unlock path) DOES write bb_spt + beebeeb_session_persist — control, proves these assertions can actually detect persistence', async () => {
    const key = randomKey()
    await initSessionVault()
    await cacheKeyPersistent(key, TEST_USER_ID)

    expect(localStorage.getItem('bb_spt')).not.toBeNull()
    expect(await restoreSession()).toEqual({ key, userId: TEST_USER_ID })
  })
})

describe('task 1529 continuation (web #73, Codex P1): boot remediation also clears the session-persist copy', () => {
  test('remediateEmptyPasswordVault clears the "" vault AND the cached copies a pre-fix setMasterKey call also wrote', async () => {
    const key = randomKey()
    await writeLegacyEmptyPasswordVault(key)
    // Simulate the pre-fix setMasterKey('') call's OTHER side effect: it
    // funneled through the old cacheKey, which cached BOTH the tab session
    // AND the persistent session — exactly what cacheKeyPersistent does.
    await initSessionVault()
    await cacheKeyPersistent(key, TEST_USER_ID)
    expect(localStorage.getItem('bb_spt')).not.toBeNull()
    expect(await getVaultKey()).toEqual({ key, userId: TEST_USER_ID })

    const cleared = await remediateEmptyPasswordVault()

    expect(cleared).toBe(true)
    expect(await hasVault()).toBe(false)
    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await restoreSession()).toBeNull()
    expect(await getVaultKey()).toBeNull()
  })

  test('remediateEmptyPasswordVault leaves the session caches untouched for a real-password vault (no false-positive logout)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123', TEST_USER_ID)
    await initSessionVault()
    await cacheKeyPersistent(key, TEST_USER_ID)

    const cleared = await remediateEmptyPasswordVault()

    expect(cleared).toBe(false)
    expect(localStorage.getItem('bb_spt')).not.toBeNull()
    expect(await getVaultKey()).toEqual({ key, userId: TEST_USER_ID })
  })
})

describe('task 1529 continuation (web #73, crypto-security-reviewer P1): auth method, not password truthiness, decides whether to wrap', () => {
  test('a stale password left over from a FAILED OPAQUE attempt does not get wrapped once passkey succeeds', () => {
    // The exact failure this prevents: user types a wrong password,
    // handleSubmit's OPAQUE handshake fails (login.tsx never clears
    // `password` on that error path), user switches to "Sign in with
    // passkey instead" and succeeds. `password` is still sitting there,
    // wrong and unproven. authMethod is explicitly 'passkey' here — not
    // inferred from that stale, non-empty string.
    expect(shouldWrapWithPassword('passkey', 'a-stale-wrong-password-that-failed-opaque')).toBe(false)
  })

  test('a genuinely OPAQUE-proven password still gets wrapped', () => {
    expect(shouldWrapWithPassword('opaque', 'the-real-proven-password')).toBe(true)
  })

  test('authMethod "opaque" with an empty password (defensive — should never happen) does not wrap', () => {
    expect(shouldWrapWithPassword('opaque', '')).toBe(false)
  })
})

describe('task 1529 continuation (web #73, Codex P2): a full 12-word paste into ANY box fills all 12', () => {
  test('pasting all 12 words into box 7 (index 6) fills every box from the start, focus lands on the last box', () => {
    const current = Array.from({ length: 12 }, () => '')
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ')
    expect(phrase).toHaveLength(12)

    const result = distributeWords(current, 6, phrase, 12)

    expect(result.words).toEqual(phrase)
    expect(result.nextFocusIndex).toBe(11)
  })

  test('pasting all 12 words into the LAST box (index 11) still fills every box from the start', () => {
    const current = Array.from({ length: 12 }, () => '')
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ')

    const result = distributeWords(current, 11, phrase, 12)

    expect(result.words).toEqual(phrase)
  })

  test('a partial paste (fewer than 12 words) still fills starting at the box it landed in — unchanged behavior', () => {
    const current = Array.from({ length: 12 }, () => '')

    const result = distributeWords(current, 3, ['ability', 'able'], 12)

    expect(result.words[3]).toBe('ability')
    expect(result.words[4]).toBe('able')
    expect(result.words[0]).toBe('')
    expect(result.nextFocusIndex).toBe(5)
  })

  test('an empty/whitespace-only paste is a no-op — returns the SAME array reference', () => {
    const current = Array.from({ length: 12 }, () => '')

    const result = distributeWords(current, 5, ['   ', ''], 12)

    expect(result.words).toBe(current)
  })
})
