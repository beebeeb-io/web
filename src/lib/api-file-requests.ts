// ─── API: E2EE file requests ───
// SECTION_MARKER_END
import { withServerBusyRetry } from './server-busy-retry'
import { request, ApiError, getApiUrl } from '@beebeeb/shared'

// ─── E2EE File Requests ──────────────────────────────────────────────────────

// Per-request sealed-keypair model (spec 2026-05-29-file-requests-design).
// R_pub rides in the link fragment and is NEVER sent to the server; the server
// stores only the wrapped private key (opaque). See `src/lib/file-request-crypto.ts`.

/** One of the owner's file requests, as returned by GET /api/v1/file-requests. */
export interface FileRequest {
  id: string
  title: string
  description: string | null
  token: string | null
  /** R_priv wrapped under the owner's master key (base64, opaque). Used to
   *  rebuild R_pub for the "copy link" action. */
  wrapped_private_key: string | null
  wrap_nonce: string | null
  target_folder_id: string | null
  max_files: number
  max_total_bytes: number | null
  files_received: number
  total_bytes_received: number
  expires_at: string | null
  closed: boolean
  closed_at: string | null
  created_at: string
  /** `APP_URL/r/<token>` — the client appends `#<R_pub>` to share. */
  request_url: string | null
}

/** Result of POST /api/v1/file-requests (subset — the client already holds R_pub). */
export interface CreateFileRequestResult {
  id: string
  token: string
  title: string
  description: string | null
  target_folder_id: string | null
  max_files: number
  max_total_bytes: number | null
  files_received: number
  total_bytes_received: number
  expires_at: string | null
  closed: boolean
  created_at: string
  request_url: string
}

/** Public info shown on the uploader page (GET /api/v1/r/:token). No pubkey, no identity. */
export interface FileRequestPublic {
  title: string
  description: string | null
  max_files: number
  files_received: number
  max_total_bytes: number | null
  total_bytes_received: number
  expires_at: string | null
}

export interface CreateFileRequestParams {
  title: string
  description?: string
  target_folder_id?: string
  max_files?: number
  /** Per-request byte cap. Omit for unlimited (within the owner's quota). */
  max_total_bytes?: number
  /** Seconds from now until this request expires. Omit for no expiry. */
  expires_in_secs?: number
  /** R_priv wrapped under the master key (base64). Server stores it opaque. */
  wrapped_private_key: string
  /** AES-GCM nonce used for the wrap (base64). */
  wrap_nonce: string
}

/**
 * POST /api/v1/file-requests — create a new file request (auth required).
 * The caller generates the keypair and wraps R_priv before calling this.
 */
export async function createFileRequest(params: CreateFileRequestParams): Promise<CreateFileRequestResult> {
  return request<CreateFileRequestResult>('/api/v1/file-requests', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/**
 * GET /api/v1/file-requests — list the current user's file requests (auth required).
 */
export async function listFileRequests(): Promise<{ file_requests: FileRequest[] }> {
  return request<{ file_requests: FileRequest[] }>('/api/v1/file-requests')
}

/**
 * POST /api/v1/file-requests/:id/close — stop accepting uploads (idempotent).
 * Received files are untouched and stay decryptable.
 */
export async function closeFileRequest(id: string): Promise<{ id: string; closed: boolean; closed_at: string | null }> {
  return request(`/api/v1/file-requests/${encodeURIComponent(id)}/close`, { method: 'POST' })
}

/**
 * GET /api/v1/r/:token — public info for the upload page (no auth).
 */
export async function getFileRequestPublic(token: string): Promise<FileRequestPublic> {
  const res = await fetch(`${getApiUrl()}/api/v1/r/${encodeURIComponent(token)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Not found' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<FileRequestPublic>
}

/**
 * POST /api/v1/r/:token/upload — upload an already-encrypted, sealed file (no auth).
 *
 * The FormData must contain:
 *   - `metadata`: JSON string { name_encrypted, size_bytes, sender_ephemeral_pubkey, wrapped_key }
 *   - `chunk_0`, `chunk_1`, … : binary blobs (nonce ‖ ciphertext) of the encrypted chunks
 */
export async function uploadToFileRequest(
  token: string,
  formData: FormData,
): Promise<{ file_id: string; files_received: number; total_bytes_received: number; message: string }> {
  // Task 1870: a `429 server_busy` is retried after Retry-After; the per-link
  // `upload_rate_limited` 429 is not (see server-busy-retry.ts). The FormData
  // is a reusable body, so the same instance is re-sent.
  const res = await withServerBusyRetry(() =>
    fetch(`${getApiUrl()}/api/v1/r/${encodeURIComponent(token)}/upload`, {
      method: 'POST',
      body: formData,
    }),
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Upload failed' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<{ file_id: string; files_received: number; total_bytes_received: number; message: string }>
}
