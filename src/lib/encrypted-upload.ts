// ─── Encrypted chunked upload ──────────────────────
// Pipelines encrypt + upload with 4 concurrent HTTP requests.
// While chunk N is uploading, chunk N+1 is encrypting — the worker
// and network run in parallel, not sequentially.

import {
  CHUNK_SIZE,
  encryptChunk,
  encryptFilename,
  toBase64,
} from './crypto'
import { initUpload, uploadChunk, completeUpload } from './api'
import type { DriveFile } from './api'

const PARALLEL_UPLOADS = 4

export interface UploadProgress {
  stage: 'Encrypting' | 'Uploading' | 'Done'
  progress: number
}

export async function encryptedUpload(
  file: File,
  fileId: string,
  fileKey: Uint8Array,
  parentId?: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<DriveFile> {
  onProgress?.({ stage: 'Encrypting', progress: 0 })

  const encName = await encryptFilename(fileKey, file.name)
  const nameEncrypted = JSON.stringify({
    nonce: toBase64(encName.nonce),
    ciphertext: toBase64(encName.ciphertext),
  })

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))

  const { file_id: serverFileId } = await initUpload({
    file_id: fileId,
    name_encrypted: nameEncrypted,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
    chunk_count: totalChunks,
    parent_id: parentId ?? null,
  })

  let completedChunks = 0

  function reportProgress() {
    completedChunks++
    onProgress?.({
      stage: 'Uploading',
      progress: Math.round((completedChunks / totalChunks) * 95),
    })
  }

  async function encryptAndUpload(index: number): Promise<void> {
    const start = index * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const buffer = await file.slice(start, end).arrayBuffer()
    const plaintext = new Uint8Array(buffer)

    const encrypted = await encryptChunk(fileKey, plaintext)

    const combined = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
    combined.set(encrypted.nonce, 0)
    combined.set(encrypted.ciphertext, encrypted.nonce.length)

    await uploadChunk(serverFileId, index, combined)
    reportProgress()
  }

  // Upload chunks with bounded concurrency
  const inflight = new Set<Promise<void>>()
  for (let i = 0; i < totalChunks; i++) {
    const p = encryptAndUpload(i)
    inflight.add(p)
    p.finally(() => inflight.delete(p))

    if (inflight.size >= PARALLEL_UPLOADS) {
      await Promise.race(inflight)
    }
  }
  await Promise.all(inflight)

  const fileMeta = await completeUpload(serverFileId)
  onProgress?.({ stage: 'Done', progress: 100 })
  return fileMeta
}
