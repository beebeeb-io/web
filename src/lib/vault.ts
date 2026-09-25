// ─── Vault ─────────────────────────────────────────
// Wraps/unwraps the master encryption key with a password-derived key.
// Stored in IndexedDB — never touches localStorage or sessionStorage.
// Uses Web Crypto API directly (no WASM dependency).

const DB_NAME = 'beebeeb_vault'
const DB_VERSION = 1
const STORE_NAME = 'keys'
const VAULT_CHECK_CONSTANT = 'beebeeb-vault-check'

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const NONCE_BYTES = 12 // AES-GCM standard

interface VaultEntry {
  id: string
  wrappedKey: ArrayBuffer
  salt: Uint8Array
  nonce: Uint8Array
  keyCheck: Uint8Array
  email?: string
  /**
   * Task 1531/1534 (P0): the account this entry was wrapped for. Checked
   * AFTER a successful password-decrypt + keyCheck, so it catches the case
   * AES-GCM alone cannot: the SAME password reused across two different
   * beebeeb accounts (plausible — humans reuse passwords) would otherwise
   * let `unwrap(rightPasswordWrongAccount)` successfully decrypt the WRONG
   * account's key. An entry written before this field existed reads back
   * as `undefined`, which never matches any real account id — fail closed,
   * not auto-trusted.
   */
  userId?: string
  /**
   * Task 1529 continuation (web #73, Codex P2): set true on every entry
   * `wrapAndStore` writes (which, as of the 1529 fix, is ALWAYS a real
   * non-empty/non-whitespace secret — see the guard below). Lets
   * `clearEmptyPasswordVault` skip its 600k-iteration PBKDF2 probe for
   * entries already known-safe, instead of re-deriving on every boot for
   * the lifetime of the device.
   */
  checked?: boolean
}

// ─── IndexedDB helpers ─────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function dbGet(db: IDBDatabase, key: string): Promise<VaultEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result as VaultEntry | undefined)
    request.onerror = () => reject(request.error)
  })
}

function dbPut(db: IDBDatabase, entry: VaultEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(entry)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function dbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function dbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ─── Crypto helpers ────────────────────────────────

async function deriveWrappingKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
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
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(VAULT_CHECK_CONSTANT),
  )
  return new Uint8Array(signature)
}

// ─── Public API ────────────────────────────────────

/**
 * Wrap the master key with a password-derived key and store in IndexedDB.
 * Derives wrapping key via PBKDF2 (SHA-256, 600k iterations, random 16-byte salt).
 * Encrypts master key with AES-256-GCM. Stores wrapped blob + salt + nonce + HMAC key check.
 */
export async function wrapAndStore(
  masterKey: Uint8Array,
  password: string,
  userId: string,
): Promise<void> {
  // Task 1529 (P0): wrapAndStore('') derives an AES key from PBKDF2 of an
  // empty string — anyone with read access to this browser's IndexedDB
  // could unwrap the master key with no secret at all. Never silently do
  // this; every caller must supply a real, non-empty secret. Callers on a
  // session-only path (e.g. passkey sign-in with no password) must use
  // setMasterKeyDirect instead of routing through setMasterKey/wrapAndStore.
  //
  // Continuation (web #73, Codex P2): a whitespace-only secret (' ', '\n',
  // '\t\t') PBKDF2-derives to a DIFFERENT (non-empty) key than '' does, so
  // it isn't literally the empty-secret bug — but it's exactly the same
  // class of "no real secret" mistake (e.g. a bug that trims elsewhere and
  // ends up passing a lone space), so it's refused for the same reason.
  if (!password?.trim()) {
    throw new Error('wrapAndStore: refusing to wrap the master key under an empty secret')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))

  const wrappingKey = await deriveWrappingKey(password, salt)

  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    wrappingKey,
    masterKey as unknown as BufferSource,
  )

  const keyCheck = await computeKeyCheck(masterKey)

  const db = await openDB()
  try {
    await dbPut(db, {
      id: 'master',
      wrappedKey,
      salt,
      nonce,
      keyCheck,
      userId,
      // This entry was just written by the fixed wrapAndStore above, which
      // guarantees `password` is real — never re-probe it as a possible
      // empty-password legacy vault.
      checked: true,
    })
  } finally {
    db.close()
  }
}

/**
 * Load the wrapped key from IndexedDB, derive the wrapping key from the
 * password, and decrypt. Returns the master key, or null if the password is
 * wrong, no vault exists, or (task 1531/1534, P0) the entry was wrapped for
 * a DIFFERENT account than `expectedUserId` — this last check matters
 * because AES-GCM alone only proves "this password unwrapped SOME key"; if
 * the same human reuses one password across two different beebeeb accounts,
 * a right-password-wrong-account unwrap would otherwise silently succeed.
 * An entry written before the userId field existed never matches (fail
 * closed) — the caller falls through to whichever proof-based path
 * re-establishes the key normally, which re-stamps it going forward.
 */
export async function unwrap(password: string, expectedUserId: string): Promise<Uint8Array | null> {
  const db = await openDB()
  let entry: VaultEntry | undefined
  try {
    entry = await dbGet(db, 'master')
  } finally {
    db.close()
  }

  if (!entry) return null

  const wrappingKey = await deriveWrappingKey(password, entry.salt)

  let decrypted: ArrayBuffer
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce as unknown as BufferSource },
      wrappingKey,
      entry.wrappedKey,
    )
  } catch {
    // Decryption failure = wrong password
    return null
  }

  const masterKey = new Uint8Array(decrypted)

  // Verify HMAC key check to confirm the master key is valid
  const check = await computeKeyCheck(masterKey)
  if (check.length !== entry.keyCheck.length) {
    masterKey.fill(0)
    return null
  }
  for (let i = 0; i < check.length; i++) {
    if (check[i] !== entry.keyCheck[i]) {
      masterKey.fill(0)
      return null
    }
  }

  if (entry.userId === undefined) {
    // Pre-fix entry, never tagged. The password (and keyCheck) already
    // constitute a real proof for THIS unlock, so don't lock an existing
    // user out of their own correct password — but self-heal immediately:
    // re-stamp the entry now so every SUBSEQUENT unlock is fully checked.
    // Best-effort; a write failure here must not fail an otherwise-valid
    // unlock.
    try {
      const healDb = await openDB()
      try {
        await dbPut(healDb, { ...entry, userId: expectedUserId })
      } finally {
        healDb.close()
      }
    } catch { /* best effort */ }
  } else if (entry.userId !== expectedUserId) {
    masterKey.fill(0)
    return null
  }

  return masterKey
}

/** Check if IndexedDB has a wrapped key (password or passkey). */
export async function hasVault(): Promise<boolean> {
  const db = await openDB()
  try {
    const pw = await dbGet(db, 'master')
    if (pw) return true
    const pk = await dbGet(db, PASSKEY_VAULT_ID)
    return pk !== undefined
  } finally {
    db.close()
  }
}

/** Clear all keys from IndexedDB. */
export async function clearVault(): Promise<void> {
  const db = await openDB()
  try {
    await dbClear(db)
  } finally {
    db.close()
  }
}

/**
 * Task 1529 remediation: detect + clear a password vault that was wrapped
 * under an EMPTY string secret (the passkey-login provisioning bug — a
 * passkey sign-in reached device-provision.tsx's phrase step with
 * password === '' and called setMasterKey(key, ''), which wrapAndStore now
 * refuses, but pre-fix devices may already carry one of these).
 *
 * `unwrap('')` only succeeds against a vault actually encrypted with the
 * empty-string-derived key: a real password vault fails AES-GCM auth-tag
 * verification against the wrong derived key and returns null, and no
 * vault at all also returns null — so this is safe to run unconditionally
 * whenever a 'master' entry exists.
 *
 * Deletes ONLY the password-vault ('master') entry, not the whole store —
 * a device that ALSO has a legitimate PRF-wrapped passkey vault
 * ('master-passkey', a separate entry) keeps that one, so this cleanup
 * can't turn into a second, unrelated logout.
 *
 * Returns true if an empty-password vault was found and cleared.
 *
 * Task 1529 continuation (web #73, Codex P2 + crypto-security-reviewer):
 * the 600k-iteration PBKDF2 probe inside `unwrap('')` is expensive, and a
 * naive "run it every boot" makes every device with a LEGITIMATE password
 * vault pay that cost on every hard reload, forever. Skip the probe
 * entirely once an entry is known-safe (`checked: true` — either written
 * that way by the current wrapAndStore, or marked so below after its first
 * clean probe here), so the expensive path runs at most ONCE per vault
 * entry for the lifetime of the device.
 */
export async function clearEmptyPasswordVault(): Promise<boolean> {
  const db = await openDB()
  let entry: VaultEntry | undefined
  try {
    entry = await dbGet(db, 'master')
  } finally {
    db.close()
  }
  if (!entry) return false
  if (entry.checked) return false

  // This probe only cares whether the EMPTY string unwraps the entry at
  // all (task 1529) — not which account it claims to belong to, and the
  // entry is deleted immediately below on a hit regardless. The userId
  // argument is inert here: unwrap() only consults it for an entry that
  // already carries a REAL (non-undefined) tag, and an empty-password
  // legacy vault always predates that field.
  const key = await unwrap('', '')
  if (key) {
    key.fill(0)
    const deleteDb = await openDB()
    try {
      await dbDelete(deleteDb, 'master')
    } finally {
      deleteDb.close()
    }
    return true
  }

  // Not an empty-password vault — a real secret. Mark it checked so this
  // (expensive) probe never runs again for this entry; best-effort, never
  // blocks or fails the caller if the write itself fails.
  try {
    const markDb = await openDB()
    try {
      await dbPut(markDb, { ...entry, checked: true })
    } finally {
      markDb.close()
    }
  } catch { /* best effort — harmless to re-probe next boot if this fails */ }
  return false
}

// ─── Passkey vault (PRF-wrapped) ──────────────────

const PASSKEY_VAULT_ID = 'master-passkey'

async function importAesKey(raw: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [usage])
}

export async function wrapAndStoreWithPasskey(masterKey: Uint8Array, wrapKey: Uint8Array, userId: string): Promise<void> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const cryptoKey = await importAesKey(wrapKey, 'encrypt')
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    cryptoKey,
    masterKey as unknown as BufferSource,
  )
  const keyCheck = await computeKeyCheck(masterKey)
  const db = await openDB()
  try {
    await dbPut(db, { id: PASSKEY_VAULT_ID, wrappedKey, salt: new Uint8Array(0), nonce, keyCheck, userId })
  } finally {
    db.close()
  }
}

/** `expectedUserId` — task 1531/1534 (P0), same rationale as `unwrap`'s: an
 *  entry tagged for a DIFFERENT account is rejected; an untagged (pre-fix)
 *  entry is trusted once (the PRF/escrow wrap key already proves this) and
 *  immediately re-stamped so later restores are fully checked. */
export async function unwrapWithPasskey(wrapKey: Uint8Array, expectedUserId: string): Promise<Uint8Array | null> {
  const db = await openDB()
  let entry: VaultEntry | undefined
  try {
    entry = await dbGet(db, PASSKEY_VAULT_ID)
  } finally {
    db.close()
  }
  if (!entry) return null

  const cryptoKey = await importAesKey(wrapKey, 'decrypt')
  let decrypted: ArrayBuffer
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce as unknown as BufferSource },
      cryptoKey,
      entry.wrappedKey,
    )
  } catch {
    return null
  }

  const masterKey = new Uint8Array(decrypted)
  const check = await computeKeyCheck(masterKey)
  if (check.length !== entry.keyCheck.length) { masterKey.fill(0); return null }
  for (let i = 0; i < check.length; i++) {
    if (check[i] !== entry.keyCheck[i]) { masterKey.fill(0); return null }
  }

  if (entry.userId === undefined) {
    try {
      const healDb = await openDB()
      try {
        await dbPut(healDb, { ...entry, userId: expectedUserId })
      } finally {
        healDb.close()
      }
    } catch { /* best effort */ }
  } else if (entry.userId !== expectedUserId) {
    masterKey.fill(0)
    return null
  }

  return masterKey
}
