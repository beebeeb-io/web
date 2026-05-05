// ─── Encrypted chunked upload ──────────────────────
// Pipelines encrypt + upload with 4 concurrent HTTP requests.
// While chunk N is uploading, chunk N+1 is encrypting — the worker
// and network run in parallel, not sequentially.
//
// Supports resumable uploads: if a matching fingerprint is found in
// IndexedDB and the server confirms a partial upload, we skip
// already-uploaded chunks and only encrypt+upload the missing ones.

import {
  CHUNK_SIZE,
  encryptChunk,
  encryptFilename,
  toBase64,
} from './crypto'
import { initUpload, uploadChunk, completeUpload, getUploadStatus, ApiError } from './api'
import type { DriveFile } from './api'
import {
  computeFingerprint,
  findByFingerprint,
  saveUploadState,
  removeUploadState,
} from './upload-resume'

const PARALLEL_UPLOADS = 4

/**
 * Long-form retry delay for transient network failures, layered on top of
 * the 800ms retry already inside `api.ts request()`. Together they give an
 * upload three chances spaced ~3.8s apart — enough to ride out a typical
 * cargo-watch / API restart window without surfacing the blip to the user.
 */
const NETWORK_RETRY_DELAY_MS = 3000

/**
 * Wrap a network call so a network-class failure (`ApiError(_, status === 0)`,
 * i.e. `fetch` itself threw before getting any response) gets one extra retry
 * after a longer delay. HTTP errors (4xx/5xx) bubble immediately — those are
 * deterministic, not transient.
 *
 * Honours an optional AbortSignal: if the user cancels during the delay window
 * we throw an AbortError instead of retrying.
 */
async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const isNetwork = err instanceof ApiError && err.status === 0
    if (!isNetwork || signal?.aborted) throw err
    await new Promise<void>((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    return await fn()
  }
}

export interface UploadProgress {
  stage: 'Encrypting' | 'Uploading' | 'Done'
  progress: number
  /** Total bytes uploaded so far (only set during 'Uploading' stage) */
  bytesUploaded?: number
}

/**
 * Perform an encrypted upload, resuming if a prior partial upload
 * for the same file is found.
 *
 * When `resumeFileId` is provided (from a resume banner click), it
 * skips the fingerprint lookup and goes straight to server status check.
 */
export interface SharedFolderUploadContext {
  folderKey: Uint8Array
  sharedFolderId: string
  inviteId: string
}

export async function encryptedUpload(
  file: File,
  fileId: string,
  fileKey: Uint8Array,
  parentId?: string,
  onProgress?: (p: UploadProgress) => void,
  resumeFileId?: string,
  sharedFolderContext?: SharedFolderUploadContext,
  signal?: AbortSignal,
): Promise<DriveFile> {
  onProgress?.({ stage: 'Encrypting', progress: 0 })

  // Encrypt metadata as JSON so we can store MIME type zero-knowledge.
  // The server only sees the opaque ciphertext — it cannot infer the file type.
  // Backward-compat: old code encrypted just the filename string; new code
  // encrypts {"name":"filename","mime_type":"image/jpeg"}. Both formats are
  // handled by decryptFileMetadata() on the read side.
  const mimeType = file.type || null
  const metadataPlain = JSON.stringify({ name: file.name, mime_type: mimeType })
  const encName = await encryptFilename(fileKey, metadataPlain)
  const nameEncrypted = JSON.stringify({
    nonce: toBase64(encName.nonce),
    ciphertext: toBase64(encName.ciphertext),
  })

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))

  // ── Resume detection ──────────────────────────────
  let serverFileId: string
  let skipChunks = new Set<number>()

  if (resumeFileId) {
    // Caller explicitly wants to resume this file ID
    serverFileId = resumeFileId
    try {
      const status = await getUploadStatus(resumeFileId)
      skipChunks = new Set(status.uploaded_chunks)
    } catch {
      // Status check failed — server record may be gone, start fresh
      skipChunks = new Set()
      const { file_id } = await withNetworkRetry(() => initUpload({
        file_id: fileId,
        name_encrypted: nameEncrypted,
        mime_type: null, // MIME is now encrypted in name_encrypted metadata
        size_bytes: file.size,
        chunk_count: totalChunks,
        parent_id: parentId ?? null,
      }), signal)
      serverFileId = file_id
    }
  } else {
    // Check IndexedDB for a matching fingerprint
    const fingerprint = await computeFingerprint(file)
    const existing = await findByFingerprint(fingerprint)

    if (existing && existing.totalChunks === totalChunks && existing.fileSize === file.size) {
      // Found a prior upload — check server status
      serverFileId = existing.fileId
      try {
        const status = await getUploadStatus(existing.fileId)
        skipChunks = new Set(status.uploaded_chunks)
        // Use the original fileId for key derivation consistency
        fileId = existing.fileId
      } catch {
        // Server doesn't know about it anymore — start fresh
        await removeUploadState(existing.fileId)
        const { file_id } = await withNetworkRetry(() => initUpload({
          file_id: fileId,
          name_encrypted: nameEncrypted,
          mime_type: null, // MIME is now encrypted in name_encrypted metadata
          size_bytes: file.size,
          chunk_count: totalChunks,
          parent_id: parentId ?? null,
        }), signal)
        serverFileId = file_id
      }
    } else {
      // No prior upload — start fresh
      const { file_id } = await withNetworkRetry(() => initUpload({
        file_id: fileId,
        name_encrypted: nameEncrypted,
        mime_type: null, // MIME is now encrypted in name_encrypted metadata
        size_bytes: file.size,
        chunk_count: totalChunks,
        parent_id: parentId ?? null,
      }), signal)
      serverFileId = file_id
    }

    // Save state to IndexedDB for future resume
    await saveUploadState({
      fingerprint,
      fileId: serverFileId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    })
  }

  // ── Upload chunks ─────────────────────────────────

  let completedChunks = skipChunks.size
  const chunkBytes = CHUNK_SIZE

  function reportProgress() {
    completedChunks++
    const bytesUploaded = Math.min(completedChunks * chunkBytes, file.size)
    onProgress?.({
      stage: 'Uploading',
      progress: Math.round((completedChunks / totalChunks) * 95),
      bytesUploaded,
    })
  }

  // Report initial progress for skipped chunks
  if (skipChunks.size > 0) {
    const bytesUploaded = Math.min(skipChunks.size * chunkBytes, file.size)
    onProgress?.({
      stage: 'Uploading',
      progress: Math.round((skipChunks.size / totalChunks) * 95),
      bytesUploaded,
    })
  }

  async function encryptAndUpload(index: number): Promise<void> {
    if (skipChunks.has(index)) return

    const start = index * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const buffer = await file.slice(start, end).arrayBuffer()
    const plaintext = new Uint8Array(buffer)

    const encrypted = await encryptChunk(fileKey, plaintext)

    const combined = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
    combined.set(encrypted.nonce, 0)
    combined.set(encrypted.ciphertext, encrypted.nonce.length)

    await withNetworkRetry(() => uploadChunk(serverFileId, index, combined), signal)
    reportProgress()
  }

  // Upload chunks with bounded concurrency
  const inflight = new Set<Promise<void>>()
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    if (skipChunks.has(i)) continue

    const p = encryptAndUpload(i)
    inflight.add(p)
    p.finally(() => inflight.delete(p))

    if (inflight.size >= PARALLEL_UPLOADS) {
      await Promise.race(inflight)
    }
  }
  await Promise.all(inflight)

  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')

  const fileMeta = await completeUpload(serverFileId)

  // Clean up IndexedDB state on success
  await removeUploadState(serverFileId)

  // If uploading to a shared folder, register the file key under the folder_key
  if (sharedFolderContext) {
    const { encryptChildFileKey } = await import('./folder-share-crypto')
    const { addFolderKeys } = await import('./api')
    const encryptedKey = await encryptChildFileKey(sharedFolderContext.folderKey, fileKey)
    await addFolderKeys(sharedFolderContext.inviteId, [{
      file_id: serverFileId,
      encrypted_file_key: encryptedKey,
    }])
  }

  // Generate and upload encrypted thumbnail for image files
  try {
    const { generateThumbnail, encryptAndUploadThumbnail } = await import('./thumbnail')
    const thumbBlob = await generateThumbnail(file)
    if (thumbBlob) {
      await encryptAndUploadThumbnail(serverFileId, thumbBlob, fileKey)
    }
  } catch {
    // Thumbnail generation is best-effort
  }

  onProgress?.({ stage: 'Done', progress: 100 })
  return fileMeta
}
