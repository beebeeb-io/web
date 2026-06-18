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
  planChunks,
  startEncryptedStream,
  startEncryptedStreamWithChunkSize,
  encryptFilename,
  serializeEncryptedBlob,
} from './crypto'
import { initUpload, uploadChunk, completeUpload, getUploadStatus, updateFile } from './api'
import { withNetworkRetry } from './net-retry'
import type { DriveFile } from './api'
import {
  computeFingerprint,
  findByFingerprint,
  saveUploadState,
  removeUploadState,
} from './upload-resume'
import { isLikelyAlbumArtOrIcon } from './photo-library'

/**
 * Legacy fallback — only used when WASM plan_chunks is unavailable.
 * New uploads call planChunks() to get the adaptive chunk size.
 */
const LEGACY_FALLBACK_CHUNK_SIZE_BYTES = CHUNK_SIZE

// `withNetworkRetry` (exponential backoff for transient fetch-throws, layered on
// top of api.ts request()'s 800ms retry) is shared with share downloads — it now
// lives in ./net-retry (imported above).

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
  masterKey: Uint8Array,
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
  const isMediaMime = (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) ?? false
  // cover.jpg stopgap (spec 2026-06-17 §ASK 3): is_media is the only lever the
  // Photos view filters on today, so the minimal fix is to NOT flag obvious
  // album art / icons as media — that keeps a Music folder's cover.jpg out of
  // Photos without a schema change. The file still uploads normally and appears
  // in the Drive listing (which doesn't filter on is_media); only its Photos
  // membership changes. The heuristic is conservative — it errs toward leaving
  // real photos in (see photo-library.ts).
  const isMedia = isMediaMime && !isLikelyAlbumArtOrIcon(file.name, file.size, mimeType)
  let activeFileKey = fileKey
  let nameEncrypted = await encryptMetadata(activeFileKey)

  // Use the core adaptive chunk-size ladder for the initial client proposal.
  // The server may override this during v2 init — the client proposes, server decides.
  let fallbackPlan: { chunk_size_bytes: number; chunk_count: number }
  try {
    fallbackPlan = await planChunks(file.size, 'web')
  } catch {
    // WASM not available (e.g. worker not initialized yet) — use legacy constant
    fallbackPlan = {
      chunk_size_bytes: LEGACY_FALLBACK_CHUNK_SIZE_BYTES,
      chunk_count: Math.max(1, Math.ceil(file.size / LEGACY_FALLBACK_CHUNK_SIZE_BYTES)),
    }
  }
  const fallbackChunkCount = fallbackPlan.chunk_count

  // ── Resume detection ──────────────────────────────
  let serverFileId = fileId
  let skipChunks = new Set<number>()
  let uploadSessionId: string | null = null
  let objectVersionId: string | null = null
  let chunkBytes = fallbackPlan.chunk_size_bytes
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
      chunkBytes = existing.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
      totalChunks = existing.chunk_count ?? existing.totalChunks
      region = existing.region ?? null
    } else {
      if (existing?.fileId === resumeFileId) {
        chunkBytes = existing.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
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
      chunkBytes = existing.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
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

  // ── Streaming encryption via the shared core ChunkEncryptor ───────────────
  // Create the worker-owned encryptor now that the server has fixed the chunk
  // plan + final file id. The per-file key is derived ONCE inside core from
  // masterKey + serverFileId — the SAME derivation that produced `activeFileKey`
  // — so we pass masterKey here and keep `activeFileKey` only for the metadata,
  // thumbnail, and folder-share paths below.
  //
  // If the v2 server overrode the chunk size, pin the encryptor to that exact
  // size so its internal plan can't diverge from the slices we PUT. Otherwise
  // use the web ladder, which is identical to the `planChunks()` proposal above
  // (both call core's `plan_chunks`), so chunk_count stays consistent with init.
  const serverOverrodeChunkSize = chunkBytes !== fallbackPlan.chunk_size_bytes
  const enc = serverOverrodeChunkSize
    ? await startEncryptedStreamWithChunkSize(masterKey, serverFileId, file.size, chunkBytes)
    : await startEncryptedStream(masterKey, serverFileId, file.size, 'web')

  try {
    // Upload chunks sequentially so large web chunks never overlap in memory:
    // only one plaintext slice + one ciphertext frame are alive per iteration.
    //
    // Push EVERY chunk in order so the encryptor's nonce/index/count stay in
    // lockstep with finish()'s integrity guard — INCLUDING chunks the server
    // already has on resume: we still push them to advance the stream, we just
    // don't re-PUT them.
    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')

      const start = i * chunkBytes
      const end = Math.min(start + chunkBytes, file.size)
      const buffer = await file.slice(start, end).arrayBuffer()
      // pushChunk transfers the plaintext into the worker (zero-copy) and
      // returns the full wire frame (nonce || ciphertext || tag) to PUT directly.
      const frame = await enc.pushChunk(new Uint8Array(buffer))

      if (skipChunks.has(i)) continue // already uploaded — pushed for alignment only

      await withNetworkRetry(() => uploadChunk(serverFileId, i, frame, uploadSessionId), signal)
      reportProgress()
    }

    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')

    // Integrity guard: confirms all planned chunks were emitted and the
    // ciphertext total matches before we tell the server the upload is done.
    // A shrinking/corrupt source throws here and surfaces as an upload error.
    await enc.finish()
  } catch (err) {
    // Free the worker-side encryptor for aborted/failed uploads. No-op after
    // a successful finish() (the handle is already gone).
    await enc.dispose()
    throw err
  }

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

  // Generate and upload encrypted thumbnails for image files (medium + large)
  try {
    const { generateThumbnail, encryptAndUploadThumbnail, generateLargeThumbnail, encryptAndUploadLargeThumbnail } = await import('./thumbnail')
    const thumbBlob = await generateThumbnail(file)
    const largeThumbPromise = generateLargeThumbnail(file).then(async (largeBlob) => {
      if (largeBlob) await encryptAndUploadLargeThumbnail(serverFileId, largeBlob, activeFileKey)
    }).catch(() => {})
    if (thumbBlob) {
      await encryptAndUploadThumbnail(serverFileId, thumbBlob, activeFileKey)
    }
    await largeThumbPromise
  } catch {
    // Thumbnail generation is best-effort
  }

  onProgress?.({ stage: 'Done', progress: 100 })
  return fileMeta
}
