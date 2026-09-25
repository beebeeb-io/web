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
 * Files larger than this are skipped by the dedup hash entirely (task 1544
 * finding 4). Browsers have no incremental/streaming `SubtleCrypto.digest`
 * — hashing requires the whole file in one ArrayBuffer — which directly
 * contradicts the streaming upload's bounded-memory guarantee (see
 * repos/web/CLAUDE.md "Uploads (streaming encryption)": "Memory stays
 * bounded to one slice + one frame") for exactly the large-file case the
 * product markets as supported (Pro: up to 500 GB/file, uploads.rs
 * max_file_bytes). Below this threshold the memory spike is small and the
 * dedup UX is preserved for the overwhelming majority of uploads (photos,
 * documents, typical videos); above it, the upload proceeds without a
 * dedup check rather than risking a multi-GB buffer allocation.
 */
export const DEDUP_HASH_MAX_BYTES = 256 * 1024 * 1024 // 256 MiB

/**
 * Compute the SHA-256 hash of a File and return it as a lowercase hex
 * string, or `null` if the file exceeds `DEDUP_HASH_MAX_BYTES` (dedup is
 * skipped for it — see that constant's doc comment). Reads the entire file
 * into memory when it does hash — called before encryption, so it's the
 * smallest-possible representation of the file at this point in the
 * pipeline, but only safe to do below the size threshold.
 */
export async function hashFile(file: File): Promise<string | null> {
  if (file.size > DEDUP_HASH_MAX_BYTES) return null
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
