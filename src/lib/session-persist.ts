// ─── Session persistence ────────────────────────────
// Keeps the vault unlocked across page refreshes for a configurable TTL.
//
// On unlock: generates a random "remember token", wraps the master key
// with it via AES-256-GCM, stores the wrapped blob + timestamp in
// IndexedDB and the remember token in localStorage.
//
// On load: reads the token from localStorage, reads the blob from IDB,
// checks TTL, unwraps if valid.
//
// Security tradeoff: XSS can read the token from localStorage, but the
// master key is never in localStorage directly. An attacker would need
// to read from both localStorage AND IndexedDB, then perform the unwrap.
// The TTL limits the exposure window.

const DB_NAME = 'beebeeb_session_persist'
const DB_VERSION = 1
const STORE_NAME = 'session'
const ENTRY_ID = 'persist'

const LS_TOKEN_KEY = 'bb_spt'
const LS_TTL_KEY = 'bb_vault_ttl'
const NONCE_BYTES = 12

const DEFAULT_TTL_MS = 30 * 60 * 1000
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface PersistEntry {
  id: typeof ENTRY_ID
  wrapped: ArrayBuffer
  nonce: Uint8Array
  createdAt: number
}

// ─── TTL preference ───────────────────────────────────

export function getVaultTTL(): number {
  try {
    const raw = localStorage.getItem(LS_TTL_KEY)
    if (raw) {
      const ms = parseInt(raw, 10)
      if (!isNaN(ms) && ms > 0 && ms <= MAX_TTL_MS) return ms
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_TTL_MS
}

export function setVaultTTL(ms: number): void {
  const clamped = Math.max(0, Math.min(ms, MAX_TTL_MS))
  try {
    if (clamped === 0) {
      localStorage.removeItem(LS_TTL_KEY)
    } else {
      localStorage.setItem(LS_TTL_KEY, String(clamped))
    }
  } catch { /* localStorage unavailable */ }
}

export const TTL_OPTIONS = [
  { label: 'Every refresh', value: 0 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4 * 60 * 60 * 1000 },
  { label: '1 day', value: 24 * 60 * 60 * 1000 },
  { label: '7 days', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', value: 30 * 24 * 60 * 60 * 1000 },
] as const

// ─── IndexedDB helpers ────────────────────────────────

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

function dbGet(db: IDBDatabase): Promise<PersistEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(ENTRY_ID)
    req.onsuccess = () => resolve(req.result as PersistEntry | undefined)
    req.onerror = () => reject(req.error)
  })
}

function dbPut(db: IDBDatabase, entry: PersistEntry): Promise<void> {
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

// ─── Crypto ───────────────────────────────────────────

async function deriveKey(token: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    token as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ─── Public API ───────────────────────────────────────

export async function persistSession(masterKey: Uint8Array): Promise<void> {
  const ttl = getVaultTTL()
  if (ttl === 0) return

  const token = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const key = await deriveKey(token)

  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    key,
    masterKey as unknown as BufferSource,
  )

  const db = await openDB()
  try {
    await dbPut(db, { id: ENTRY_ID, wrapped, nonce, createdAt: Date.now() })
  } finally {
    db.close()
  }

  try {
    const hex = Array.from(token).map(b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(LS_TOKEN_KEY, hex)
  } catch { /* localStorage unavailable */ }
}

export async function restoreSession(): Promise<Uint8Array | null> {
  const ttl = getVaultTTL()
  if (ttl === 0) return null

  let hex: string | null
  try {
    hex = localStorage.getItem(LS_TOKEN_KEY)
  } catch {
    return null
  }
  if (!hex || hex.length !== 64) return null

  const token = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    token[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }

  const db = await openDB()
  let entry: PersistEntry | undefined
  try {
    entry = await dbGet(db)
  } finally {
    db.close()
  }
  if (!entry) return null

  if (Date.now() - entry.createdAt > ttl) {
    await clearSession()
    return null
  }

  try {
    const key = await deriveKey(token)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce as unknown as BufferSource },
      key,
      entry.wrapped,
    )
    return new Uint8Array(pt)
  } catch {
    await clearSession()
    return null
  }
}

export async function clearSession(): Promise<void> {
  try {
    localStorage.removeItem(LS_TOKEN_KEY)
  } catch { /* ok */ }
  try {
    const db = await openDB()
    try {
      await dbDelete(db)
    } finally {
      db.close()
    }
  } catch { /* ok */ }
}
