import { WorkQueue } from './work-queue'
import { expectedUserHeaders } from '@beebeeb/shared'
// ─── Encrypted chunked upload ──────────────────────
// Encrypts and uploads one chunk at a time. That keeps browser memory bounded
// to one plaintext chunk plus one encrypted chunk, even when the server returns
// a larger storage-v2 chunk plan.
//
// Supports resumable uploads: v1 uploads reconcile uploaded chunks through
// server status, while v2 uploads reuse the stored upload session and rely on
// idempotent chunk PUTs. Since task 1943 a resume first asks core's resume
// rule (`resumePolicy`): only a v1 session resumed by a v1 writer continues;
// anything else abandons the old session and uploads from chunk 0 into a
// fresh one (a v2 writer's frames bind a new version id).

import {
  CHUNK_SIZE,
  planChunks,
  startEncryptedStream,
  startEncryptedStreamWithChunkSize,
  encryptFilename,
  serializeEncryptedBlob,
  readFileMetadata,
  toContentPin,
  UnverifiedFileMetadataError,
  type ContentPin,
} from './crypto'
import { initUpload, uploadChunk, completeUpload, getUploadStatus, updateFile, abandonUpload } from './api'
import { withNetworkRetry } from './net-retry'
import type { DriveFile } from './api'
import {
  computeFingerprint,
  findByFingerprint,
  saveUploadState,
  removeUploadState,
} from './upload-resume'
import { isLikelyAlbumArtOrIcon } from './photo-library'
import { runWithSessionReinit } from './upload-session-reinit'

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

interface EncryptedUploadOptions {
  conflictCreated?: boolean
  /**
   * Set ONLY when this upload is a new version of an EXISTING file (Replace,
   * a same-file editor save): that file's current `name_encrypted`.
   *
   * Core 1908 checklist item 4: the server keeps a file's `name_encrypted` on
   * replace, and every version of a file id is read with the pin it records.
   * So a replace reads the pin from it (core's FILE reader) and the encryptor
   * writes in that format; if the pin cannot be read, nothing is uploaded.
   *
   * A brand-new file id never passes this (lead ruling 2026-10-17): the plain
   * encryptor then writes core's WRITE_FORMAT and no pin is ever applied, so
   * the web can never create a v2 file before the gated write switch.
   * test/1943-writer-pin.test.ts holds both rules.
   */
  replaceOf?: { nameEncrypted: string }
}

/**
 * Core said the stored session must not be continued (task 1943): the caller
 * abandons it and uploads from chunk 0 into a fresh session. Internal signal.
 */
class SessionRestartRequired extends Error {
  constructor() {
    super('resume refused by the core resume rule; restarting in a fresh session')
    this.name = 'SessionRestartRequired'
  }
}

/** Shown when a replace is refused because the existing file's pin cannot be read. */
export const UNVERIFIED_REPLACE_COPY =
  "We couldn't verify this file's encrypted details, so it was not replaced."

const uploadAdmission = new WorkQueue(2)

/** All upload entry points share admission, including retries and folder uploads. */
export function encryptedUpload(...args: Parameters<typeof uploadFile>): ReturnType<typeof uploadFile> {
  const owner = expectedUserHeaders()['X-Beebeeb-Expected-User']
  return uploadAdmission.run(() => {
    // Folder uploads may have no signal. Never let queued keys/file bytes adopt
    // another account's session, or start after the resident vault key is cleared.
    if (expectedUserHeaders()['X-Beebeeb-Expected-User'] !== owner) {
      throw new DOMException('Upload account changed while queued', 'AbortError')
    }
    return uploadFile(...args)
  }, args[8])
}

async function uploadFile(
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
  options: EncryptedUploadOptions = {},
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

  // Replace only: the existing file's recorded pin, read BEFORE anything
  // reaches the server. A new file stays `null` and never applies a pin.
  let replacePin: ContentPin | null = null
  if (options.replaceOf) {
    try {
      replacePin = (await readFileMetadata(fileKey, options.replaceOf.nameEncrypted)).pin
    } catch (err) {
      throw new UnverifiedFileMetadataError(UNVERIFIED_REPLACE_COPY, { cause: err })
    }
  }

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
  // Core 1908 resume rule (checklist item 7): the chunk format of the frames
  // the current session already holds (from the resume record; undefined when
  // it does not say), and whether this call resumes STORED frames rather than
  // a session it opened itself.
  let sessionFormat: number | undefined
  let resumingStoredFrames = false

  async function encryptMetadata(key: Uint8Array): Promise<string> {
    // Encrypt metadata as JSON so we can store MIME type zero-knowledge.
    // The server only sees the opaque ciphertext — it cannot infer the file type.
    // Backward-compat: old code encrypted just the filename string; new code
    // encrypts {"name":"filename","mime_type":"image/jpeg"}. Both formats are
    // handled by decryptFileMetadata() on the read side.
    const encName = await encryptFilename(key, metadataPlain)
    return serializeEncryptedBlob(encName.nonce, encName.ciphertext)
  }

  async function startUpload(requestedFileId: string = fileId): Promise<void> {
    // `signal` MUST reach the actual `fetch()` call, not just `withNetworkRetry`
    // (task 1571 web PR #106, Codex P1) — otherwise a discard-during-save
    // aborts nothing server-side: `/api/v1/uploads/init` runs to completion
    // and sets `files.is_uploading = TRUE` regardless, and a fire-and-forget
    // `abandonUpload` issued at the moment of abort can land BEFORE that,
    // see `not_uploading` (nothing to abandon yet), and leave the file
    // wedged once init's late response arrives.
    const init = await withNetworkRetry(() => initUpload({
      file_id: requestedFileId,
      name_encrypted: nameEncrypted,
      size_bytes: file.size,
      chunk_count: fallbackChunkCount,
      parent_id: parentId ?? null,
      is_media: isMedia,
      conflict_created: options.conflictCreated ?? false,
    }, signal), signal)

    serverFileId = init.file_id
    totalChunks = init.chunk_count
    // A fresh session holds no frames: nothing to resume, nothing recorded yet.
    sessionFormat = undefined
    resumingStoredFrames = false
    if (init.protocol !== 'v2') return

    uploadSessionId = init.upload_session_id
    objectVersionId = init.object_version_id
    chunkBytes = init.chunk_size_bytes
    region = init.region

    if (init.file_id === requestedFileId) return

    if (!deriveFileKeyForId) {
      throw new Error('V2 upload init returned a server-generated file id, but no file-key resolver was provided.')
    }

    activeFileKey = await deriveFileKeyForId(init.file_id)
    nameEncrypted = await encryptMetadata(activeFileKey)
    await withNetworkRetry(() => updateFile(init.file_id, { name_encrypted: nameEncrypted }, signal), signal)
  }

  let fingerprint: string
  if (resumeFileId) {
    // Caller explicitly wants to resume this file ID
    serverFileId = resumeFileId
    fingerprint = await computeFingerprint(file)
    const existing = await findByFingerprint(fingerprint)
    const record = existing?.fileId === resumeFileId ? existing : null
    adoptRecordedReplacePin(record)
    if (record?.upload_session_id) {
      uploadSessionId = record.upload_session_id
      objectVersionId = record.object_version_id ?? null
      chunkBytes = record.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
      totalChunks = record.chunk_count ?? record.totalChunks
      region = record.region ?? null
      resumingStoredFrames = true
      sessionFormat = record.chunk_format
    } else {
      if (record) {
        chunkBytes = record.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
        totalChunks = record.chunk_count ?? record.totalChunks
        region = record.region ?? null
      }
      try {
        const status = await getUploadStatus(resumeFileId)
        skipChunks = new Set(status.uploaded_chunks)
        resumingStoredFrames = true
        sessionFormat = record?.chunk_format
      } catch {
        // Status check failed — server record may be gone, start fresh
        skipChunks = new Set()
        await startUpload()
      }
    }
  } else {
    // Check IndexedDB for a matching fingerprint
    fingerprint = await computeFingerprint(file)
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
      adoptRecordedReplacePin(existing)
      if (existing.upload_session_id) {
        uploadSessionId = existing.upload_session_id
        objectVersionId = existing.object_version_id ?? null
        resumingStoredFrames = true
        sessionFormat = existing.chunk_format
      } else {
        try {
          const status = await getUploadStatus(existing.fileId)
          skipChunks = new Set(status.uploaded_chunks)
          resumingStoredFrames = true
          sessionFormat = existing.chunk_format
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
    await persistResumeState()
  }

  async function persistResumeState(): Promise<void> {
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
      chunk_format: sessionFormat,
      replace_pin: replacePin ?? undefined,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    })
  }

  /**
   * A resumed REPLACE writes with the pin it applied before (recorded from the
   * replaced file's authenticated metadata). A caller's fresh `replaceOf` read
   * wins; a record without a pin is a new file, which never pins.
   */
  function adoptRecordedReplacePin(record: { replace_pin?: number } | null | undefined): void {
    if (replacePin !== null || record?.replace_pin === undefined) return
    replacePin = toContentPin(record.replace_pin)
  }

  /**
   * Core said restart: never PUT into the old session again. Abandon it (a
   * replace reverts to the previous version, a never-completed first upload
   * is deleted), drop its resume record, init a fresh session for the same
   * file id and record it. If the old lease is still live elsewhere the init
   * answers 409 and the upload fails here, untouched.
   */
  async function restartInFreshSession(): Promise<void> {
    const id = serverFileId
    try {
      await abandonUpload(id)
    } catch {
      // Nothing to abandon (the lease expired and the session was swept, or
      // there is no upload in progress): the init below decides.
    }
    await removeUploadState(id).catch(() => {})
    skipChunks = new Set()
    uploadSessionId = null
    objectVersionId = null
    chunkBytes = fallbackPlan.chunk_size_bytes
    totalChunks = fallbackChunkCount
    region = null
    await startUpload(id)
    await persistResumeState()
  }

  // Transfers every chunk against the CURRENT session and completes it. Run
  // again from chunk 0 (with a fresh encryptor) after a re-init.
  async function transferAndComplete(): Promise<DriveFile> {
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
      // Replace of an existing file: write in the format its recorded pin
      // requires, before the first chunk. Only when the server kept OUR file
      // id: an answer with another id is a brand-new file, which never pins.
      if (replacePin !== null && serverFileId === fileId) {
        await enc.applyRecordedPin(replacePin)
      }

      // Core's resume rule decides whether stored frames may be continued.
      const writing = await enc.format()
      if (resumingStoredFrames && (await enc.resumePolicy(sessionFormat)) !== 'continue') {
        throw new SessionRestartRequired()
      }
      // Record which frames this session holds BEFORE the first PUT.
      if (sessionFormat !== writing) {
        sessionFormat = writing
        await persistResumeState()
      }

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

        await withNetworkRetry(() => uploadChunk(serverFileId, i, frame, uploadSessionId, signal), signal)
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

    return completeUpload(serverFileId, uploadSessionId)
  }

  // ── Upload chunks + complete ──────────────────────
  // Task 1589: a v2 session the server swept (lease expired while the tab was
  // closed / the laptop slept) answers 404 (or 400 "not writable: expired").
  // runWithSessionReinit then drops the dead resume entry, re-inits ONCE for
  // the same file id and runs transferAndComplete again from chunk 0.
  // A resume refused by core's rule restarts ONCE in a fresh session.
  async function transferObeyingResumeRule(): Promise<DriveFile> {
    try {
      return await transferAndComplete()
    } catch (err) {
      if (!(err instanceof SessionRestartRequired)) throw err
    }
    await restartInFreshSession()
    return transferAndComplete()
  }

  const fileMeta = await runWithSessionReinit({
    attempt: transferObeyingResumeRule,
    hasSession: () => uploadSessionId !== null,
    dropResumeEntry: () => removeUploadState(serverFileId),
    reinit: async () => {
      const requested = serverFileId
      uploadSessionId = null
      objectVersionId = null
      skipChunks = new Set()
      chunkBytes = fallbackPlan.chunk_size_bytes
      totalChunks = fallbackChunkCount
      region = null
      await startUpload(requested)
      await persistResumeState()
    },
    signal,
  })

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
