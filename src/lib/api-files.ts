// File and folder listing plus upload-init API calls, including the hard pagination cap.
import { collectPaged } from './paginate'
import { buildUploadInitV2Body, type UploadInitMetadata } from './upload-init-body'
import { assertEchoedItemId } from './item-id-echo'
import { ApiError, getToken, provenanceHeaders, expectedUserHeaders, readErrorResponse, request } from '@beebeeb/shared'
import type { DriveFile, StreamTokenResponse, SubmittedSyncOp, SyncOp, SyncOpsResult, SyncSnapshot, UploadAbandonResponse, UploadStatusResponse } from '@beebeeb/shared'
import { assertOwnerRepairWritable } from './owner-repair'
import { API_URL } from './api-session'

/** Hard outer bound on a single `listAllFiles` enumeration — a safety valve so a
 *  pathological or hostile listing can't loop unbounded or OOM the tab (0709/0739). */
export const FILE_LIST_HARD_CAP = 50_000

/**
 * One page of `GET /api/v1/files`. `cursor` is an OPAQUE server token (task 0739
 * keyset pagination) — pass back exactly what the previous page returned, never
 * parse it. `next_cursor` is non-null only when a full page was served;
 * null/absent ⇒ last page.
 */
export async function listFilesPage(
  opts: {
    parentId?: string
    trashed?: boolean
    starred?: boolean
    recent?: boolean
    limit?: number
    cursor?: string
  } = {},
): Promise<{ files: DriveFile[]; next_cursor: string | null }> {
  const params = new URLSearchParams()
  if (opts.parentId) params.set('parent_id', opts.parentId)
  if (opts.trashed !== undefined) params.set('trashed', String(opts.trashed))
  if (opts.starred) params.set('starred', 'true')
  if (opts.recent) params.set('recent', 'true')
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)
  const qs = params.toString()
  const data = await request<{ files: DriveFile[]; next_cursor?: string | null }>(
    `/api/v1/files${qs ? `?${qs}` : ''}`,
  )
  return { files: data.files, next_cursor: data.next_cursor ?? null }
}

/** A SINGLE page of the listing (server default page size). For callers that only
 *  need the first page; use `listAllFiles` when you need EVERY row of a folder. */
export async function listFiles(
  parentId?: string,
  trashed?: boolean,
  options?: { starred?: boolean; recent?: boolean; limit?: number },
): Promise<DriveFile[]> {
  const { files } = await listFilesPage({ parentId, trashed, ...options })
  return files
}

/**
 * Enumerate EVERY row of a listing by following `next_cursor` until the server
 * reports the last page — the proper fix for the old silent 200/500-item cap
 * (task 0739). Bounded by `maxTotal` (default `FILE_LIST_HARD_CAP`).
 */
export async function listAllFiles(
  parentId?: string,
  options?: { trashed?: boolean; starred?: boolean; recent?: boolean; maxTotal?: number },
): Promise<DriveFile[]> {
  return collectPaged<DriveFile>(
    async (cursor) => {
      const page = await listFilesPage({
        parentId,
        trashed: options?.trashed,
        starred: options?.starred,
        recent: options?.recent,
        cursor,
      })
      return { items: page.files, nextCursor: page.next_cursor }
    },
    options?.maxTotal ?? FILE_LIST_HARD_CAP,
    'listAllFiles',
  )
}

/**
 * Create a folder under the id THIS client minted (`folderId`; its name is
 * sealed under the key derived from it). L13 (SF-0001): an answer naming any
 * other item throws `ServerChangedItemIdError` before a caller can publish a
 * wrap for it, move items into it, or navigate to it.
 */
export async function createFolder(
  nameEncrypted: string,
  parentId: string | undefined,
  folderId: string,
): Promise<DriveFile> {
  const created = await request<DriveFile>('/api/v1/files/folder', {
    method: 'POST',
    body: JSON.stringify({ name_encrypted: nameEncrypted, parent_id: parentId, folder_id: folderId }),
  })
  assertEchoedItemId(folderId, created.id)
  return created
}

// ─── Chunked upload endpoints ────────────────────
// (The legacy single-shot `uploadFile` was removed in task 0027. It sent the
// metadata field as `size` while the server expected `size_bytes`, so it
// would have 400'd if anyone called it — but nothing did. The chunked
// init+chunks+complete flow below is the one wired into encrypted-upload.ts.)

interface UploadInitV1Response {
  file_id: string
  chunk_count: number
  /** Task 2062 — the pool chosen at init. */
  storage_location?: { country?: string | null } | null
}

interface UploadInitV2Response {
  file_id: string
  tenant_id: string
  object_version_id: string
  upload_session_id: string
  chunk_size_bytes: number
  chunk_count: number
  storage_format_version: number
  storage_pool_id: string
  region: string
  /** Task 2062 — `{ region, country, country_code }` for the pool chosen at init; no city. */
  storage_location?: { country?: string | null } | null
}

export type UploadInitResponse =
  | (UploadInitV1Response & { protocol: 'v1' })
  | (UploadInitV2Response & { protocol: 'v2' })

/**
 * Open an upload for the item this client names (`metadata.file_id`: its own
 * minted id for a create, the listed row's id for a replace or version).
 * L13 (SF-0001): on either protocol, an answer naming any other item throws
 * `ServerChangedItemIdError` before a chunk, a name, a pin or a resume record
 * can be sealed under it. (What to clean up after that is the caller's call:
 * only it knows whether the requested id is one no other upload can hold.)
 */
export async function initUpload(
  metadata: UploadInitMetadata & { file_id: string },
  signal?: AbortSignal,
): Promise<UploadInitResponse> {
  try {
    const v2 = await request<UploadInitV2Response>('/api/v1/uploads/init', {
      method: 'POST',
      body: JSON.stringify(buildUploadInitV2Body(metadata)),
      signal,
    })
    assertEchoedItemId(metadata.file_id, v2.file_id)
    return { ...v2, protocol: 'v2' }
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      throw err
    }
  }

  const v1 = await request<UploadInitV1Response>('/api/v1/files/upload/init', {
    method: 'POST',
    body: JSON.stringify(metadata),
    signal,
  })
  assertEchoedItemId(metadata.file_id, v1.file_id)
  return { ...v1, protocol: 'v1' }
}

export async function uploadChunk(
  fileId: string,
  index: number,
  data: Uint8Array,
  uploadSessionId?: string | null,
  signal?: AbortSignal,
): Promise<{ index: number; size: number; skipped?: boolean }> {
  // A v2 session's chunks go to the session route ONLY. There is deliberately
  // no fallback to the legacy `/files/{id}/chunks` route on a v2 404 (task
  // 1589): a 404 there means the server swept the session (its lease
  // expired), and the legacy route would write against whatever upload state
  // the file has NOW — possibly another device's upload after a takeover.
  // The caller (encryptedUpload → runWithSessionReinit) re-inits instead.
  if (uploadSessionId) {
    return uploadChunkRequest(`/api/v1/uploads/${uploadSessionId}/chunks/${index}`, data, signal)
  }

  // v1 protocol (the init itself answered from the legacy route).
  return uploadChunkRequest(`/api/v1/files/${fileId}/chunks/${index}`, data, signal)
}

async function uploadChunkRequest(
  path: string,
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<{ index: number; size: number; skipped?: boolean }> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    // Chunk uploads stream binary via raw fetch() (task 0447), bypassing the
    // shared request() client — so the writer-provenance headers (task 1436)
    // and the expected-user defence header (task 1531, web #85 round 2)
    // have to be added by hand here too. A chunk PUT is unambiguously a
    // mutating request.
    ...provenanceHeaders(),
    ...expectedUserHeaders(),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'PUT',
      headers,
      body: new Uint8Array(data) as BodyInit,
      // task 0447 — chunk uploads are authenticated; ship the cookie.
      credentials: 'include',
      signal,
    })
  } catch (err) {
    // A caller-provided AbortSignal firing mid-PUT is a deliberate cancel
    // (task 1571 web PR #106) — let the real AbortError propagate as-is so
    // callers' `err.name === 'AbortError'` checks still work, instead of
    // masking it as a generic network failure below.
    if (signal?.aborted) throw err
    // The error notifier now lives in @beebeeb/shared and is fired by the
    // shared `request()` helper for normal endpoints. Chunk uploads use raw
    // `fetch()` because they stream binary, so just throw — the caller
    // (encryptedUpload) already surfaces upload failures via toast.
    const message = 'Could not reach the server. Check your connection and try again.'
    throw new ApiError(message, 0)
  }

  if (!res.ok) {
    const { body, fallbackMessage } = await readErrorResponse(res)
    // Carry the machine-readable `error` code (e.g. `object_budget_exceeded`,
    // `quota_exceeded`) through as ApiError.code so the upload error boundary
    // can branch on it. Chunk uploads use raw fetch(), so unlike the shared
    // request() helper this had previously dropped the code.
    const code = typeof body.error === 'string' ? body.error : undefined
    // Task 1605: also thread the raw body through as `.details` (mirrors the
    // shared request() helper) so a 413 `quota_exceeded` chunk-PUT failure
    // carries `is_trial_cap`/`limit_bytes`/`used_bytes` the same way a
    // request()-routed one does.
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
      code,
      body,
    )
  }

  return res.json() as Promise<{ index: number; size: number; skipped?: boolean }>
}

/**
 * Finish the upload of `fileId`. L13 (SF-0001): an answer naming any other
 * item throws `ServerChangedItemIdError` (stage `complete`, whose sentence
 * says the file may already be on the server) before the caller drops the
 * resume record or publishes a key for the answer.
 */
export async function completeUpload(
  fileId: string,
  uploadSessionId?: string | null,
): Promise<DriveFile> {
  // No legacy fallback on a v2 404 (task 1589) — see uploadChunk() above.
  const completed = uploadSessionId
    ? await request<DriveFile>(`/api/v1/uploads/${uploadSessionId}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    : await request<DriveFile>(`/api/v1/files/${fileId}/upload/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
  assertEchoedItemId(fileId, completed.id, 'complete')
  return completed
}

export async function getUploadStatus(
  fileId: string,
): Promise<UploadStatusResponse> {
  return request<UploadStatusResponse>(
    `/api/v1/files/${fileId}/upload/status`,
  )
}

/**
 * Abandon an in-flight version upload for `fileId` (task 1571) — the
 * server-side counterpart to a client-aborted save. Restores the file's
 * previous, already-completed version as current (untouched); if the file
 * had no previous version (its first-ever, still-incomplete upload), the
 * row is removed instead. A no-op (never an error) when the file isn't
 * currently mid-upload, so callers can fire this unconditionally after
 * aborting a save without first checking server state.
 */
export async function abandonUpload(fileId: string): Promise<UploadAbandonResponse> {
  return request<UploadAbandonResponse>(`/api/v1/files/${fileId}/upload/abandon`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function getFile(id: string): Promise<DriveFile> {
  return request<DriveFile>(`/api/v1/files/${id}`)
}

export async function downloadFile(id: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  // task 0447 — authenticated download; ship the cookie if present.
  const res = await fetch(`${API_URL}/api/v1/files/${id}/download`, { headers, credentials: 'include' })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

export async function updateFile(
  fileId: string,
  updates: { parent_id?: string | null; name_encrypted?: string; note_encrypted?: string | null },
  signal?: AbortSignal,
): Promise<DriveFile> {
  // SF-0002: a row recovered under the uppercase repair convention is
  // read-only. Its NAME and NOTE are content of that row — a move (parent_id
  // only) stays allowed. A repair that resolved on the CONTENT side marks the
  // id too, so a note write is refused as well.
  if (updates.name_encrypted !== undefined || updates.note_encrypted !== undefined) {
    assertOwnerRepairWritable(fileId)
  }
  return request<DriveFile>(`/api/v1/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
    signal,
  })
}

export async function deleteFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}`, { method: 'DELETE' })
}

/**
 * Move many files/folders to Trash in ONE request (server cascades folders).
 * Replaces the old per-file `Promise.all(ids.map(deleteFile))` fan-out.
 * `POST /api/v1/files/trash` — owned, non-trashed ids are trashed; the response
 * reports which were `trashed` / `already_trashed` / `missing`.
 */
export async function bulkTrashFiles(
  ids: string[],
): Promise<{ trashed: string[]; already_trashed: string[]; missing: string[] }> {
  return request<{ trashed: string[]; already_trashed: string[]; missing: string[] }>(
    '/api/v1/files/trash',
    { method: 'POST', body: JSON.stringify({ ids }) },
  )
}

/** What a restore did. `complete: false` (202, task 1918 round 4): the folder's trash group is
 *  larger than one request may touch; the server restores the rest in the background. */
export interface RestoreFileResult {
  complete: boolean
  remaining: number | null
}

export async function restoreFile(id: string): Promise<RestoreFileResult> {
  const body = await request<unknown>(`/api/v1/files/${id}/restore`, { method: 'POST' })
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  return {
    complete: b.complete !== false,
    remaining: typeof b.remaining === 'number' ? b.remaining : null,
  }
}

export async function permanentDeleteFile(
  id: string,
  confirmToken?: string,
): Promise<void> {
  await request<void>(`/api/v1/files/${id}/permanent`, {
    method: 'DELETE',
    headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
  })
}

/**
 * Permanently erase many already-trashed files/folders in ONE request, gated by
 * a SINGLE step-up confirmation token (`POST /api/v1/files/permanent`). The
 * server reclaims every S3 blob (V1 + V2, incl. folder descendants), decrements
 * pool byte/object counts, deletes the rows, and emits per-row delete ops — so
 * "empty trash" / "delete selected" is one round-trip, not N. Only owned + trashed
 * ids are erased; live ids are skipped server-side, unknown ids reported missing.
 */
export async function bulkPermanentDelete(
  ids: string[],
  confirmToken: string,
): Promise<void> {
  await request<void>('/api/v1/files/permanent', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
    body: JSON.stringify({ ids }),
  })
}

export async function toggleStar(
  id: string,
): Promise<{ id: string; is_starred: boolean }> {
  return request<{ id: string; is_starred: boolean }>(
    `/api/v1/files/${id}/star`,
    { method: 'PATCH' },
  )
}

/**
 * Upload a thumbnail blob for a file. Server caps payloads at 512KB.
 * Callers in the encrypted upload path encrypt the blob with the file
 * key before calling this — the server never sees thumbnail plaintext.
 */
export async function uploadThumbnail(fileId: string, blob: Blob): Promise<void> {
  // SF-0002: no thumbnail write on a repaired read-only row (reads stay fine).
  assertOwnerRepairWritable(fileId)
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/files/${fileId}/thumbnail`, {
    method: 'PUT',
    headers,
    body: blob,
    // task 0447 — authenticated thumbnail upload; ship the cookie.
    credentials: 'include',
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
}

export async function uploadThumbnailLarge(fileId: string, blob: Blob): Promise<void> {
  // SF-0002: no thumbnail write on a repaired read-only row (reads stay fine).
  assertOwnerRepairWritable(fileId)
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/files/${fileId}/thumbnail/large`, {
    method: 'PUT',
    headers,
    body: blob,
    credentials: 'include',
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
}

export async function getSnapshot(): Promise<SyncSnapshot> {
  return request<SyncSnapshot>('/api/v1/sync/snapshot')
}

export async function getSyncOps(since: number): Promise<SyncOp[]> {
  const data = await request<{ ops: SyncOp[] }>(
    `/api/v1/sync/ops?since=${encodeURIComponent(String(since))}`,
  )
  return data.ops ?? []
}

/**
 * Task 1973 (server#233): a sync op as a server that numbers each user's ops
 * sends it. `user_seq` is the op's place in its user's own gap-free sequence;
 * `null` for an op recorded before that deploy, absent on an older server.
 */
export type UserSeqSyncOp = SyncOp & { user_seq?: number | null }

/** Task 1973: a snapshot from a server that numbers ops carries a numeric `user_seq`. */
export type UserSeqSyncSnapshot = SyncSnapshot & { user_seq?: number | null }

/** Task 1973: one `GET /sync/ops?since_user_seq=` page plus the server's heads. */
export interface UserSeqSyncOpsPage {
  ops: UserSeqSyncOp[]
  head_seq?: number
  /** The user's newest `user_seq`, read in the same statement as the page. */
  head_user_seq?: number
}

/**
 * Task 1973: this user's ops with `user_seq > sinceUserSeq`, ascending by
 * `user_seq`. An older server ignores the parameter (and has no
 * `head_user_seq`); the caller treats that as a failed catch-up.
 */
export async function getSyncOpsSinceUserSeq(sinceUserSeq: number): Promise<UserSeqSyncOpsPage> {
  const data = await request<UserSeqSyncOpsPage>(
    `/api/v1/sync/ops?since_user_seq=${encodeURIComponent(String(sinceUserSeq))}`,
  )
  return { ops: data.ops ?? [], head_seq: data.head_seq, head_user_seq: data.head_user_seq }
}

export async function submitSyncOps(ops: SubmittedSyncOp[]): Promise<SyncOpsResult> {
  return request<SyncOpsResult>('/api/v1/sync/ops', {
    method: 'POST',
    body: JSON.stringify({ ops }),
  })
}

export async function getStreamToken(): Promise<StreamTokenResponse> {
  return request<StreamTokenResponse>('/api/v1/sync/stream-token', {
    method: 'POST',
  })
}
