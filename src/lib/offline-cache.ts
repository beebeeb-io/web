// ─── Offline file-list + preview cache (IndexedDB) ───────────────────────────
//
// Stores recently-fetched file lists in IndexedDB so they can be shown when
// the user goes offline. The encrypted file list is the same payload the
// server returns (name_encrypted, size_bytes, etc.); we additionally store
// the decrypted names map keyed by file id so a cold offline reload can show
// human-readable names without rebooting the crypto context.
//
// Capacity rules:
//   - Total file-row cap across all cache entries: 50 000 rows. On insert
//     that would exceed the cap, evict whole entries LRU by accessedAt until
//     under the cap.
//   - TTL: 7 days. Entries older than that are treated as missing by the
//     consumer (we still return them for inspection but mark `stale: true`).
//
// Security note: only the encrypted payload is durably stored. Decrypted
// names are stored separately and only when the caller passes them in —
// this preserves the existing model (no plaintext on disk unless the user
// explicitly enabled offline reading by viewing the folder while online).
//
// ─── Preview cache (separate DB) ─────────────────────────────────────────────
// The decrypted-thumbnail / preview blob cache remains in its own DB so the
// 50k row file-list cap doesn't compete with previews for eviction.

import type { DriveFile } from './api'

// ─── File list cache (IndexedDB) ─────────────────────────────────────────────

const FILE_LIST_DB_NAME = 'beebeeb_file_list_cache'
const FILE_LIST_DB_VERSION = 1
const FILE_LIST_STORE = 'fileLists'
const FILE_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const FILE_LIST_TOTAL_ROW_CAP = 50_000

const ROOT_KEY = '__root__'

interface FileListRecord {
  parentId: string // ROOT_KEY when the parent is the drive root
  files: DriveFile[]
  decryptedNames: Record<string, string>
  cachedAt: number
  accessedAt: number
}

export interface CachedFileList {
  files: DriveFile[]
  decryptedNames: Record<string, string>
  cachedAt: number
  stale: boolean
}

function parentKey(parentId: string | null): string {
  return parentId ?? ROOT_KEY
}

function openFileListDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_LIST_DB_NAME, FILE_LIST_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(FILE_LIST_STORE)) {
        db.createObjectStore(FILE_LIST_STORE, { keyPath: 'parentId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function fileListGet(db: IDBDatabase, key: string): Promise<FileListRecord | undefined> {
  const tx = db.transaction(FILE_LIST_STORE, 'readonly')
  return idbReq(tx.objectStore(FILE_LIST_STORE).get(key)) as Promise<FileListRecord | undefined>
}

async function fileListPut(db: IDBDatabase, record: FileListRecord): Promise<void> {
  const tx = db.transaction(FILE_LIST_STORE, 'readwrite')
  await idbReq(tx.objectStore(FILE_LIST_STORE).put(record))
}

async function fileListDelete(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction(FILE_LIST_STORE, 'readwrite')
  await idbReq(tx.objectStore(FILE_LIST_STORE).delete(key))
}

async function fileListGetAll(db: IDBDatabase): Promise<FileListRecord[]> {
  const tx = db.transaction(FILE_LIST_STORE, 'readonly')
  return idbReq(tx.objectStore(FILE_LIST_STORE).getAll()) as Promise<FileListRecord[]>
}

/**
 * Evict LRU entries until the total stored row count is at or below the cap.
 * The just-written entry (excludeKey) is never evicted.
 */
async function enforceRowCap(db: IDBDatabase, excludeKey: string): Promise<void> {
  const all = await fileListGetAll(db)
  let total = all.reduce((sum, r) => sum + r.files.length, 0)
  if (total <= FILE_LIST_TOTAL_ROW_CAP) return

  // Oldest accessedAt first; skip the entry we just wrote.
  const candidates = all
    .filter((r) => r.parentId !== excludeKey)
    .sort((a, b) => a.accessedAt - b.accessedAt)

  for (const victim of candidates) {
    if (total <= FILE_LIST_TOTAL_ROW_CAP) break
    await fileListDelete(db, victim.parentId)
    total -= victim.files.length
  }
}

/**
 * Persist a file list for the given parent folder (null = drive root). If
 * `decryptedNames` is provided, the entries are merged with any previously
 * stored names so we don't lose names from earlier decrypt passes.
 *
 * Silently no-ops if IndexedDB is unavailable.
 */
export async function cacheFileList(
  parentId: string | null,
  files: DriveFile[],
  decryptedNames?: Record<string, string>,
): Promise<void> {
  const key = parentKey(parentId)
  try {
    const db = await openFileListDB()
    try {
      const now = Date.now()
      const existing = await fileListGet(db, key)
      const mergedNames: Record<string, string> = {
        ...(existing?.decryptedNames ?? {}),
        ...(decryptedNames ?? {}),
      }
      // Drop names for files that are no longer in the folder.
      const nextFileIds = new Set(files.map((f) => f.id))
      for (const id of Object.keys(mergedNames)) {
        if (!nextFileIds.has(id)) delete mergedNames[id]
      }
      const record: FileListRecord = {
        parentId: key,
        files,
        decryptedNames: mergedNames,
        cachedAt: now,
        accessedAt: now,
      }
      await fileListPut(db, record)
      await enforceRowCap(db, key)
    } finally {
      db.close()
    }
  } catch {
    // IndexedDB unavailable, quota exceeded, or schema mismatch — silently skip.
  }
}

/**
 * Return the cached file list for the given parent folder, or null on miss
 * or hard error. Entries older than the TTL are returned with `stale: true`
 * so the caller (drive page) can decide whether to use them; offline-fallback
 * callers should treat stale as missing.
 *
 * Touches accessedAt so the entry survives LRU eviction.
 */
export async function getCachedFileList(parentId: string | null): Promise<CachedFileList | null> {
  const key = parentKey(parentId)
  try {
    const db = await openFileListDB()
    try {
      const record = await fileListGet(db, key)
      if (!record) return null
      const stale = Date.now() - record.cachedAt > FILE_LIST_TTL_MS
      // LRU touch on read.
      await fileListPut(db, { ...record, accessedAt: Date.now() })
      return {
        files: record.files,
        decryptedNames: record.decryptedNames ?? {},
        cachedAt: record.cachedAt,
        stale,
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Remove the cached list for a specific folder (call after mutations). */
export async function invalidateFileListCache(parentId: string | null): Promise<void> {
  try {
    const db = await openFileListDB()
    try {
      await fileListDelete(db, parentKey(parentId))
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
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
