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
   * the id being resumed. A new file's record carries neither field. (On a
   * record without the selfMinted marker, a pin that names its own id is what
   * marks a replace: `planResume` restarts it as a version of that row.)
   */
  replace_pin_file_id?: string
  /**
   * L13 (contract 2275, SF-0001): this session's `fileId` is one THIS client
   * chose (a minted id, or a listed row's id), never an id the server handed
   * back. Records written before this field existed have no marker: their id
   * may be server-chosen, so they restart, never resume (`planResume`).
   */
  selfMinted?: true
  parentId: string | null
  createdAt: number // Date.now()
}

/**
 * The record's row as THIS user sees it now (lookupOwnRow, stored-row.ts):
 * - `live`: a file row, not in the trash, whose stored name authenticates under
 *   this user's key for its id. `nameEncrypted` is that name, as stored.
 * - `gone`: no such row for this user (404), in the trash, or not a file.
 * - `unverified`: reachable, but its name does not authenticate under this
 *   user's key (not a row this user owns).
 */
export type StoredRow =
  | { state: 'live'; nameEncrypted: string }
  | { state: 'gone' }
  | { state: 'unverified' }

/**
 * What a stored upload session becomes when this client picks it up again
 * (the Drive resume banner, or `encryptedUpload` finding it by fingerprint).
 *
 * - `resume`: this client marked the record's id as its own; its session
 *   continues (core's resume rule still decides about its frames).
 * - `restart-version`: written before the marker by a REPLACE (its pin names
 *   its own id, which only a replace of a listed row ever recorded), and that
 *   row is live. The upload starts over in a fresh init as a new version of
 *   that row, sending the row's OWN stored name byte for byte (`replaceOf`),
 *   whose recorded pin decides the format: never a freshly sealed name.
 * - `refuse`: such a replace whose row is gone, trashed or does not
 *   authenticate. Nothing is uploaded: a fresh init would INSERT a name
 *   without the pin the content needs, and the file would read back broken.
 * - `restart-new`: any other record without the marker (no pin naming its own
 *   id: a create, or a replace from before task 1943, which cannot be told
 *   apart). Never adopted and never proposed again, whatever row its id
 *   names: the upload starts over in a fresh init under `fileId`, a fresh id
 *   minted now.
 *
 * `resumeFileId` is what a caller passes as `encryptedUpload`'s `resumeFileId`:
 * the record's id while the upload stays on it, none otherwise (for a fresh id
 * the record is another id's, and `encryptedUpload` drops it).
 */
export type ResumePlan =
  | { kind: 'resume'; fileId: string; resumeFileId: string }
  | { kind: 'restart-version'; fileId: string; resumeFileId: string; replaceOf: { nameEncrypted: string } }
  | { kind: 'refuse'; fileId: string; resumeFileId: undefined; reason: 'gone' | 'unverified' }
  | { kind: 'restart-new'; fileId: string; resumeFileId: undefined }

/** Shown when a paused new version's file is no longer there (nothing is uploaded). */
export const PAUSED_VERSION_GONE_COPY =
  'The file this paused upload was a new version of is no longer in your files, so nothing was uploaded. ' +
  'Upload it again to add it as a new file.'

/** Shown when a paused new version's file cannot be verified (nothing is uploaded). */
export const PAUSED_VERSION_UNVERIFIED_COPY =
  "We couldn't verify the file this paused upload was a new version of, so nothing was uploaded."

/** A stored version upload that may not restart (`ResumePlan` kind `refuse`). */
export class PausedVersionRefusedError extends Error {
  readonly reason: 'gone' | 'unverified'

  constructor(reason: 'gone' | 'unverified') {
    super(reason === 'gone' ? PAUSED_VERSION_GONE_COPY : PAUSED_VERSION_UNVERIFIED_COPY)
    this.name = 'PausedVersionRefusedError'
    this.reason = reason
  }
}

/**
 * What the Drive banner says when `planResume`'s row check could not answer
 * (SF-0001 round 4): the server refused the lookup (401 / 403 / 410), there
 * was no connection, or the crypto worker failed. Nothing was uploaded and the
 * record is kept on the paused banner, where Dismiss removes it, so it never
 * loops silently. Duck-typed on `status` (this module has no ./api import).
 */
export function pausedRowCheckFailedMessage(err: unknown): string {
  const status = typeof err === 'object' && err !== null ? (err as { status?: unknown }).status : undefined
  if (status === 401) {
    return 'Your session expired. Sign in again, then resume this upload. It stays in your paused uploads until you dismiss it.'
  }
  if (status === 403) {
    return 'You no longer have access to the file this paused upload was a new version of, so it was not restarted. Dismiss it from your paused uploads.'
  }
  if (status === 410) {
    return 'The file this paused upload was a new version of is gone, so it was not restarted. Dismiss it from your paused uploads.'
  }
  return "We couldn't check the file this paused upload was a new version of, so it was not restarted. Try again, or dismiss it from your paused uploads."
}

/**
 * L13 (contract 2275, SF-0001): the ONE rule for a stored session, used by
 * both the Drive resume banner and `encryptedUpload` itself. A session is
 * resumed only when this client minted its id; any other record restarts
 * (never resumes), or is refused. Nothing here abandons anything server-side:
 * the only abandon the server offers is file-wide, so the stale session is
 * left to its lease sweep. `lookupRow` is asked only for an unmarked record
 * whose pin names its own id.
 */
export async function planResume(
  record: Pick<UploadState, 'fileId' | 'selfMinted' | 'replace_pin' | 'replace_pin_file_id'>,
  deps: { mintId: () => string | Promise<string>; lookupRow: (fileId: string) => Promise<StoredRow> },
): Promise<ResumePlan> {
  if (record.selfMinted === true) {
    return { kind: 'resume', fileId: record.fileId, resumeFileId: record.fileId }
  }
  // Only a record whose pin names its own id was a replace of a listed row (an
  // id this client chose); only it may restart as a version, and only of its
  // live row, with that row's own stored name. Without the row it may not
  // restart at all.
  if (record.replace_pin !== undefined && record.replace_pin_file_id === record.fileId) {
    const row = await deps.lookupRow(record.fileId)
    if (row.state === 'live') {
      return {
        kind: 'restart-version',
        fileId: record.fileId,
        resumeFileId: record.fileId,
        replaceOf: { nameEncrypted: row.nameEncrypted },
      }
    }
    return { kind: 'refuse', fileId: record.fileId, resumeFileId: undefined, reason: row.state }
  }
  // Any other unmarked record restarts as a NEW file under a fresh id, never
  // as a version of whatever row its id names (SF-0001 round 4): that id may
  // be the server's, or a row the user can write but does not own (a
  // shared-folder upload). Its row is not looked up.
  return { kind: 'restart-new', fileId: await deps.mintId(), resumeFileId: undefined }
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
