/**
 * upload-dedup.ts
 *
 * Client-side duplicate detection for uploads. Hashes each file with
 * SHA-256 before encryption and warns users if they upload the same
 * content twice in the same session.
 *
 * The check is intentionally cheap: it runs BEFORE encryption so it
 * never becomes a bottleneck on large files. The map is module-level
 * (singleton per tab) and also persisted to sessionStorage so it
 * survives soft navigations within the same tab session.
 */

const SESSION_KEY = 'beebeeb.upload-dedup'

export interface UploadRecord {
  name: string
  uploadedAt: number
}

// Module-level map — singleton per browser tab
const uploadedFileHashes = new Map<string, UploadRecord>()

// Hydrate from sessionStorage on module load
;(function hydrate() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, UploadRecord>
    for (const [hash, record] of Object.entries(parsed)) {
      uploadedFileHashes.set(hash, record)
    }
  } catch {
    // sessionStorage unavailable or corrupted — start fresh
  }
})()

function persistToSession() {
  try {
    const obj: Record<string, UploadRecord> = {}
    for (const [hash, record] of uploadedFileHashes.entries()) {
      obj[hash] = record
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj))
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

/**
 * Compute the SHA-256 hash of a File and return it as a lowercase hex string.
 * Reads the entire file into memory — called before encryption, so it's the
 * smallest-possible representation of the file at this point in the pipeline.
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(hashBuffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Check whether a hash has already been recorded in this session.
 * Returns the existing record if found, otherwise null.
 */
export function checkDuplicate(hash: string): UploadRecord | null {
  return uploadedFileHashes.get(hash) ?? null
}

/**
 * Record a successful upload so future duplicate checks can find it.
 * Persists to sessionStorage so the record survives in-tab navigations.
 */
export function recordUpload(hash: string, name: string): void {
  uploadedFileHashes.set(hash, { name, uploadedAt: Date.now() })
  persistToSession()
}
