// ─── Encrypted chunked upload ──────────────────────
// Encrypts and uploads one chunk at a time. That keeps browser memory bounded
// to one plaintext chunk plus one encrypted chunk, even when the server returns
// a larger storage-v2 chunk plan.
//
// Supports resumable uploads: v1 uploads reconcile uploaded chunks through
// server status, while v2 uploads reuse the stored upload session and rely on
// idempotent chunk PUTs.

import {
  CHUNK_SIZE,
  encryptChunk,
  encryptFilename,
  serializeEncryptedBlob,
} from './crypto'
import { initUpload, uploadChunk, completeUpload, getUploadStatus, updateFile, ApiError } from './api'
import type { DriveFile } from './api'
import {
  computeFingerprint,
  findByFingerprint,
  saveUploadState,
  removeUploadState,
} from './upload-resume'

const FALLBACK_CHUNK_SIZE_BYTES = CHUNK_SIZE

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
  stage: 'Preparing' | 'Encrypting' | 'Uploading' | 'Done'
  progress: number
  /** Total bytes uploaded so far (only set during 'Uploading' stage) */
  bytesUploaded?: number
  uploadedChunks?: number
  totalChunks?: number
  chunkSizeBytes?: number
  region?: string | null
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

type FileKeyResolver = (fileId: string) => Promise<Uint8Array>

export async function encryptedUpload(
  file: File,
  fileId: string,
  fileKey: Uint8Array,
  parentId?: string,
  onProgress?: (p: UploadProgress) => void,
  resumeFileId?: string,
  sharedFolderContext?: SharedFolderUploadContext,
  signal?: AbortSignal,
  deriveFileKeyForId?: FileKeyResolver,
): Promise<DriveFile> {
  onProgress?.({ stage: 'Preparing', progress: 0 })

  const mimeType = file.type || null
  const metadataPlain = JSON.stringify({ name: file.name, mime_type: mimeType })
  // Detect media at upload time — MIME types are encrypted so the server cannot
  // infer this itself. is_media is stored unencrypted so the /files/media endpoint
  // can return all media files without decrypting anything.
  const isMedia = (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) ?? false
  let activeFileKey = fileKey
  let nameEncrypted = await encryptMetadata(activeFileKey)

  const fallbackChunkCount = Math.max(1, Math.ceil(file.size / FALLBACK_CHUNK_SIZE_BYTES))

  // ── Resume detection ──────────────────────────────
  let serverFileId = fileId
  let skipChunks = new Set<number>()
  let uploadSessionId: string | null = null
  let objectVersionId: string | null = null
  let chunkBytes = FALLBACK_CHUNK_SIZE_BYTES
  let totalChunks = fallbackChunkCount
  let region: string | null = null

  async function encryptMetadata(key: Uint8Array): Promise<string> {
    // Encrypt metadata as JSON so we can store MIME type zero-knowledge.
    // The server only sees the opaque ciphertext — it cannot infer the file type.
    // Backward-compat: old code encrypted just the filename string; new code
    // encrypts {"name":"filename","mime_type":"image/jpeg"}. Both formats are
    // handled by decryptFileMetadata() on the read side.
    const encName = await encryptFilename(key, metadataPlain)
    return serializeEncryptedBlob(encName.nonce, encName.ciphertext)
  }

  async function startUpload(): Promise<void> {
    const init = await withNetworkRetry(() => initUpload({
      file_id: fileId,
      name_encrypted: nameEncrypted,
      mime_type: null, // MIME is now encrypted in name_encrypted metadata
      size_bytes: file.size,
      chunk_count: fallbackChunkCount,
      parent_id: parentId ?? null,
      is_media: isMedia,
    }), signal)

    serverFileId = init.file_id
    totalChunks = init.chunk_count
    if (init.protocol !== 'v2') return

    uploadSessionId = init.upload_session_id
    objectVersionId = init.object_version_id
    chunkBytes = init.chunk_size_bytes
    region = init.region

    if (init.file_id === fileId) return

    if (!deriveFileKeyForId) {
      throw new Error('V2 upload init returned a server-generated file id, but no file-key resolver was provided.')
    }

    activeFileKey = await deriveFileKeyForId(init.file_id)
    nameEncrypted = await encryptMetadata(activeFileKey)
    await withNetworkRetry(() => updateFile(init.file_id, { name_encrypted: nameEncrypted }), signal)
  }

  if (resumeFileId) {
    // Caller explicitly wants to resume this file ID
    serverFileId = resumeFileId
    const fingerprint = await computeFingerprint(file)
    const existing = await findByFingerprint(fingerprint)
    if (existing?.fileId === resumeFileId && existing.upload_session_id) {
      uploadSessionId = existing.upload_session_id
      objectVersionId = existing.object_version_id ?? null
      chunkBytes = existing.chunk_size_bytes ?? FALLBACK_CHUNK_SIZE_BYTES
      totalChunks = existing.chunk_count ?? existing.totalChunks
      region = existing.region ?? null
    } else {
      if (existing?.fileId === resumeFileId) {
        chunkBytes = existing.chunk_size_bytes ?? FALLBACK_CHUNK_SIZE_BYTES
        totalChunks = existing.chunk_count ?? existing.totalChunks
        region = existing.region ?? null
      }
      try {
        const status = await getUploadStatus(resumeFileId)
        skipChunks = new Set(status.uploaded_chunks)
      } catch {
        // Status check failed — server record may be gone, start fresh
        skipChunks = new Set()
        await startUpload()
      }
    }
  } else {
    // Check IndexedDB for a matching fingerprint
    const fingerprint = await computeFingerprint(file)
    const existing = await findByFingerprint(fingerprint)

    if (
      existing &&
      existing.fileId === fileId &&
      existing.fileSize === file.size
    ) {
      // Found a prior upload — check server status
      serverFileId = existing.fileId
      chunkBytes = existing.chunk_size_bytes ?? FALLBACK_CHUNK_SIZE_BYTES
      totalChunks = existing.chunk_count ?? existing.totalChunks
      region = existing.region ?? null
      if (existing.upload_session_id) {
        uploadSessionId = existing.upload_session_id
        objectVersionId = existing.object_version_id ?? null
      } else {
        try {
          const status = await getUploadStatus(existing.fileId)
          skipChunks = new Set(status.uploaded_chunks)
        } catch {
          // Server doesn't know about it anymore — start fresh
          await removeUploadState(existing.fileId)
          await startUpload()
        }
      }
    } else {
      if (existing && existing.fileId !== fileId) {
        await removeUploadState(existing.fileId)
      }
      // No prior upload — start fresh
      await startUpload()
    }

    // Save state to IndexedDB for future resume
    await saveUploadState({
      fingerprint,
      fileId: serverFileId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      upload_session_id: uploadSessionId,
      object_version_id: objectVersionId,
      chunk_size_bytes: chunkBytes,
      chunk_count: totalChunks,
      region,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    })
  }

  // ── Upload chunks ─────────────────────────────────

  let completedChunks = skipChunks.size

  onProgress?.({
    stage: 'Uploading',
    progress: Math.round((completedChunks / totalChunks) * 95),
    bytesUploaded: Math.min(completedChunks * chunkBytes, file.size),
    uploadedChunks: completedChunks,
    totalChunks,
    chunkSizeBytes: chunkBytes,
    region,
  })

  function reportProgress() {
    completedChunks++
    const bytesUploaded = Math.min(completedChunks * chunkBytes, file.size)
    onProgress?.({
      stage: 'Uploading',
      progress: Math.round((completedChunks / totalChunks) * 95),
      bytesUploaded,
      uploadedChunks: completedChunks,
      totalChunks,
      chunkSizeBytes: chunkBytes,
      region,
    })
  }

  // Report initial progress for skipped chunks
  if (skipChunks.size > 0) {
    const bytesUploaded = Math.min(skipChunks.size * chunkBytes, file.size)
    onProgress?.({
      stage: 'Uploading',
      progress: Math.round((skipChunks.size / totalChunks) * 95),
      bytesUploaded,
      uploadedChunks: skipChunks.size,
      totalChunks,
      chunkSizeBytes: chunkBytes,
      region,
    })
  }

  async function encryptAndUpload(index: number): Promise<void> {
    if (skipChunks.has(index)) return

    const start = index * chunkBytes
    const end = Math.min(start + chunkBytes, file.size)
    const buffer = await file.slice(start, end).arrayBuffer()
    const plaintext = new Uint8Array(buffer)

    const encrypted = await encryptChunk(activeFileKey, plaintext)

    const combined = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
    combined.set(encrypted.nonce, 0)
    combined.set(encrypted.ciphertext, encrypted.nonce.length)

    await withNetworkRetry(() => uploadChunk(serverFileId, index, combined, uploadSessionId), signal)
    reportProgress()
  }

  // Upload chunks sequentially so large web chunks never overlap in memory.
  // The server-side Web profile currently caps chunks at 64 MiB; v1 fallback
  // stays at the historical 4 MiB constant from discovery task 0126.
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    if (skipChunks.has(i)) continue
    await encryptAndUpload(i)
  }

  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')

  const fileMeta = await completeUpload(serverFileId, uploadSessionId)

  // Clean up IndexedDB state on success
  await removeUploadState(serverFileId)

  // If uploading to a shared folder, register the file key under the folder_key
  if (sharedFolderContext) {
    const { encryptChildFileKey } = await import('./folder-share-crypto')
    const { addFolderKeys } = await import('./api')
    const encryptedKey = await encryptChildFileKey(sharedFolderContext.folderKey, activeFileKey)
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
      await encryptAndUploadThumbnail(serverFileId, thumbBlob, activeFileKey)
    }
  } catch {
    // Thumbnail generation is best-effort
  }

  onProgress?.({ stage: 'Done', progress: 100 })
  return fileMeta
}
