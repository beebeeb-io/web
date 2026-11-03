// Encrypts and uploads one file, reporting honest progress and shared-folder context.
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
// anything else leaves the old session alone and uploads from chunk 0 into a
// fresh one (a v2 writer's frames bind a new version id); the server's init
// takes over the old session once its lease has expired.

import {
  CHUNK_SIZE,
  planChunks,
  startEncryptedStream,
  startEncryptedStreamForNewItem,
  startEncryptedStreamWithChunkSize,
  encryptFilename,
  serializeEncryptedBlob,
  readFileMetadata,
  toContentPin,
  UnverifiedFileMetadataError,
  deriveFileKey,
  zeroize,
  type ContentPin,
} from './crypto'
import { abandonUpload, initUpload, uploadChunk, completeUpload, getUploadStatus } from './api'
import { isServerChangedItemIdError } from './item-id-echo'
import { lookupOwnRow } from './stored-row'
import { withNetworkRetry } from './net-retry'
import { fileStorageCountry } from './storage-regions'
import type { DriveFile } from './api'
import {
  computeFingerprint,
  findByFingerprint,
  saveUploadState,
  removeUploadState,
  recordedCountry,
  planResume,
  PausedVersionRefusedError,
  type ResumePlan,
  type UploadState,
} from './upload-resume'
import { isLikelyAlbumArtOrIcon } from './photo-library'
import { assertOwnerRepairWritable } from './owner-repair'
import { runWithSessionReinit } from './upload-session-reinit'
import { ownedItem } from './owned-item'

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
  /**
   * Task 2062 — the COUNTRY the server chose at init (`storage_location.country`),
   * known before the first byte moves. Restored from the resume record for a resumed
   * session (task 2083); null for an old record and for an unknown pool. Never a city.
   */
  country?: string | null
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
  /** L7b: the shared folder's wrap format, from its custody record. */
  format: import('./folder-share-crypto').FolderWrapFormat
  sharedFolderId: string
  inviteId: string
}

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
  /**
   * L13 (contract 2275): the `NewItemId` this create proposes, minted by core
   * for THIS upload (`mintUploadIdentity`). When present the id text must be
   * exactly the id the caller passed — core re-checks the tag before any
   * seal — and the content is sealed through core's `forNewItem`.
   */
  newItemId?: { idText: string; tag: Uint8Array }
}

/**
 * Core said the stored session must not be continued (task 1943): the caller
 * never PUTs into it again and uploads from chunk 0 into a fresh session.
 * Internal signal.
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

/**
 * A fresh id for an upload that may not reuse the id it found: minted in core
 * (L13), never a JS v4, so the id carries the tag a create proposes.
 */
const mintFileId = async (masterKey: Uint8Array) => ownedItem.mint(masterKey, 'owner')

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

/** `uploadFile`'s parameters: `uploadFileWith`'s, without its own-keys list. */
type UploadFileArgs = Parameters<typeof uploadFileWith> extends [Uint8Array[], ...infer Rest] ? Rest : never

/**
 * One upload. Keys it derives itself (an upload restarted under an id it
 * minted, see `writeUnderOwnId`) are zeroized when it ends, whatever the
 * outcome; keys the caller passed in stay the caller's.
 */
async function uploadFile(...args: UploadFileArgs): Promise<DriveFile> {
  const ownKeys: Uint8Array[] = []
  try {
    return await uploadFileWith(ownKeys, ...args)
  } finally {
    for (const key of ownKeys) zeroize(key)
  }
}

async function uploadFileWith(
  ownKeys: Uint8Array[],
  file: File,
  fileId: string,
  fileKey: Uint8Array,
  masterKey: Uint8Array,
  parentId?: string,
  onProgress?: (p: UploadProgress) => void,
  resumeFileId?: string,
  sharedFolderContext?: SharedFolderUploadContext,
  signal?: AbortSignal,
  options: EncryptedUploadOptions = {},
): Promise<DriveFile> {
  // SF-0002: a repaired read-only row is never replaced or given a new
  // version. A NEW upload (fresh id) is unaffected: only a marked id throws.
  assertOwnerRepairWritable(fileId)
  // L13: a create proposes the id THIS client minted and only that id. Core
  // re-checks the (id, tag) pair here, before a name, a chunk or a resume
  // record can be sealed; a caller that hands a different id is a bug.
  if (options.newItemId) {
    if (options.newItemId.idText !== fileId) {
      throw new Error('new-item id mismatch: the upload writes an id it did not mint')
    }
    await ownedItem.resume(masterKey, options.newItemId.idText, options.newItemId.tag)
  }
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
  // F9: the core-minted handle this create proposes. It starts as the caller's
  // and, when a stored session restarts under a fresh id, becomes the id minted
  // here — so the restart re-proves its tag instead of discarding it.
  let newItemId = options.newItemId

  // Replace only: the existing file's recorded pin, read BEFORE anything
  // reaches the server. A new file stays `null` and never applies a pin.
  // A pin belongs to ONE file id, the replaced file's, which is the id this
  // upload writes under (L13: every init and completion answer is checked
  // against it, so it cannot change under the pin). A pin is resumed only from
  // a record that names that id (`adoptRecordedReplacePin`).
  let replacePin: ContentPin | null = null
  if (options.replaceOf) replacePin = await readReplacedPin(options.replaceOf.nameEncrypted)

  /** The pin a replaced row's own stored name records; refused if it does not authenticate. */
  async function readReplacedPin(rowName: string): Promise<ContentPin> {
    try {
      return (await readFileMetadata(fileKey, rowName)).pin
    } catch (err) {
      throw new UnverifiedFileMetadataError(UNVERIFIED_REPLACE_COPY, { cause: err })
    }
  }

  /**
   * True while this upload creates a NEW item under an id minted for it: not a
   * replace or version of a listed row (no `replaceOf`, no pin of a row).
   */
  function isCreate(): boolean {
    return !options.replaceOf && replacePin === null
  }

  /**
   * The pin of the file this upload writes, or null for a new file. The ONLY
   * way the encryptor and the resume record get a pin. (The id it belongs to
   * no longer needs a gate here: an answer naming another id aborts in the
   * api.ts primitives, and an upload that moves to its own fresh id
   * (`writeUnderOwnId`) is a create, which never holds a pin.)
   */
  function pinForCurrentFile(): ContentPin | null {
    return replacePin
  }

  // A replace sends the replaced file's OWN name, byte for byte (crypto review
  // of web#170, Minor 2): it is authenticated (read above) and records the pin
  // this content is written with. The server keeps a live row's name on
  // replace (routes/uploads.rs: the UPDATE leaves `name_encrypted` alone), but
  // when the row is gone it INSERTs the body's name, and a freshly sealed
  // `encryptFilename` name records no pin: a v2 file would come back unpinned.
  // A new file seals a name of its own (no pin, core's write rule).
  let nameEncrypted = options.replaceOf
    ? options.replaceOf.nameEncrypted
    : await encryptMetadata(activeFileKey)

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
  // The id this upload writes under: the caller's, or one minted here when a
  // legacy create record restarts (`writeUnderOwnId`). Never an id taken from
  // an answer (L13: the api.ts primitives check every answer against it).
  let serverFileId = fileId
  let skipChunks = new Set<number>()
  let uploadSessionId: string | null = null
  let objectVersionId: string | null = null
  let chunkBytes = fallbackPlan.chunk_size_bytes
  let totalChunks = fallbackChunkCount
  let region: string | null = null
  let country: string | null = null
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
    return await serializeEncryptedBlob(encName.nonce, encName.ciphertext)
  }

  async function startUpload(requestedFileId: string = serverFileId): Promise<void> {
    // `signal` MUST reach the actual `fetch()` call, not just `withNetworkRetry`
    // (task 1571 web PR #106, Codex P1) — otherwise a discard-during-save
    // aborts nothing server-side: `/api/v1/uploads/init` runs to completion
    // and sets `files.is_uploading = TRUE` regardless, and a fire-and-forget
    // `abandonUpload` issued at the moment of abort can land BEFORE that,
    // see `not_uploading` (nothing to abandon yet), and leave the file
    // wedged once init's late response arrives.
    //
    // L13 (contract 2275, SF-0001): initUpload throws ServerChangedItemIdError
    // when the answer names any id but the one proposed here (a create's own
    // minted id, or the listed row's id for a replace/version), before a chunk,
    // a name, a pin or a resume record can be sealed under it. A server
    // dedup/replace-by-name answer is that abort too, never a silent replace.
    let init: Awaited<ReturnType<typeof initUpload>>
    try {
      init = await withNetworkRetry(() => initUpload({
        file_id: requestedFileId,
        name_encrypted: nameEncrypted,
        size_bytes: file.size,
        chunk_count: fallbackChunkCount,
        parent_id: parentId ?? null,
        is_media: isMedia,
        conflict_created: options.conflictCreated ?? false,
      }, signal), signal)
    } catch (err) {
      // The session the init may have opened is abandoned under the id this
      // client REQUESTED, never the echoed one, and only for a create: its id
      // was minted for this upload, so no other upload can hold it. A replace's
      // id is a listed row, where the file-wide abandon could end another
      // device's live upload; that is left to the server's lease sweep.
      if (isServerChangedItemIdError(err) && isCreate()) {
        await abandonUpload(requestedFileId).catch(() => {})
      }
      throw err
    }
    serverFileId = init.file_id
    totalChunks = init.chunk_count
    // Task 2062: both protocols answer with the pool's country at init.
    country = fileStorageCountry(init)
    // A fresh session holds no frames: nothing to resume, nothing recorded yet.
    sessionFormat = undefined
    resumingStoredFrames = false
    if (init.protocol !== 'v2') return

    uploadSessionId = init.upload_session_id
    objectVersionId = init.object_version_id
    chunkBytes = init.chunk_size_bytes
    region = init.region
  }

  // L13 (SF-0001): a stored session is adopted only when THIS client marked
  // its id as its own; `planResume` (upload-resume.ts) is the one rule, shared
  // with the Drive resume banner. A resume writes under the id it resumes, so
  // the caller's key stays the key of the id this upload proposes.
  if (resumeFileId !== undefined && resumeFileId !== fileId) {
    throw new Error('A resumed upload must write under the id it resumes.')
  }

  let fingerprint: string
  if (resumeFileId) {
    // Caller explicitly wants to resume this file ID
    serverFileId = resumeFileId
    fingerprint = await computeFingerprint(file)
    const existing = await findByFingerprint(fingerprint)
    const record = existing?.fileId === resumeFileId ? existing : null
    const plan = record ? await planStoredSession(record) : null
    if (record && plan && plan.kind !== 'resume') {
      await restartStoredSession(record, plan)
      await persistResumeState()
    } else {
      adoptRecordedReplacePin(record, resumeFileId)
      if (record?.upload_session_id) {
        uploadSessionId = record.upload_session_id
        objectVersionId = record.object_version_id ?? null
        chunkBytes = record.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
        totalChunks = record.chunk_count ?? record.totalChunks
        region = record.region ?? null
        country = recordedCountry(record)
        resumingStoredFrames = true
        sessionFormat = record.chunk_format
      } else {
        if (record) {
          chunkBytes = record.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
          totalChunks = record.chunk_count ?? record.totalChunks
          region = record.region ?? null
          country = recordedCountry(record)
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
      const plan = await planStoredSession(existing)
      if (plan.kind !== 'resume') {
        await restartStoredSession(existing, plan)
      } else {
        // Found a prior upload — check server status
        serverFileId = existing.fileId
        chunkBytes = existing.chunk_size_bytes ?? LEGACY_FALLBACK_CHUNK_SIZE_BYTES
        totalChunks = existing.chunk_count ?? existing.totalChunks
        region = existing.region ?? null
        country = recordedCountry(existing)
        adoptRecordedReplacePin(existing, fileId)
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
      }
    } else {
      if (existing && existing.fileId !== fileId) {
        // A stored session for another id is not this upload's: only its local
        // record goes. It is NOT abandoned server-side. The only abandon the
        // server offers is file-wide (`POST /files/{id}/upload/abandon` takes
        // no session id), so it would end whatever upload that row holds NOW,
        // possibly another tab's or device's live one, on nothing more than a
        // content-fingerprint match (same rule as restartInFreshSession,
        // web#170). The server's lease sweep ends the stale session.
        await removeUploadState(existing.fileId)
      }
      // No prior upload — start fresh
      await startUpload()
    }

    // Save state to IndexedDB for future resume
    await persistResumeState()
  }

  /**
   * The plan for a stored session that names this upload's id. A caller that
   * targets that id as a listed row it is replacing already passed the row's
   * own stored name (`replaceOf`, read and pinned above): an unmarked record
   * then restarts as a version of it, with no second lookup. Otherwise the
   * one rule decides (`planResume`), looking the row up when it needs to.
   */
  async function planStoredSession(record: UploadState): Promise<ResumePlan> {
    if (record.selfMinted !== true && options.replaceOf) {
      return { kind: 'restart-version', fileId, resumeFileId: fileId, replaceOf: options.replaceOf }
    }
    return planResume(record, { mintId: () => mintFileId(masterKey), lookupRow: (id) => lookupOwnRow(id, fileKey) })
  }

  /**
   * L13: a stored session this client did not mark as its own (written before
   * the marker existed) is never adopted: no stored frame, chunk status or
   * session of it is reused, and it is not abandoned (see above). The upload
   * starts over in a fresh init, recorded with the marker by the caller.
   *
   * - `restart-version`: a new version of that same row. It sends the row's
   *   OWN stored name, byte for byte, and writes in the format that name's pin
   *   records (SF-0001 round 3): a freshly sealed name carries no pin, and if
   *   the row were gone the server would insert it. Its record is kept until
   *   the fresh init succeeded (the new record then replaces it), so a refused
   *   init (a live lease: 409) leaves it on offer.
   * - `refuse`: the row is gone, trashed or does not authenticate. Nothing is
   *   sent; the record goes (it can never restart) and the error says why.
   * - `restart-new`: a create record's id may be the server's, so it is never
   *   proposed again: the upload moves to a fresh id minted here, with its own
   *   key and name.
   */
  async function restartStoredSession(record: UploadState, plan: ResumePlan): Promise<void> {
    if (plan.kind === 'restart-version') {
      if (!options.replaceOf) {
        replacePin = await readReplacedPin(plan.replaceOf.nameEncrypted)
        nameEncrypted = plan.replaceOf.nameEncrypted
      }
    } else if (plan.kind === 'refuse') {
      await removeUploadState(record.fileId)
      throw new PausedVersionRefusedError(plan.reason)
    } else {
      // F9: a fresh id minted here keeps its tag; core re-checks it before the
      // restarted create seals anything under that id (L13).
      if (plan.kind === 'restart-new' && plan.newItemId) {
        if (plan.newItemId.idText !== plan.fileId) {
          throw new Error('new-item id mismatch: the restarted upload writes an id it did not mint')
        }
        await ownedItem.resume(masterKey, plan.newItemId.idText, plan.newItemId.tag)
        newItemId = plan.newItemId
      }
      await removeUploadState(record.fileId)
      await writeUnderOwnId(plan.fileId)
    }
    await startUpload(serverFileId)
  }

  /** Move this upload to an id minted here: its own key, and its name sealed under it. */
  async function writeUnderOwnId(id: string): Promise<void> {
    const ownKey = await deriveFileKey(masterKey, id)
    ownKeys.push(ownKey)
    serverFileId = id
    activeFileKey = ownKey
    nameEncrypted = await encryptMetadata(activeFileKey)
  }

  async function persistResumeState(): Promise<void> {
    const pin = pinForCurrentFile()
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
      country,
      chunk_format: sessionFormat,
      // Recorded only under the file it belongs to, with that file's id.
      ...(pin !== null ? { replace_pin: pin, replace_pin_file_id: serverFileId } : {}),
      // L13 (SF-0001): after the init echo check, this id is one this client
      // chose — its own minted id, or the listed row's id for a replace.
      selfMinted: true,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    })
  }

  /**
   * A resumed REPLACE writes with the pin it applied before (recorded from the
   * replaced file's authenticated metadata). A caller's fresh `replaceOf` read
   * wins; a record without a pin is a new file, which never pins.
   *
   * The pin is adopted ONLY when the record says it belongs to the very file
   * being resumed (`replace_pin_file_id === record.fileId === resumedId`). A
   * pin recorded for another file, or with no owning id (written before this
   * rule, by unmerged web#170 builds only), is never applied: applied to a
   * remapped new file it would restart a v1 session and write v2 content
   * under an unpinned name.
   */
  function adoptRecordedReplacePin(
    record: Pick<UploadState, 'fileId' | 'replace_pin' | 'replace_pin_file_id'> | null | undefined,
    resumedId: string,
  ): void {
    if (pinForCurrentFile() !== null || !record || record.replace_pin === undefined) return
    if (record.fileId !== resumedId || record.replace_pin_file_id !== resumedId) return
    replacePin = toContentPin(record.replace_pin)
  }

  /**
   * Core said restart: never PUT into the old session again. Init a fresh
   * session for the same file id and record it, then upload from chunk 0.
   *
   * The old session is NOT abandoned from here. The only abandon the server
   * offers is file-wide (`POST /files/{id}/upload/abandon` takes no session
   * id): it reverts or deletes whatever upload the file holds NOW, which may
   * be another tab's or device's live upload rather than the session this
   * stale record names (Codex P1, web#170). The init decides instead: a
   * session whose lease expired is taken over inside the init (the server's
   * own abandon core), and a live one answers 409, so the upload fails here
   * with nothing touched.
   *
   * The old resume record is kept until the fresh init has succeeded and its
   * own record is written (same file id: the write replaces it). If the init
   * fails (offline, a timeout, the 409 above) the paused upload stays on
   * offer and can be retried (Codex P2, web#170).
   */
  async function restartInFreshSession(): Promise<void> {
    const id = serverFileId
    skipChunks = new Set()
    uploadSessionId = null
    objectVersionId = null
    chunkBytes = fallbackPlan.chunk_size_bytes
    totalChunks = fallbackChunkCount
    region = null
    await startUpload(id)
    // Same id (the init answer is checked against it): this write replaces
    // the old record.
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
      country,
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
        country,
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
        country,
      })
    }

    // ── Streaming encryption via the shared core ChunkEncryptor ───────────────
    // Create the worker-owned encryptor now that the init has fixed the chunk
    // plan. The per-file key is derived ONCE inside core from masterKey +
    // serverFileId (the id this client proposed; L13 checks every answer
    // against it) — the SAME derivation that produced `activeFileKey` — so we
    // pass masterKey here and keep `activeFileKey` only for the metadata,
    // thumbnail, and folder-share paths below.
    //
    // If the v2 server overrode the chunk size, pin the encryptor to that exact
    // size so its internal plan can't diverge from the slices we PUT. Otherwise
    // use the web ladder, which is identical to the `planChunks()` proposal above
    // (both call core's `plan_chunks`), so chunk_count stays consistent with init.
    const serverOverrodeChunkSize = chunkBytes !== fallbackPlan.chunk_size_bytes
    // L13: a create seals through core's `forNewItem` under the id it minted
    // (same content key derivation; the tag is re-checked there). A replace or
    // version writes under the listed row's own id, as before. An explicit
    // server chunk size has no forNewItem variant, so that rare path keeps the
    // id-bound derive (the tag was already checked above).
    const enc = newItemId && isCreate() && !serverOverrodeChunkSize
      ? await startEncryptedStreamForNewItem(masterKey, newItemId, file.size, 'web')
      : serverOverrodeChunkSize
        ? await startEncryptedStreamWithChunkSize(masterKey, serverFileId, file.size, chunkBytes)
        : await startEncryptedStream(masterKey, serverFileId, file.size, 'web')

    try {
      // Replace of an existing file (or a version of it): write in the format
      // its recorded pin requires, before the first chunk. A new file has no
      // pin and writes core's write format.
      const pin = pinForCurrentFile()
      if (pin !== null) {
        await enc.applyRecordedPin(pin)
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

    // L13: completeUpload throws ServerChangedItemIdError (stage `complete`)
    // when the answer names any id but this upload's. That happens before the
    // resume record is dropped or any key is published. The record is KEPT
    // (the bytes went up under this upload's own id, and the file may exist):
    // what that does is that the Drive resume banner offers this file again,
    // under that same id. Nothing else uses it: a Retry of the card or a new
    // upload of the same file starts under a fresh id (and drops the record as
    // another id's). Nothing is abandoned (the upload may have committed).
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
    const { sealFolderChild, folderKeyId, wireWrapFormat } = await import('./folder-share-crypto')
    const { addFolderKeys } = await import('./api')
    // Bound to (shared root, this file, file) for a custody folder (L7); the
    // legacy invite format only for a flag-off invite-only folder (L7b).
    const encryptedKey = await sealFolderChild(
      sharedFolderContext.format,
      sharedFolderContext.folderKey,
      { rootId: sharedFolderContext.sharedFolderId, itemId: serverFileId, isFolder: false },
      activeFileKey,
    )
    await addFolderKeys(sharedFolderContext.inviteId, [{
      file_id: serverFileId,
      encrypted_file_key: encryptedKey,
    }], await folderKeyId(sharedFolderContext.folderKey), wireWrapFormat(sharedFolderContext.format))
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
