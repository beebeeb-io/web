/**
 * Request body for the v2 upload init (`POST /api/v1/uploads/init`).
 *
 * Extracted from `initUpload()` in `api.ts` so the exact wire body is unit-
 * testable without importing `api.ts` (several suites `mock.module` that file
 * process-wide — see test/helpers/upload-share-mocks.ts).
 */
export interface UploadInitMetadata {
  file_id?: string
  name_encrypted: string
  size_bytes: number
  chunk_count: number
  parent_id?: string | null
  /** True when the file is an image or video. Set by the client at upload time
   *  because MIME types are encrypted — the server cannot infer media type. */
  is_media?: boolean
  /** True when this upload is the Keep Both result of a same-name conflict. */
  conflict_created?: boolean
}

export function buildUploadInitV2Body(metadata: UploadInitMetadata): Record<string, unknown> {
  return {
    // The id of the file this upload targets. For a same-name re-upload
    // (auto-version) or the conflict dialog's "Replace", it is the EXISTING
    // file's id — the server (InitUploadV2Request.file_id) then writes a new
    // object version of that file and applies the quota replace-credit. For a
    // fresh upload it is the client-generated UUID the file key was derived
    // from; the server inserts the row under it. Undefined is dropped by
    // JSON.stringify, leaving the server to issue an id (encryptedUpload's
    // re-derive fallback handles that case).
    file_id: metadata.file_id,
    file_name: metadata.name_encrypted,
    file_size_bytes: metadata.size_bytes,
    parent_id: metadata.parent_id,
    profile: 'web',
    is_media: metadata.is_media ?? false,
    conflict_created: metadata.conflict_created ?? false,
  }
}
