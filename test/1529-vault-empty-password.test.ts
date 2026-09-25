import { describe, test, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

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
beforeEach(() => fakeIdb.reset())

// vault.ts reads `indexedDB` off the global at CALL time (not import time),
// so importing it before or after installFakeIndexedDB() both work — kept
// after for clarity that the fake must be installed first.
const { wrapAndStore, unwrap, hasVault, clearEmptyPasswordVault } = await import('../src/lib/vault')

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

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

async function writeLegacyEmptyPasswordVault(masterKey: Uint8Array): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const wrappingKey = await deriveWrappingKey('', salt)
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
    const put = store.put({ id: 'master', wrappedKey, salt, nonce, keyCheck })
    put.onsuccess = () => resolve()
    put.onerror = () => reject(put.error)
  })
  db.close()
}

describe('task 1529: wrapAndStore refuses an empty secret', () => {
  test('wrapAndStore(key, "") throws and persists nothing', async () => {
    const key = randomKey()
    await expect(wrapAndStore(key, '')).rejects.toThrow()
    expect(await hasVault()).toBe(false)
  })

  test('wrapAndStore(key, realPassword) still works (control — the guard is specific to empty secrets)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123')
    expect(await hasVault()).toBe(true)
    expect(await unwrap('a-real-password-123')).toEqual(key)
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
    expect(await unwrap('')).toBeNull()
  })

  test('does NOT clear a real-password vault (no false positive)', async () => {
    const key = randomKey()
    await wrapAndStore(key, 'a-real-password-123')

    const cleared = await clearEmptyPasswordVault()

    expect(cleared).toBe(false)
    expect(await hasVault()).toBe(true)
    expect(await unwrap('a-real-password-123')).toEqual(key)
  })

  test('returns false when there is no vault at all', async () => {
    expect(await hasVault()).toBe(false)
    expect(await clearEmptyPasswordVault()).toBe(false)
  })
})

describe('task 1529: passkey-path provisioning does not persist a vault', () => {
  // device-provision.tsx is a React component (JSX + hooks) and this repo
  // has no DOM/React-rendering harness under bun test (no jsdom/happy-dom/
  // testing-library configured) — rendering it and driving a real WebAuthn
  // ceremony here isn't feasible in a unit test. That scenario IS covered
  // as a real-stack proof by e2e/1528-new-device-flow.spec.ts (passkey
  // login → phrase → assert IndexedDB has no 'master' entry). What IS
  // checkable here, directly against the source device-provision.tsx and
  // key-context.tsx ship, is the exact guard the fix depends on: the
  // password-authenticated path is the ONLY path that calls
  // setMasterKey/wrapAndStore, and the passkey path (password === '')
  // calls setMasterKeyDirect, which never touches vault.ts at all.
  const provisionSrc = readFileSync(
    new URL('../src/components/device-provision.tsx', import.meta.url),
    'utf8',
  )
  const keyContextSrc = readFileSync(
    new URL('../src/lib/key-context.tsx', import.meta.url),
    'utf8',
  )

  test('device-provision.tsx only wraps+persists when a password was used', () => {
    // Exactly one occurrence of each call, and they must be the two arms of
    // one `if (password) {...} else {...}` — not a bare unconditional
    // `setMasterKey(masterKey, password)` (the exact pre-fix bug).
    expect(provisionSrc.match(/setMasterKey\(masterKey, password\)/g)?.length).toBe(1)
    expect(provisionSrc.match(/setMasterKeyDirect\(masterKey\)/g)?.length).toBe(1)
    expect(provisionSrc).toMatch(
      /if\s*\(password\)\s*\{\s*await setMasterKey\(masterKey,\s*password\)\s*\}\s*else\s*\{\s*setMasterKeyDirect\(masterKey\)\s*\}/,
    )
  })

  test('key-context.tsx setMasterKeyDirect never calls wrapAndStore (session-only by construction)', () => {
    const start = keyContextSrc.indexOf('const setMasterKeyDirect = useCallback(')
    const end = keyContextSrc.indexOf('const setMasterKeyFromPasskey = useCallback(')
    expect(start, 'setMasterKeyDirect not found in key-context.tsx').toBeGreaterThan(-1)
    expect(end, 'setMasterKeyFromPasskey not found in key-context.tsx').toBeGreaterThan(start)

    const body = keyContextSrc.slice(start, end)
    expect(body).not.toContain('wrapAndStore(')
    expect(body).not.toContain('wrapAndStoreWithPasskey(')
  })
})
