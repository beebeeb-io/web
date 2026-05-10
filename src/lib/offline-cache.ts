// ─── Offline file-list cache ─────────────────────────────────────────────────
//
// Stores recently-fetched file lists in localStorage so they can be shown
// when the user goes offline. Preview data URLs are kept in IndexedDB (they
// can be large; localStorage has a 5 MB quota on most browsers).
//
// Security note: file lists stored here contain only encrypted metadata
// (name_encrypted, size_bytes, etc.) — the same server payload that is also
// visible to anyone with the session token. Decrypted names are intentionally
// NOT stored.
//
// TTL: 30 minutes for file lists. Previews are evicted LRU when > 50 entries.

import type { DriveFile } from './api'

// ─── File list cache (localStorage) ──────────────────────────────────────────

const FILE_LIST_PREFIX = 'bb_fc_'
const FILE_LIST_TTL_MS = 30 * 60 * 1000 // 30 minutes

interface FileListEntry {
  files: DriveFile[]
  cachedAt: number
}

/** Persist a file list for the given parent folder id (null = root). */
export function cacheFileList(parentId: string | null, files: DriveFile[]): void {
  const key = FILE_LIST_PREFIX + (parentId ?? 'root')
  const entry: FileListEntry = { files, cachedAt: Date.now() }
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // localStorage full or disabled — silently skip
  }
}

/**
 * Return the cached file list for the given parent folder, or null if it
 * doesn't exist or is older than 30 minutes.
 */
export function getCachedFileList(parentId: string | null): DriveFile[] | null {
  const key = FILE_LIST_PREFIX + (parentId ?? 'root')
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: FileListEntry = JSON.parse(raw)
    if (Date.now() - entry.cachedAt > FILE_LIST_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    return entry.files
  } catch {
    return null
  }
}

/** Remove the cached list for a specific folder (call after mutations). */
export function invalidateFileListCache(parentId: string | null): void {
  const key = FILE_LIST_PREFIX + (parentId ?? 'root')
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

// ─── Preview cache (IndexedDB) ────────────────────────────────────────────────

const PREVIEW_DB_NAME = 'beebeeb_preview_cache'
const PREVIEW_DB_VERSION = 1
const PREVIEW_STORE = 'previews'
const PREVIEW_MAX = 50

interface PreviewEntry {
  fileId: string
  dataUrl: string
  accessedAt: number
}

function openPreviewDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PREVIEW_DB_NAME, PREVIEW_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PREVIEW_STORE)) {
        db.createObjectStore(PREVIEW_STORE, { keyPath: 'fileId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGet(db: IDBDatabase, fileId: string): Promise<PreviewEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readonly')
    const req = tx.objectStore(PREVIEW_STORE).get(fileId)
    req.onsuccess = () => resolve(req.result as PreviewEntry | undefined)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, entry: PreviewEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readwrite')
    const req = tx.objectStore(PREVIEW_STORE).put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function idbGetAll(db: IDBDatabase): Promise<PreviewEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readonly')
    const req = tx.objectStore(PREVIEW_STORE).getAll()
    req.onsuccess = () => resolve(req.result as PreviewEntry[])
    req.onerror = () => reject(req.error)
  })
}

function idbDelete(db: IDBDatabase, fileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readwrite')
    const req = tx.objectStore(PREVIEW_STORE).delete(fileId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** Evict the least-recently-used entries if we're over the limit. */
async function evictOldestPreviews(db: IDBDatabase): Promise<void> {
  const all = await idbGetAll(db)
  if (all.length <= PREVIEW_MAX) return
  const sorted = [...all].sort((a, b) => a.accessedAt - b.accessedAt)
  const toDelete = sorted.slice(0, all.length - PREVIEW_MAX)
  await Promise.all(toDelete.map((e) => idbDelete(db, e.fileId)))
}

/**
 * Store a decrypted preview data URL in IndexedDB.
 * Evicts LRU entries if the store exceeds 50 files.
 */
export async function cacheFilePreview(fileId: string, dataUrl: string): Promise<void> {
  try {
    const db = await openPreviewDB()
    try {
      await idbPut(db, { fileId, dataUrl, accessedAt: Date.now() })
      await evictOldestPreviews(db)
    } finally {
      db.close()
    }
  } catch {
    // IndexedDB unavailable — silently skip
  }
}

/**
 * Retrieve a cached preview data URL.
 * Updates the accessedAt timestamp (LRU touch) on hit.
 * Returns null on miss or error.
 */
export async function getCachedFilePreview(fileId: string): Promise<string | null> {
  try {
    const db = await openPreviewDB()
    try {
      const entry = await idbGet(db, fileId)
      if (!entry) return null
      // Touch accessedAt for LRU
      await idbPut(db, { ...entry, accessedAt: Date.now() })
      return entry.dataUrl
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}
