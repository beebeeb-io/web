// ─── Resumable upload state ─────────────────────────
// File fingerprinting + IndexedDB persistence for resuming
// uploads that were interrupted (browser close, crash, etc).

const DB_NAME = 'beebeeb_uploads'
const DB_VERSION = 1
const STORE_NAME = 'active_uploads'

// ─── File fingerprint ───────────────────────────────

/**
 * Compute a fast fingerprint for a File object.
 * Uses SHA-256 of (first 1MB + last 1MB + file size as string).
 * Fast even for 20GB files since we only read ~2MB.
 */
export async function computeFingerprint(file: File): Promise<string> {
  const SAMPLE_SIZE = 1024 * 1024 // 1 MB

  const parts: Uint8Array[] = []

  // First 1MB (or entire file if smaller)
  const headEnd = Math.min(SAMPLE_SIZE, file.size)
  const headBuf = await file.slice(0, headEnd).arrayBuffer()
  parts.push(new Uint8Array(headBuf))

  // Last 1MB (only if file is larger than 1MB, avoid overlap)
  if (file.size > SAMPLE_SIZE) {
    const tailStart = Math.max(file.size - SAMPLE_SIZE, headEnd)
    const tailBuf = await file.slice(tailStart, file.size).arrayBuffer()
    parts.push(new Uint8Array(tailBuf))
  }

  // Size as string bytes
  const sizeBytes = new TextEncoder().encode(String(file.size))
  parts.push(sizeBytes)

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }

  // SHA-256
  const hashBuf = await crypto.subtle.digest('SHA-256', combined)
  const hashArr = new Uint8Array(hashBuf)
  return Array.from(hashArr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── IndexedDB wrapper ──────────────────────────────

export interface UploadState {
  fingerprint: string
  fileId: string
  fileName: string
  fileSize: number
  totalChunks: number
  upload_session_id?: string | null
  object_version_id?: string | null
  chunk_size_bytes?: number
  chunk_count?: number
  region?: string | null
  parentId: string | null
  createdAt: number // Date.now()
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileId' })
        store.createIndex('fingerprint', 'fingerprint', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveUploadState(state: UploadState): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(state)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function getActiveUploads(): Promise<UploadState[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      db.close()
      resolve(req.result as UploadState[])
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

export async function removeUploadState(fileId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(fileId)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function findByFingerprint(
  fingerprint: string,
): Promise<UploadState | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('fingerprint')
    const req = index.get(fingerprint)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as UploadState) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}
