// ─── Encrypted chunked upload ──────────────────────
// Streams a file chunk-by-chunk: read slice -> encrypt -> upload via PUT.
// Only one plaintext + one ciphertext chunk are in memory at any time,
// so even 20GB+ files won't OOM the browser tab.

import {
  CHUNK_SIZE,
  encryptChunk,
  encryptFilename,
  toBase64,
} from './crypto'
import { initUpload, uploadChunk, completeUpload } from './api'
import type { DriveFile } from './api'

export interface UploadProgress {
  stage: 'Encrypting' | 'Uploading' | 'Done'
  /** 0-100 */
  progress: number
}

/**
 * Encrypt and upload a file with real E2EE using per-chunk HTTP requests.
 *
 * Flow:
 *   1. POST /upload/init   -> get server-assigned file_id
 *   2. For each 1MB chunk:  read slice -> encrypt in worker -> PUT chunk
 *   3. POST /upload/complete -> get final file metadata
 *
 * Memory: only ONE chunk in memory at a time (read -> encrypt -> upload -> free).
 * Progress: updates per-chunk as a single 0-100 range (no two-phase split).
 *
 * @param file       The raw File from the browser
 * @param fileId     Pre-generated UUID for this file (used for key derivation)
 * @param fileKey    Per-file encryption key (derived from master key + fileId)
 * @param parentId   Optional parent folder ID
 * @param onProgress Callback for progress updates
 */
export async function encryptedUpload(
  file: File,
  fileId: string,
  fileKey: Uint8Array,
  parentId?: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<DriveFile> {
  onProgress?.({ stage: 'Encrypting', progress: 0 })

  // 1. Encrypt the filename
  const encName = await encryptFilename(fileKey, file.name)
  const nameEncrypted = JSON.stringify({
    nonce: toBase64(encName.nonce),
    ciphertext: toBase64(encName.ciphertext),
  })

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))

  // 2. Init the upload on the server
  const { file_id: serverFileId } = await initUpload({
    file_id: fileId,
    name_encrypted: nameEncrypted,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
    chunk_count: totalChunks,
    parent_id: parentId ?? null,
  })

  // 3. Encrypt + upload chunks one at a time
  //    Each chunk = one progress tick across the full 0-100 range.
  for (let i = 0; i < totalChunks; i++) {
    // Read one slice from the File (uses file system, doesn't buffer the rest)
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const slice = file.slice(start, end)
    const buffer = await slice.arrayBuffer()
    const plaintext = new Uint8Array(buffer)

    // Encrypt this chunk (runs in Web Worker via Comlink)
    const encrypted = await encryptChunk(fileKey, plaintext)
    // plaintext is now eligible for GC

    // Prepend 12-byte nonce to ciphertext so the server stores them together
    const combined = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
    combined.set(encrypted.nonce, 0)
    combined.set(encrypted.ciphertext, encrypted.nonce.length)

    onProgress?.({
      stage: 'Uploading',
      progress: Math.round(((i + 0.5) / totalChunks) * 100),
    })

    // Upload this chunk as raw bytes
    await uploadChunk(serverFileId, i, combined)
    // combined + encrypted are now eligible for GC

    onProgress?.({
      stage: 'Uploading',
      progress: Math.round(((i + 1) / totalChunks) * 100),
    })
  }

  // 4. Complete the upload
  const fileMeta = await completeUpload(serverFileId)

  onProgress?.({ stage: 'Done', progress: 100 })
  return fileMeta
}
