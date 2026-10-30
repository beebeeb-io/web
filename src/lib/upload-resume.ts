// ─── Resumable upload state ─────────────────────────
// File fingerprinting + IndexedDB persistence for resuming
// uploads that were interrupted (browser close, crash, etc).

import { fileStorageCountry } from './storage-regions'

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
  /**
   * Task 2083: the COUNTRY the server chose at init (`storage_location.country`),
   * so a resumed transfer keeps naming it. Absent on records written before
   * 2083: the card then falls back to "Europe" until completion. Never a city.
   */
  country?: string | null
  /**
   * The chunk format of the frames this session holds (1 = v1, 2 = v2),
   * recorded before the first PUT (task 1943, core 1908 resume rule). Absent
   * on records written before 1943: core then says restart, never continue.
   */
  chunk_format?: number
  /**
   * The recorded pin a REPLACE applied to its writer (0 or 2, read from the
   * replaced file's authenticated metadata). A resumed replace writes with the
   * same pin. Absent for a new file, which never applies a pin.
   */
  replace_pin?: number
  /**
   * The file id `replace_pin` belongs to (the replaced file). Written with
   * every pin; a resume applies the pin only when this equals `fileId` and
   * the id being resumed. A replace the server answered with another id is a
   * new file: its record carries neither field.
   */
  replace_pin_file_id?: string
  /**
   * L13 (contract 2275, SF-0001): this session's `fileId` is one THIS client
   * chose (a minted id, or a listed row's id), never an id the server handed
   * back. Records written before this field existed have no marker: their id
   * may be server-chosen, so they are abandoned, never resumed.
   */
  selfMinted?: true
  parentId: string | null
  createdAt: number // Date.now()
}

/** The id a resume must use, and the legacy id (if any) to abandon first. */
export interface ResumePlan {
  /** The id the upload writes under; a fresh client-chosen id for a legacy record. */
  resumeId: string
  /** A stored session this client did not mint: abandon it server-side, never resume it. */
  abandonId: string | null
}

/**
 * L13: a persisted session may only be resumed when this client minted the id
 * itself. A record without the marker (or whose stored id is not the one being
 * resumed) is abandoned through the upload-abandon endpoint and the upload
 * restarts under a fresh id the client chooses now — it is never resumed, and
 * never left looping on the old id.
 */
export function planResume(
  record: Pick<UploadState, 'fileId' | 'selfMinted'>,
  mintId: () => string,
): ResumePlan {
  if (record.selfMinted === true) return { resumeId: record.fileId, abandonId: null }
  return { resumeId: mintId(), abandonId: record.fileId }
}

/**
 * The country a resume record names, or null (old-shape record, malformed or
 * "Unknown": we never guess one). Reuses the same rules as a file response.
 */
export function recordedCountry(record: { country?: unknown } | null | undefined): string | null {
  return fileStorageCountry({ storage_location: { country: record?.country } })
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
