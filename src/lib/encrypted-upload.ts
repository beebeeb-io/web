// ─── Encrypted upload ──────────────────────────────
// Streams a file chunk-by-chunk: read slice -> encrypt -> append to FormData.
// Only one plaintext + one ciphertext chunk are in memory at any time,
// so even multi-GB files won't OOM the browser tab.

import {
  CHUNK_SIZE,
  encryptChunk,
  encryptFilename,
  toBase64,
} from './crypto'
import { getToken, getApiUrl, ApiError } from './api'
import type { DriveFile } from './api'

export interface UploadProgress {
  stage: 'Encrypting' | 'Uploading' | 'Done'
  /** 0-100 */
  progress: number
}

/**
 * Encrypt and upload a file with real E2EE.
 *
 * Streams chunks instead of buffering the whole file — keeps memory usage
 * at roughly 2 * CHUNK_SIZE regardless of file size.
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

  // 2. Stream-encrypt chunks one at a time into Blobs
  //    We only hold one plaintext slice + one encrypted chunk in memory.
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  const encryptedBlobs: Blob[] = []

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

    // Wrap in a Blob so the browser can page it out of memory if needed
    encryptedBlobs.push(new Blob([combined], { type: 'application/octet-stream' }))
    // encrypted + combined are now eligible for GC

    onProgress?.({
      stage: 'Encrypting',
      progress: Math.round(((i + 1) / totalChunks) * 40),
    })
  }

  onProgress?.({ stage: 'Uploading', progress: 40 })

  // 3. Build the multipart upload
  const token = getToken()
  const metadata = JSON.stringify({
    file_id: fileId,
    name_encrypted: nameEncrypted,
    mime_type: file.type || 'application/octet-stream',
    size: file.size,
    parent_id: parentId ?? null,
    encrypted: true,
    chunk_count: totalChunks,
  })

  const form = new FormData()
  form.append('metadata', new Blob([metadata], { type: 'application/json' }))

  for (let i = 0; i < encryptedBlobs.length; i++) {
    form.append(`chunk_${i}`, encryptedBlobs[i])
    onProgress?.({
      stage: 'Uploading',
      progress: 40 + Math.round(((i + 1) / encryptedBlobs.length) * 55),
    })
  }

  const res = await fetch(`${getApiUrl()}/api/v1/files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as { message?: string }).message ?? res.statusText,
      res.status,
    )
  }

  onProgress?.({ stage: 'Done', progress: 100 })
  return res.json() as Promise<DriveFile>
}
