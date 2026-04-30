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
  id: 'master'
  wrappedKey: ArrayBuffer
  salt: Uint8Array
  nonce: Uint8Array
  keyCheck: Uint8Array
  email?: string
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

  const db = await openDB()
  try {
    await dbPut(db, {
      id: 'master',
      wrappedKey,
      salt,
      nonce,
      keyCheck,
    })
  } finally {
    db.close()
  }
}

/**
 * Load the wrapped key from IndexedDB, derive the wrapping key from the password,
 * and decrypt. Returns the master key, or null if the password is wrong or no vault exists.
 */
export async function unwrap(password: string): Promise<Uint8Array | null> {
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

  return masterKey
}

/** Check if IndexedDB has a wrapped key. */
export async function hasVault(): Promise<boolean> {
  const db = await openDB()
  try {
    const entry = await dbGet(db, 'master')
    return entry !== undefined
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
