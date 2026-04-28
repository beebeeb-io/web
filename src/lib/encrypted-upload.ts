// ─── Encrypted upload ──────────────────────────────
// Chunks a file, encrypts each chunk + filename, uploads via API.

import {
  chunkFile,
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

  // 2. Chunk the file
  const chunks = await chunkFile(file)
  const totalChunks = chunks.length
  const encryptedChunks: Array<{ nonce: Uint8Array; ciphertext: Uint8Array }> = []

  for (let i = 0; i < totalChunks; i++) {
    const encrypted = await encryptChunk(fileKey, chunks[i])
    encryptedChunks.push(encrypted)
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

  // Append each encrypted chunk as nonce+ciphertext concatenated
  for (let i = 0; i < encryptedChunks.length; i++) {
    const { nonce, ciphertext } = encryptedChunks[i]
    // Prepend 12-byte nonce to ciphertext so the server stores them together
    const combined = new Uint8Array(nonce.length + ciphertext.length)
    combined.set(nonce, 0)
    combined.set(ciphertext, nonce.length)
    form.append(
      `chunk_${i}`,
      new Blob([combined], { type: 'application/octet-stream' }),
    )
    onProgress?.({
      stage: 'Uploading',
      progress: 40 + Math.round(((i + 1) / encryptedChunks.length) * 55),
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
