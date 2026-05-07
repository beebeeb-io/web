// ─── Session vault cache ───────────────────────────
// Holds the master vault key for the duration of a tab session, encrypted
// with a non-extractable AES-GCM CryptoKey. The key handle lives only in
// module memory — a page refresh discards it and the user must re-unlock.
//
// Replaces the older sessionStorage cache (`bb_sk`/`bb_iv`/`bb_mk`), where
// the wrapping key sat next to the ciphertext and any XSS could decrypt
// the master key in three lines. Now the wrapping key is non-extractable:
// XSS can still call crypto.subtle.decrypt via the opaque handle, but
// cannot exfiltrate raw key bytes to a remote attacker.

const DB_NAME = 'beebeeb_session_cache'
const DB_VERSION = 1
const STORE_NAME = 'cache'
const ENTRY_ID = 'master'
const NONCE_BYTES = 12

interface CacheEntry {
  id: typeof ENTRY_ID
  nonce: Uint8Array
  wrapped: ArrayBuffer
}

let sessionKey: CryptoKey | null = null

// ─── IndexedDB helpers ─────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbGet(db: IDBDatabase): Promise<CacheEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(ENTRY_ID)
    req.onsuccess = () => resolve(req.result as CacheEntry | undefined)
    req.onerror = () => reject(req.error)
  })
}

function dbPut(db: IDBDatabase, entry: CacheEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function dbDelete(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(ENTRY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ─── Public API ────────────────────────────────────

/**
 * Generate a fresh non-extractable session key for this tab and clear any
 * stale cache from a previous session. Idempotent — safe to call multiple
 * times. Must be invoked before cacheVaultKey / getVaultKey.
 *
 * Stale entries are dropped because their wrapping key is gone: the bytes
 * are unreadable garbage we don't want to leave on disk.
 */
export async function initSessionVault(): Promise<void> {
  if (sessionKey) return
  sessionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — JS cannot read the raw bytes
    ['encrypt', 'decrypt'],
  )
  const db = await openDB()
  try {
    await dbDelete(db)
  } finally {
    db.close()
  }
}

/** Wrap the master key with the in-memory session key and persist to IDB. */
export async function cacheVaultKey(masterKey: Uint8Array): Promise<void> {
  if (!sessionKey) {
    throw new Error('initSessionVault must be called before cacheVaultKey')
  }
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    sessionKey,
    masterKey as unknown as BufferSource,
  )
  const db = await openDB()
  try {
    await dbPut(db, { id: ENTRY_ID, nonce, wrapped })
  } finally {
    db.close()
  }
}

/**
 * Decrypt the cached vault key using the in-memory session key.
 * Returns null if no entry exists, init has not run, or decryption fails
 * (typically a stale entry from before the current session key existed).
 */
export async function getVaultKey(): Promise<Uint8Array | null> {
  if (!sessionKey) return null
  const db = await openDB()
  let entry: CacheEntry | undefined
  try {
    entry = await dbGet(db)
  } finally {
    db.close()
  }
  if (!entry) return null
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce as unknown as BufferSource },
      sessionKey,
      entry.wrapped,
    )
    return new Uint8Array(pt)
  } catch {
    await clearVaultKey()
    return null
  }
}

/** Remove the cached entry from IDB. The in-memory session key is left in
 *  place so subsequent cacheVaultKey calls within the same tab still work. */
export async function clearVaultKey(): Promise<void> {
  const db = await openDB()
  try {
    await dbDelete(db)
  } finally {
    db.close()
  }
}
