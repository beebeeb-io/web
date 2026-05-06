const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export function getApiUrl(): string {
  return API_URL
}

const TOKEN_KEY = 'bb_session'

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// ─── Global error hooks ─────────────────────────────
// Registered at app startup by ToastProvider / AuthProvider.

type ErrorNotifier = (message: string) => void
type SessionExpiredHandler = () => void
type ConnectionStatusHandler = (status: 'ok' | 'flaky') => void

let notifyError: ErrorNotifier | null = null
let onSessionExpired: SessionExpiredHandler | null = null
let onConnectionStatus: ConnectionStatusHandler | null = null

/** Register a callback to show a toast when the API is unreachable. */
export function registerErrorNotifier(fn: ErrorNotifier): void {
  notifyError = fn
}

/** Register a callback to handle 401 (token expired) globally. */
export function registerSessionExpiredHandler(fn: SessionExpiredHandler): void {
  onSessionExpired = fn
}

/**
 * Register a callback for connection-quality changes. Fires `flaky` after
 * CONNECTION_FAILURE_THRESHOLD consecutive network failures while the browser
 * still reports itself online, and `ok` after the next successful request.
 */
export function registerConnectionStatusHandler(fn: ConnectionStatusHandler): void {
  onConnectionStatus = fn
}

const CONNECTION_FAILURE_THRESHOLD = 2
const RETRY_DELAY_MS = 800

let consecutiveFailures = 0
let lastReported: 'ok' | 'flaky' = 'ok'

function reportConnection(status: 'ok' | 'flaky'): void {
  if (status === lastReported) return
  lastReported = status
  onConnectionStatus?.(status)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // One retry on network failure with a short delay. Anything beyond that and
  // we surface the error so the caller can decide. We don't retry HTTP error
  // responses — those are deterministic, not transient.
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch (_first) {
    await delay(RETRY_DELAY_MS)
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers })
    } catch (_second) {
      consecutiveFailures += 1
      if (consecutiveFailures >= CONNECTION_FAILURE_THRESHOLD) {
        reportConnection('flaky')
      }
      const message = 'Could not reach the server. Check your connection and try again.'
      notifyError?.(message)
      throw new ApiError(message, 0)
    }
  }

  // Got a response — connection is fine even if the response is an error.
  consecutiveFailures = 0
  reportConnection('ok')

  if (res.status === 401) {
    // Only treat 401 as "session expired" when this request was authenticated
    // (had a stored token). For unauthenticated requests — e.g. wrong-password
    // login attempts — fall through to the body-surfacing branch below so the
    // user sees the actual server error message instead of misleading copy
    // suggesting their session timed out. See task 0010.
    if (token) {
      clearToken()
      onSessionExpired?.()
      throw new ApiError('Session expired', 401)
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<T>
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Thrown by confirmAction when the server rejects the password during step-up
 * re-auth. Distinct from ApiError(401) because a wrong password during step-up
 * must NOT clear the user's session — they're still logged in, they just
 * mistyped. Callers (ConfirmPasswordModal) catch this to show an inline error
 * instead of bouncing the user to /login.
 */
export class IncorrectPasswordError extends Error {
  constructor(message = 'Incorrect password.') {
    super(message)
    this.name = 'IncorrectPasswordError'
  }
}

// ─── Auth endpoints ──────────────────────────────

interface AuthSessionResponse {
  user_id: string
  session_token: string
  salt: string
}

export interface AuthUser {
  user_id: string
  email: string
  email_verified: boolean
  created_at: string
  frozen_at?: string | null
  totp_enabled?: boolean
  two_factor_enabled?: boolean
  twoFactorEnabled?: boolean
}

export interface SignupResult {
  session_token: string
  salt: string
  user_id: string
}

/** Login may return a full session OR a 2FA challenge. */
export interface LoginResult {
  requires_2fa?: boolean
  partial_token?: string
  user_id?: string
  session_token?: string
  salt?: string
}

export async function signup(
  email: string,
  password: string,
): Promise<SignupResult> {
  const data = await request<AuthSessionResponse>('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.session_token)
  return data
}

// ─── OPAQUE auth endpoints ─────────────────────────

export async function opaqueRegisterStart(
  email: string,
  clientMessage: string,
  /** Cloudflare Turnstile token — omitted when not available (dev mode / fail-open). */
  cfTurnstileResponse?: string | null,
): Promise<{ server_message: string }> {
  const body: Record<string, unknown> = { email, client_message: clientMessage }
  if (cfTurnstileResponse) body.cf_turnstile_response = cfTurnstileResponse
  return request('/api/v1/opaque/register-start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function opaqueRegisterFinish(
  email: string,
  clientMessage: string,
  x25519PublicKey?: string,
  recoveryCheck?: string,
  referralSource?: string,
  referralSharerId?: string,
  referralCode?: string,
): Promise<{ user_id: string; session_token: string }> {
  const data = await request<{ user_id: string; session_token: string }>('/api/v1/opaque/register-finish', {
    method: 'POST',
    body: JSON.stringify({
      email,
      client_message: clientMessage,
      x25519_public_key: x25519PublicKey,
      recovery_check: recoveryCheck,
      ...(referralSource && { referral_source: referralSource }),
      ...(referralSharerId && { referral_sharer_id: referralSharerId }),
      ...(referralCode && { referral_code: referralCode }),
    }),
  })
  setToken(data.session_token)
  return data
}

export async function opaqueLoginStart(
  email: string,
  clientMessage: string,
): Promise<{ server_message: string; server_state: string }> {
  return request('/api/v1/opaque/login-start', {
    method: 'POST',
    body: JSON.stringify({ email, client_message: clientMessage }),
  })
}

export async function opaqueLoginFinish(
  email: string,
  clientMessage: string,
  serverState: string,
): Promise<{ user_id: string; session_token: string }> {
  const data = await request<{ user_id: string; session_token: string }>('/api/v1/opaque/login-finish', {
    method: 'POST',
    body: JSON.stringify({ email, client_message: clientMessage, server_state: serverState }),
  })
  setToken(data.session_token)
  return data
}

// ─── OPAQUE migration for existing (legacy) accounts ─────────────────────
// These endpoints require a valid Bearer session and allow a user who is
// currently authenticated via legacy Argon2id to silently enroll in OPAQUE.
// Called fire-and-forget after a successful legacy login; failure is safe to
// ignore — the account stays on legacy until the next successful migration.

/**
 * POST /api/v1/opaque/register-start-existing
 *
 * Initiates OPAQUE registration for a session that was authenticated via the
 * legacy password path. The caller must already have a valid Bearer token.
 * Returns the server-side OPAQUE message needed to complete registration.
 */
export async function opaqueRegisterStartExisting(
  clientMessage: string,
): Promise<{ server_message: string }> {
  return request('/api/v1/opaque/register-start-existing', {
    method: 'POST',
    body: JSON.stringify({ client_message: clientMessage }),
  })
}

/**
 * POST /api/v1/opaque/register-finish-existing
 *
 * Completes OPAQUE enrollment for an existing session. Persists the OPAQUE
 * password file alongside the recovery_check and x25519 public key so the
 * account can use OPAQUE on next login.
 */
export async function opaqueRegisterFinishExisting(
  clientMessage: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<{ migrated: true }> {
  return request('/api/v1/opaque/register-finish-existing', {
    method: 'POST',
    body: JSON.stringify({
      client_message: clientMessage,
      recovery_check: recoveryCheck,
      x25519_public_key: x25519PublicKey,
    }),
  })
}

// ─── Recovery-phrase auth endpoints (server task 0034) ────────────────────
// These endpoints don't exist yet. Returns null on 404 so the UI can show a
// "service unavailable" message rather than crashing.

/**
 * POST /api/v1/auth/recover-with-phrase-start
 *
 * Client sends: email + recovery_check (HMAC-SHA256 of master_key over
 * "beebeeb-recovery-check", base64-encoded). Server verifies the check
 * matches the stored value, then initiates an OPAQUE re-registration and
 * returns a short-lived recovery_token plus the OPAQUE server message for
 * the client to complete registration.
 */
export async function recoverWithPhraseStart(
  email: string,
  recoveryCheck: string,
): Promise<{ recovery_token: string } | null> {
  try {
    return await request<{ recovery_token: string }>(
      '/api/v1/auth/recover-with-phrase-start',
      { method: 'POST', body: JSON.stringify({ email, recovery_check: recoveryCheck }) },
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function recoverOpaqueRegister(
  recoveryToken: string,
  clientMessage: string,
): Promise<{ server_message: string }> {
  return request<{ server_message: string }>(
    '/api/v1/auth/recover-opaque-register',
    {
      method: 'POST',
      body: JSON.stringify({ recovery_token: recoveryToken, client_message: clientMessage }),
    },
  )
}

/**
 * POST /api/v1/auth/recover-with-phrase-finalize
 *
 * Client sends the OPAQUE upload message (output of opaqueRegistrationFinish)
 * plus the recovery_token obtained from the start endpoint. Server finalises
 * the OPAQUE password file update and returns a fresh session token.
 */
export async function recoverWithPhraseFinalize(
  recoveryToken: string,
  opaqueRegistration: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<{ session_token: string; user_id: string }> {
  const data = await request<{ session_token: string; user_id: string }>(
    '/api/v1/auth/recover-with-phrase-finalize',
    {
      method: 'POST',
      body: JSON.stringify({
        recovery_token: recoveryToken,
        opaque_registration: opaqueRegistration,
        recovery_check: recoveryCheck,
        x25519_public_key: x25519PublicKey,
      }),
    },
  )
  setToken(data.session_token)
  return data
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!data.requires_2fa && data.session_token) {
    setToken(data.session_token)
  }
  return data
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/v1/auth/logout', { method: 'POST' })
  } finally {
    clearToken()
  }
}

// ─── Step-up re-auth ────────────────────────────────

/**
 * Exchange the user's password for a short-lived confirmation token.
 * Pass that token via the X-Confirm-Token header on destructive endpoints
 * (permanent delete, change password, delete account).
 */
export async function confirmAction(
  password: string,
): Promise<{ confirmation_token: string; expires_at: string }> {
  // Direct fetch instead of request() — a 401 from /auth/confirm means the
  // user mistyped their password during step-up, NOT that their session
  // expired. Routing it through request() would clear the token and bounce
  // them to /login on every wrong attempt.
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/auth/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  })

  if (res.status === 401) {
    throw new IncorrectPasswordError()
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'Server returned an invalid response' }))) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<{ confirmation_token: string; expires_at: string }>
}

export async function verifyEmail(
  code: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function resendVerification(): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/resend-verification', { method: 'POST' })
}

export async function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/api/v1/auth/me')
}

// ─── 2FA endpoints ──────────────────────────────

export interface TotpSetupResponse {
  secret: string
  qr_uri: string
  backup_codes: string[]
}

export async function setup2fa(): Promise<TotpSetupResponse> {
  return request<TotpSetupResponse>('/api/v1/auth/2fa/setup', {
    method: 'POST',
  })
}

export async function enable2fa(code: string): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function disable2fa(code: string): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function verify2fa(
  partialToken: string,
  code: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ partial_token: partialToken, code }),
  })
  if (data.session_token) {
    setToken(data.session_token)
  }
  return data
}

// ─── Drive / Files endpoints ─────────────────────

export interface DriveFile {
  id: string
  name_encrypted: string
  /** Null for files uploaded after the ZK audit fix (commit 04d5288).
   *  Infer type from decrypted filename extension instead. */
  mime_type: string | null
  size_bytes: number
  is_folder: boolean
  parent_id: string | null
  chunk_count: number
  is_starred?: boolean
  has_thumbnail?: boolean
  version_number?: number
  /** Number of active (non-revoked, non-expired) share links for this file.
   *  Populated by a LEFT JOIN in the server's list_files handler. */
  share_count?: number
  created_at: string
  updated_at: string
}

export async function listFiles(
  parentId?: string,
  trashed?: boolean,
  options?: { starred?: boolean; recent?: boolean },
): Promise<DriveFile[]> {
  const params = new URLSearchParams()
  if (parentId) params.set('parent_id', parentId)
  if (trashed !== undefined) params.set('trashed', String(trashed))
  if (options?.starred) params.set('starred', 'true')
  if (options?.recent) params.set('recent', 'true')
  const qs = params.toString()
  const data = await request<{ files: DriveFile[] }>(`/api/v1/files${qs ? `?${qs}` : ''}`)
  return data.files
}

export async function createFolder(
  nameEncrypted: string,
  parentId?: string,
  folderId?: string,
): Promise<DriveFile> {
  return request<DriveFile>('/api/v1/files/folder', {
    method: 'POST',
    body: JSON.stringify({ name_encrypted: nameEncrypted, parent_id: parentId, folder_id: folderId }),
  })
}

// ─── Chunked upload endpoints ────────────────────
// (The legacy single-shot `uploadFile` was removed in task 0027. It sent the
// metadata field as `size` while the server expected `size_bytes`, so it
// would have 400'd if anyone called it — but nothing did. The chunked
// init+chunks+complete flow below is the one wired into encrypted-upload.ts.)

export async function initUpload(metadata: {
  file_id?: string
  name_encrypted: string
  /** Pass null — MIME type is now encrypted inside name_encrypted metadata. */
  mime_type: string | null
  size_bytes: number
  chunk_count: number
  parent_id?: string | null
}): Promise<{ file_id: string; chunk_count: number }> {
  return request<{ file_id: string; chunk_count: number }>(
    '/api/v1/files/upload/init',
    {
      method: 'POST',
      body: JSON.stringify(metadata),
    },
  )
}

export async function uploadChunk(
  fileId: string,
  index: number,
  data: Uint8Array,
): Promise<{ index: number; size: number }> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/files/${fileId}/chunks/${index}`, {
      method: 'PUT',
      headers,
      body: new Uint8Array(data) as BodyInit,
    })
  } catch (_err) {
    const message = 'Could not reach the server. Check your connection and try again.'
    notifyError?.(message)
    throw new ApiError(message, 0)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<{ index: number; size: number }>
}

export async function completeUpload(
  fileId: string,
): Promise<DriveFile> {
  return request<DriveFile>(`/api/v1/files/${fileId}/upload/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export interface UploadStatusResponse {
  file_id: string
  chunk_count: number
  uploaded_chunks: number[]
  is_uploading: boolean
}

export async function getUploadStatus(
  fileId: string,
): Promise<UploadStatusResponse> {
  return request<UploadStatusResponse>(
    `/api/v1/files/${fileId}/upload/status`,
  )
}

export async function getFile(id: string): Promise<DriveFile> {
  return request<DriveFile>(`/api/v1/files/${id}`)
}

export async function downloadFile(id: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/files/${id}/download`, { headers })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

export async function updateFile(
  fileId: string,
  updates: { parent_id?: string | null; name_encrypted?: string },
): Promise<DriveFile> {
  return request<DriveFile>(`/api/v1/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}`, { method: 'DELETE' })
}

export async function restoreFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}/restore`, { method: 'POST' })
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
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/api/v1/files/${fileId}/thumbnail`, {
    method: 'PUT',
    headers,
    body: blob,
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
}

// ─── Sync engine (CRDT op log + SSE) ─────────────
// Spec: docs/superpowers/specs/2026-05-02-crdt-sync-engine-design.md

export interface SyncNode {
  id: string
  name_encrypted: string
  parent_id: string | null
  is_folder: boolean
  size_bytes: number
  mime_type: string | null
  content_hash: string | null
  version_number: number
  has_thumbnail: boolean
  storage_pool_id: string | null
  is_trashed: boolean
  is_starred: boolean
  chunk_count?: number
  created_at: string
  updated_at: string
}

export interface SyncOp {
  seq_id: number
  op_type: string
  client_op_id?: string
  payload: Record<string, unknown>
  device_id?: string
  created_at: string
}

export interface SyncSnapshot {
  seq_id: number
  nodes: SyncNode[]
}

export interface SubmittedSyncOp {
  client_op_id: string
  op_type: string
  payload: Record<string, unknown>
  device_id?: string
}

export interface SyncOpsResult {
  applied: { seq_id: number; client_op_id: string }[]
  rejected: {
    client_op_id: string
    reason: string
    winning_op?: { op_type: string; payload: Record<string, unknown> }
  }[]
}

export interface StreamTokenResponse {
  stream_token: string
  expires_at: string
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

// ─── Password / Account endpoints ───────────────

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmToken?: string,
): Promise<{ message: string; salt: string; session_token: string }> {
  const data = await request<{
    message: string
    salt: string
    session_token: string
  }>('/api/v1/auth/change-password', {
    method: 'POST',
    headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
  setToken(data.session_token)
  return data
}

export async function forgotPassword(
  email: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string; session_token: string; salt: string }> {
  const data = await request<{ message: string; session_token: string; salt: string }>(
    '/api/v1/auth/reset-password',
    {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    },
  )
  setToken(data.session_token)
  return data
}

export async function deleteAccountPermanently(
  confirmation: string,
  confirmToken?: string,
): Promise<{ message: string; shred_after: string }> {
  const data = await request<{ message: string; shred_after: string }>(
    '/api/v1/auth/account',
    {
      method: 'DELETE',
      headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
      body: JSON.stringify({ confirmation }),
    },
  )
  clearToken()
  return data
}

export async function changeEmail(
  newEmail: string,
  password: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/account/email', {
    method: 'PUT',
    body: JSON.stringify({ new_email: newEmail, password }),
  })
}

export async function emailChangeStart(
  newEmail: string,
  opaqueClientMessage: string,
  confirmToken: string,
): Promise<{ server_message: string; email_change_token: string }> {
  return request('/api/v1/me/email/start', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
    body: JSON.stringify({ new_email: newEmail, opaque_client_message: opaqueClientMessage }),
  })
}

export async function emailChangeFinish(
  emailChangeToken: string,
  opaqueRegistration: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<{ email: string }> {
  return request('/api/v1/me/email/finish', {
    method: 'POST',
    body: JSON.stringify({
      email_change_token: emailChangeToken,
      opaque_registration: opaqueRegistration,
      recovery_check: recoveryCheck,
      x25519_public_key: x25519PublicKey,
    }),
  })
}

export interface AccountExport {
  user_id: string
  email: string
  exported_at: string
  preferences: Record<string, unknown>
  files: unknown[]
  shares: unknown[]
}

export async function exportAccountData(): Promise<AccountExport> {
  return request<AccountExport>('/api/v1/auth/account/export', {
    method: 'POST',
  })
}

// ─── Share endpoints ────────────────────────────

export interface ShareOptions {
  expires_in_hours?: number | null
  max_opens?: number | null
  passphrase?: string
  /**
   * When set, the client has wrapped the file key under a client-generated key
   * (double-encrypted mode). The server stores this opaque blob and returns it
   * to recipients — the server cannot decrypt it without the client key that
   * lives only in the URL fragment.
   * Format: base64(nonce(12) || AES-256-GCM-ciphertext(48)) = 80 chars.
   */
  wrapped_file_key?: string
}

export interface ShareInfo {
  id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  has_passphrase: boolean
  created_at: string
  /** True when the client supplied wrapped_file_key at creation time. */
  double_encrypted?: boolean
}

export interface ShareView {
  id: string
  name_encrypted?: string
  size_bytes?: number
  chunk_count?: number
  mime_type?: string
  shared_by?: string
  /** User ID of the person who created the share — for referral attribution. */
  sharer_id?: string
  expires_at?: string | null
  max_opens?: number | null
  open_count?: number
  created_at?: string
  requires_passphrase?: boolean
  error?: string
  message?: string
  /**
   * True when the share was created in double-encrypted mode.
   * When true, wrapped_file_key is present and the #key= fragment contains
   * the client key K_c — not the file key directly.
   * Recipients must: fileKey = AES-GCM-Decrypt(K_c, wrapped_file_key).
   */
  double_encrypted?: boolean
  /**
   * Base64-encoded wrapped file key (nonce || ciphertext, 60 bytes).
   * Only present when double_encrypted === true.
   * The server stores this opaque blob; decryption requires K_c from the URL fragment.
   */
  wrapped_file_key?: string
}

export interface MyShare {
  id: string
  file_id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  open_count: number
  has_passphrase: boolean
  revoked?: boolean
  created_at: string
  file: {
    name_encrypted: string
    size_bytes: number
    mime_type: string | null
  }
}

export async function createShare(
  fileId: string,
  options: ShareOptions = {},
): Promise<ShareInfo> {
  return request<ShareInfo>('/api/v1/shares', {
    method: 'POST',
    body: JSON.stringify({
      file_id: fileId,
      ...options,
    }),
  })
}

export async function getShare(token: string): Promise<ShareView> {
  // Public endpoint — no auth header
  const res = await fetch(`${API_URL}/api/v1/shares/${token}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<ShareView>
}

export async function verifySharePassphrase(
  token: string,
  passphrase: string,
): Promise<ShareView> {
  const res = await fetch(`${API_URL}/api/v1/shares/${token}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<ShareView>
}

export async function downloadSharedFile(token: string, passphrase?: string): Promise<Blob> {
  const headers: HeadersInit = {}
  if (passphrase) {
    headers['X-Share-Passphrase'] = passphrase
  }
  const res = await fetch(`${API_URL}/api/v1/shares/${token}/download`, { headers })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

/**
 * Fetch the first `byteCount` bytes of a shared file's raw ciphertext.
 * Used by the Glassbox "what the server sees" panel to show a real hex dump.
 * Sends a Range header; falls back gracefully if the server returns 200.
 */
export async function fetchShareCiphertextPreview(
  token: string,
  passphrase?: string,
  byteCount = 80,
): Promise<Uint8Array> {
  const headers: HeadersInit = { Range: `bytes=0-${byteCount - 1}` }
  if (passphrase) {
    headers['X-Share-Passphrase'] = passphrase
  }
  const res = await fetch(`${API_URL}/api/v1/shares/${token}/download`, { headers })
  if (!res.ok && res.status !== 206) {
    throw new ApiError(res.statusText, res.status)
  }
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf).slice(0, byteCount)
}

export async function listMyShares(): Promise<MyShare[]> {
  const data = await request<{ shares: MyShare[] }>('/api/v1/shares/mine')
  return data.shares
}

/** Fetch active (non-revoked, non-expired) shares for a specific file. */
export async function getSharesForFile(fileId: string): Promise<MyShare[]> {
  const data = await request<{ shares: MyShare[] }>(
    `/api/v1/shares/mine?file_id=${encodeURIComponent(fileId)}`,
  )
  return data.shares
}

export async function revokeShare(id: string): Promise<void> {
  await request<void>(`/api/v1/shares/${id}`, { method: 'DELETE' })
}

// ─── Share invites (blind sharing) ──────────────

export interface ShareInvite {
  id: string
  file_id: string
  sender_id: string
  recipient_email: string
  status: string
  created_at: string
  claimed_at?: string
  approved_at?: string
  file_name_encrypted?: string
  sender_email?: string
  sender_public_key?: string
  recipient_public_key?: string
  can_reshare?: boolean
  expires_at?: string | null
  size_bytes?: number
  is_folder?: boolean
  chunk_count?: number
  mime_type?: string
  encrypted_file_key?: string
  is_folder_share?: boolean
  encrypted_folder_key?: string
  encrypted_owner_folder_key?: string
}

export async function createInvite(
  fileId: string,
  recipientEmail: string,
  folderShare?: {
    is_folder_share: boolean
    encrypted_folder_key: string
    encrypted_owner_folder_key: string
    folder_keys: { file_id: string; encrypted_file_key: string }[]
  },
): Promise<{ invite_id: string; status: string; recipient_public_key?: string | null }> {
  return request('/api/v1/shares/invites', {
    method: 'POST',
    body: JSON.stringify({
      file_id: fileId,
      recipient_email: recipientEmail,
      ...folderShare,
    }),
  })
}

export async function getIncomingInvites(): Promise<ShareInvite[]> {
  const data = await request<{ invites: ShareInvite[] }>('/api/v1/shares/invites/incoming')
  return data.invites ?? []
}

export async function getPendingApprovals(): Promise<ShareInvite[]> {
  const data = await request<{ invites: ShareInvite[] }>('/api/v1/shares/invites/pending-approval')
  return data.invites ?? []
}

export async function getSentInvites(): Promise<ShareInvite[]> {
  const data = await request<{ invites: ShareInvite[] }>('/api/v1/shares/invites/sent')
  return data.invites ?? []
}

export async function claimInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/claim`, { method: 'POST' })
}

export async function approveInvite(
  inviteId: string,
  encryptedFileKey: string,
): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ encrypted_file_key: encryptedFileKey }),
  })
}

export async function denyInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/deny`, { method: 'POST' })
}

export async function cancelInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}`, { method: 'DELETE' })
}

export async function patchInvite(
  inviteId: string,
  updates: { can_reshare?: boolean; expires_at?: string },
): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export interface InviteActivity {
  recipient_email: string
  created_at: string
  claimed_at: string | null
  approved_at: string | null
  download_count: number
  last_accessed: string | null
  first_accessed: string | null
}

export async function getInviteActivity(inviteId: string): Promise<InviteActivity> {
  return request(`/api/v1/shares/invites/${inviteId}/activity`)
}

export async function resendInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/resend`, { method: 'POST' })
}

export async function withdrawInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/withdraw`, { method: 'POST' })
}

export async function hideInvite(inviteId: string): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/hide`, { method: 'POST' })
}

// ─── Share stats ─────────────────────────────

export interface ShareStats {
  active_links: number
  pending_invites: number
  total_downloads: number
}

export async function getShareStats(): Promise<ShareStats> {
  return request<ShareStats>('/api/v1/shares/stats')
}

// ─── Billing endpoints ─────────────────────────

export interface Plan {
  id: string
  name: string
  stripe_product_id?: string | null
  price_eur: number
  price_yearly_eur: number
  storage_bytes: number
  storage_label: string
  per_seat: boolean
  min_seats: number
  features: string[]
  is_active?: boolean
  sort_order?: number
}

export interface BillingSyncResult {
  /** Total plans upserted (server field: synced) */
  synced: number
  /** Alias for synced — server may return either */
  count?: number
  plans_synced?: number
  created: number
  updated: number
  synced_at: string
  message?: string
}

export async function syncBillingPlans(): Promise<BillingSyncResult> {
  return request<BillingSyncResult>('/api/v1/admin/billing/sync', { method: 'POST' })
}

export interface PlanUpdateInput {
  name?: string
  price_eur?: number
  price_yearly_eur?: number
  storage_bytes?: number
  features?: string[]
  is_active?: boolean
}

export interface PlanUpdateResponse {
  plan: Plan
  stripe_synced: boolean
  note?: string
}

/** PATCH /api/v1/admin/billing/plans/:slug */
export async function patchBillingPlan(
  slug: string,
  updates: PlanUpdateInput,
): Promise<PlanUpdateResponse> {
  return request<PlanUpdateResponse>(`/api/v1/admin/billing/plans/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export interface Subscription {
  plan: string
  billing_cycle: string
  seats: number
  region: string
  status: string
  is_mock?: boolean
  created_at: string | null
  current_period_end: string | null
}

export interface Invoice {
  id: string
  number: string
  date: string
  amount_eur: number
  status: string
  period: string
}

export interface StorageUsage {
  used_bytes: number
  plan_limit_bytes: number
  plan_name: string
}

export async function getStorageUsage(): Promise<StorageUsage> {
  return request<StorageUsage>('/api/v1/files/usage')
}

/**
 * GET /api/v1/billing/usage
 *
 * Returns authoritative storage quota from the billing subsystem.
 * Implemented in server task 0033. Returns null instead of throwing
 * when the endpoint is not yet deployed (404), so callers can fall back
 * to getStorageUsage() without crashing.
 */
export interface BillingUsage {
  used_bytes: number
  quota_bytes: number
  /** Server-computed percentage 0–100. */
  percentage: number
}

export async function fetchUsage(): Promise<BillingUsage | null> {
  try {
    return await request<BillingUsage>('/api/v1/billing/usage')
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function getPlans(): Promise<Plan[]> {
  const data = await request<{ plans: Plan[] }>('/api/v1/billing/plans')
  return data.plans
}

export async function getSubscription(): Promise<Subscription> {
  return request<Subscription>('/api/v1/billing/subscription')
}

export async function subscribe(params: {
  plan: string
  billing_cycle: string
  seats?: number
}): Promise<Subscription> {
  return request<Subscription>('/api/v1/billing/subscribe', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function getInvoices(): Promise<Invoice[]> {
  const data = await request<{ invoices: Invoice[] }>('/api/v1/billing/invoices')
  return data.invoices
}

export async function createCheckoutSession(params: {
  plan: string
  billing_cycle: string
  seats?: number
}): Promise<{ url: string }> {
  return request<{ url: string }>('/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/**
 * Open the Stripe Customer Portal for the current user.
 * Returns the portal session URL on success, or null when the endpoint is not
 * yet deployed (404) — callers should show a "not available yet" notice.
 */
export async function createPortalSession(): Promise<{ url: string } | null> {
  try {
    return await request<{ url: string }>('/api/v1/billing/portal-session', {
      method: 'POST',
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export interface PaymentMethod {
  type: string
  brand?: string
  last4?: string
  exp_month?: number
  exp_year?: number
  iban_last4?: string
  is_default: boolean
}

export async function getPaymentMethod(): Promise<PaymentMethod> {
  return request<PaymentMethod>('/api/v1/billing/payment-method')
}

export async function cancelSubscription(): Promise<{ message: string; cancel_at?: string }> {
  return request<{ message: string; cancel_at?: string }>('/api/v1/billing/cancel', { method: 'POST' })
}

export async function reactivateSubscription(): Promise<{ message?: string; action?: string; url?: string }> {
  return request<{ message: string }>('/api/v1/billing/reactivate', { method: 'POST' })
}

export async function createSetupIntent(): Promise<{ client_secret: string }> {
  return request<{ client_secret: string }>('/api/v1/billing/setup-intent', { method: 'POST' })
}

// ─── Referral program ────────────────────────────────────────────────────────

export interface ReferralStats {
  code: string
  referral_count: number
  earned_gb: number
}

export interface ReferralEntry {
  /** Anonymised display, e.g. "a***@example.com" */
  display_email: string
  joined_at: string
  status: 'active' | 'pending'
}

/**
 * Returns the user's referral code + summary stats.
 * Returns null on 404 — caller falls back to client-side code derivation.
 */
export async function getReferralStats(): Promise<ReferralStats | null> {
  try {
    return await request<ReferralStats>('/api/v1/referrals/stats')
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/**
 * List friends who signed up via the current user's referral link.
 * Returns [] on 404.
 */
export async function listReferrals(): Promise<ReferralEntry[]> {
  try {
    const data = await request<{ referrals: ReferralEntry[] }>('/api/v1/referrals')
    return data.referrals
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

// ─── Personal Access Tokens ───────────────────────────────────────────────────

export interface PersonalAccessToken {
  id: string
  name: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface CreateTokenResponse {
  id: string
  /** Raw token — shown exactly once. Server never returns it again. */
  token: string
  name: string
  scopes: string[]
  expires_at: string | null
}

/** List all personal access tokens for the current user. Returns [] on 404 (endpoint not yet deployed). */
export async function listTokens(): Promise<PersonalAccessToken[]> {
  try {
    const data = await request<{ tokens: PersonalAccessToken[] }>('/api/v1/tokens')
    return data.tokens
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

export interface CreateTokenParams {
  name: string
  scopes: string[]
  /** ISO duration string or null for no expiry — e.g. "P30D" */
  expires_in_days: number | null
}

/** Create a new personal access token. */
export async function createToken(params: CreateTokenParams): Promise<CreateTokenResponse> {
  return request<CreateTokenResponse>('/api/v1/tokens', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** Revoke a personal access token by ID. */
export async function revokeToken(id: string): Promise<void> {
  await request(`/api/v1/tokens/${id}`, { method: 'DELETE' })
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string
  url: string
  events: string[]
  is_active: boolean
  last_triggered_at: string | null
  failure_count: number
  created_at: string
}

export interface CreateWebhookResponse {
  id: string
  url: string
  /** Signing secret — returned once on creation, never again. */
  secret: string
  events: string[]
  is_active: boolean
}

/** List all webhooks. Returns [] on 404 (endpoint not yet deployed). */
export async function listWebhooks(): Promise<Webhook[]> {
  try {
    const data = await request<{ webhooks: Webhook[] }>('/api/v1/webhooks')
    return data.webhooks
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

/** Create a webhook. Returns the config including the signing secret (shown once). */
export async function createWebhook(
  url: string,
  events: string[],
): Promise<CreateWebhookResponse> {
  return request<CreateWebhookResponse>('/api/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, events }),
  })
}

/** Delete / revoke a webhook. */
export async function deleteWebhook(id: string): Promise<void> {
  await request(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
}

/** Send a test event to the webhook endpoint. */
export async function testWebhook(
  id: string,
): Promise<{ success: boolean; status_code?: number }> {
  return request<{ success: boolean; status_code?: number }>(
    `/api/v1/webhooks/${id}/test`,
    { method: 'POST' },
  )
}

/** Re-enable a disabled webhook (clears failure count, sets is_active = true). */
export async function enableWebhook(id: string): Promise<Webhook> {
  return request<Webhook>(`/api/v1/webhooks/${id}/enable`, { method: 'POST' })
}

// ─── Admin endpoints ──────────────────────────

export interface AuditEvent {
  id: string
  workspace_id: string | null
  actor: string
  event: string
  target: string | null
  ip_address: string | null
  device: string | null
  created_at: string
}

export interface WorkspaceMember {
  id: string
  email: string
  email_verified: boolean
  joined_at: string
}

export async function listAuditLog(params?: {
  actor?: string
  event?: string
  limit?: number
  offset?: number
}): Promise<{ events: AuditEvent[]; total: number; page: number }> {
  const qs = new URLSearchParams()
  if (params?.actor) qs.set('actor', params.actor)
  if (params?.event) qs.set('event', params.event)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return request<{ events: AuditEvent[]; total: number; page: number }>(
    `/api/v1/activity${q ? `?${q}` : ''}`,
  )
}

export async function exportAuditLog(): Promise<{
  export: { format: string; exported_at: string; total: number }
  events: AuditEvent[]
}> {
  return request('/api/v1/admin/audit-log/export')
}

export async function listMembers(): Promise<WorkspaceMember[]> {
  const data = await request<{ members: WorkspaceMember[] }>('/api/v1/admin/members')
  return data.members
}

export async function inviteMember(email: string): Promise<{ message: string; email: string }> {
  return request('/api/v1/admin/members/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function removeMember(id: string): Promise<{ message: string }> {
  return request(`/api/v1/admin/members/${id}`, { method: 'DELETE' })
}

// ─── Admin user endpoints (platform-wide) ────────────────

export interface AdminUser {
  id: string
  email: string
  created_at: string
  email_verified: boolean
  plan: string
  storage_used_bytes: number
}

export interface AdminUsersResponse {
  users: AdminUser[]
  total: number
  limit: number
  offset: number
}

export interface AdminUserDetail {
  id: string
  email: string
  email_verified: boolean
  /** Top-level account role. Server adds this in `7be299a` for task 0018. */
  role: 'user' | 'admin' | 'superadmin'
  created_at: string
  plan: string
  billing_cycle: string | null
  subscription_status: string | null
  current_period_end: string | null
  storage_bytes: number
  file_count: number
  share_count: number
  session_count: number
  last_login: string | null
  workspaces: { id: string; name: string; role: string; joined_at: string }[]
  plan_limit_bytes?: number
  /** Whether the account uses OPAQUE (true) or legacy Argon2id (false/absent). */
  opaque_enrolled?: boolean
  /** Whether the account is suspended (cannot log in). */
  is_suspended?: boolean
}

export async function listAdminUsers(params?: {
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminUsersResponse> {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset != null) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return request<AdminUsersResponse>(
    `/api/v1/admin/users${q ? `?${q}` : ''}`,
  )
}

export async function getAdminUserDetail(id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/v1/admin/users/${id}`)
}

/** A single active session for a user. */
export interface AdminUserSession {
  id: string
  created_at: string
  last_active_at: string | null
  ip_address: string | null
  user_agent: string | null
  device_hint: string | null
}

/**
 * GET /api/v1/admin/users/:id/sessions
 * Returns empty list gracefully on 404 (endpoint not yet deployed).
 */
export async function getAdminUserSessions(userId: string): Promise<AdminUserSession[]> {
  try {
    const data = await request<{ sessions: AdminUserSession[] }>(
      `/api/v1/admin/users/${userId}/sessions`,
    )
    return data.sessions
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

/** POST /api/v1/admin/users/:id/suspend */
export async function suspendUser(userId: string): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/suspend`, { method: 'POST', body: JSON.stringify({}) })
}

/** POST /api/v1/admin/users/:id/unsuspend */
export async function unsuspendUser(userId: string): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/unsuspend`, { method: 'POST', body: JSON.stringify({}) })
}

// ─── Admin waitlist ──────────────────────────────

export interface WaitlistEntry {
  email: string
  source: string
  created_at: string
}

export interface WaitlistResponse {
  count: number
  entries: WaitlistEntry[]
}

export async function getWaitlist(): Promise<WaitlistResponse> {
  return request<WaitlistResponse>('/api/v1/admin/waitlist')
}

// ─── Admin storage pool endpoints ────────────────

export interface StoragePool {
  id: string
  name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  /** Human-readable city name shown in region badges (e.g. "Falkenstein") */
  city?: string | null
  /** Continent slug for data-residency display (e.g. "europe") */
  continent?: string | null
  display_name: string
  is_default: boolean
  is_active: boolean
  capacity_bytes: number | null
  used_bytes: number
  usage_pct: number | null
  created_at: string
  lifecycle_phase?: LifecyclePhase
}

export interface MigrationSummary {
  pending: number
  copying: number
  verifying: number
  done: number
  failed: number
  total: number
}

export interface MigrationEntry {
  id: string
  file_id: string
  from_pool: string | null
  to_pool: string | null
  status: string
  chunks_copied: number
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export async function listStoragePools(): Promise<StoragePool[]> {
  const data = await request<{ pools: StoragePool[] }>('/api/v1/admin/storage-pools')
  return data.pools
}

export async function listMigrations(): Promise<{
  summary: MigrationSummary
  recent: MigrationEntry[]
}> {
  return request('/api/v1/admin/migrations')
}

export async function createStoragePool(params: {
  name: string
  display_name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  city?: string
  continent?: string
  access_key_id: string
  secret_access_key: string
  capacity_bytes?: number | null
  is_default?: boolean
}): Promise<StoragePool> {
  return request<StoragePool>('/api/v1/admin/storage-pools', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function updateStoragePool(
  id: string,
  updates: {
    display_name?: string
    city?: string
    is_active?: boolean
    is_default?: boolean
    /** Pass -1 to clear the capacity limit (set to unlimited). */
    capacity_bytes?: number | null
  },
): Promise<StoragePool> {
  return request<StoragePool>(`/api/v1/admin/storage-pools/${id}`, {
    method: 'POST',
    body: JSON.stringify(updates),
  })
}

export interface PoolUsageEntry {
  user_id: string
  email: string
  used_bytes: number
  file_count: number
}

export async function getPoolUsage(id: string): Promise<{
  pool_id: string
  entries: PoolUsageEntry[]
}> {
  return request(`/api/v1/admin/storage-pools/${id}/usage`)
}

export async function migrateUser(
  userId: string,
  targetPoolId: string,
): Promise<{ message: string; migration_count: number }> {
  // Body field is `target_pool_id` to match the server contract (sister
  // handlers `migrate_all_pool` + `decommission_pool` use the same name).
  // The previous `to_pool_id` was silently discarded by the server before
  // task 0019's backend fix (e0ffae0). See task 0019 for details.
  return request(`/api/v1/admin/migrate-user/${userId}`, {
    method: 'POST',
    body: JSON.stringify({ target_pool_id: targetPoolId }),
  })
}

// ─── Admin: per-user storage breakdown ────────────────

export interface UserStoragePoolEntry {
  pool_id: string
  pool_name: string
  file_count: number
  total_bytes: number
}

export interface UserStorageBreakdown {
  user_id: string
  /** Pools where the user has at least one non-trashed, non-folder file. */
  pools: UserStoragePoolEntry[]
  total_files: number
  total_bytes: number
  plan_name: string
  plan_limit_bytes: number
}

/**
 * Per-pool breakdown of a user's storage. Used by the admin user-detail
 * drawer to filter the migrate-destination dropdown — pools that already
 * appear in `pools[]` are sources, not valid destinations.
 */
export async function getUserStorage(userId: string): Promise<UserStorageBreakdown> {
  return request<UserStorageBreakdown>(`/api/v1/admin/user-storage/${userId}`)
}

// ─── Folder sharing ──────────────────────────────

export async function getFolderKeys(
  inviteId: string,
): Promise<{ file_id: string; encrypted_file_key: string }[]> {
  const data = await request<{ keys: { file_id: string; encrypted_file_key: string }[] }>(
    `/api/v1/shares/invites/${inviteId}/folder-keys`,
  )
  return data.keys
}

export async function addFolderKeys(
  inviteId: string,
  keys: { file_id: string; encrypted_file_key: string }[],
): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/folder-keys`, {
    method: 'POST',
    body: JSON.stringify({ keys }),
  })
}

export async function getFolderMembers(
  folderId: string,
): Promise<{ members: { user_id: string; public_key: string | null; email: string; is_owner?: boolean }[]; owner_id: string }> {
  return request(`/api/v1/shares/invites/folder-members/${folderId}`)
}

export async function listSharedFolderFiles(
  sharedFolderId: string,
  parentId?: string,
): Promise<DriveFile[]> {
  let url = `/api/v1/files?shared_folder_id=${sharedFolderId}`
  if (parentId) url += `&parent_id=${parentId}`
  const data = await request<{ files: DriveFile[] }>(url)
  return data.files
}

// ─── User preferences ────────────────────────────

export async function getPreferences(): Promise<Record<string, unknown>> {
  const data = await request<{ preferences: Record<string, unknown> }>('/api/v1/preferences')
  return data.preferences
}

export async function getPreference<T = unknown>(key: string): Promise<T | null> {
  try {
    const data = await request<{ value: T }>(`/api/v1/preferences/${key}`)
    return data.value
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  await request(`/api/v1/preferences/${key}`, {
    method: 'PUT',
    body: JSON.stringify(value),
  })
}

// ─── Passkey endpoints ──────────────────────────

export interface PasskeyInfo {
  id: string
  name: string
  created_at: string
}

// ─── WebAuthn base64url helpers ──────────────────

/** Decode a base64url string to an ArrayBuffer. */
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  // Restore standard base64 characters and padding
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/** Encode an ArrayBuffer to a base64url string (no padding). */
export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The server (webauthn-rs) serialises binary fields as base64url strings.
 * The browser WebAuthn API expects ArrayBuffers. This converts the server's
 * CreationChallengeResponse.publicKey into a browser-compatible object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverOptsToCreateOptions(publicKey: any): PublicKeyCredentialCreationOptions {
  const opts: PublicKeyCredentialCreationOptions = {
    ...publicKey,
    challenge: base64urlToBuffer(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: base64urlToBuffer(publicKey.user.id),
    },
  }
  if (publicKey.excludeCredentials) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts.excludeCredentials = publicKey.excludeCredentials.map((cred: any) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    }))
  }
  return opts
}

/**
 * The server (webauthn-rs) serialises binary fields as base64url strings.
 * The browser WebAuthn API expects ArrayBuffers. This converts the server's
 * RequestChallengeResponse.publicKey into a browser-compatible object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverOptsToGetOptions(publicKey: any): PublicKeyCredentialRequestOptions {
  const opts: PublicKeyCredentialRequestOptions = {
    ...publicKey,
    challenge: base64urlToBuffer(publicKey.challenge),
  }
  if (publicKey.allowCredentials) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts.allowCredentials = publicKey.allowCredentials.map((cred: any) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    }))
  }
  return opts
}

/**
 * Convert a browser PublicKeyCredential (from navigator.credentials.create)
 * into the JSON shape expected by webauthn-rs RegisterPublicKeyCredential.
 */
export function credentialToRegistrationJSON(credential: PublicKeyCredential): {
  id: string
  rawId: string
  type: string
  response: {
    attestationObject: string
    clientDataJSON: string
  }
  extensions: AuthenticationExtensionsClientOutputs
} {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
    extensions: credential.getClientExtensionResults(),
  }
}

/**
 * Convert a browser PublicKeyCredential (from navigator.credentials.get)
 * into the JSON shape expected by webauthn-rs PublicKeyCredential.
 */
export function credentialToAuthenticationJSON(credential: PublicKeyCredential): {
  id: string
  rawId: string
  type: string
  response: {
    authenticatorData: string
    clientDataJSON: string
    signature: string
    userHandle: string | null
  }
  extensions: AuthenticationExtensionsClientOutputs
} {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
    extensions: credential.getClientExtensionResults(),
  }
}

// ─── Passkey registration endpoints ─────────────

/** Raw server response — binary fields are base64url strings, not ArrayBuffers. */
interface PasskeyRegisterStartResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicKey: any
  reg_state: string
}

export async function startPasskeyRegistration(): Promise<PasskeyRegisterStartResponse> {
  return request<PasskeyRegisterStartResponse>('/api/v1/auth/passkey/register-start', {
    method: 'POST',
  })
}

export async function finishPasskeyRegistration(
  credential: ReturnType<typeof credentialToRegistrationJSON>,
  regState: string,
  name?: string,
): Promise<PasskeyInfo> {
  return request<PasskeyInfo>('/api/v1/auth/passkey/register-finish', {
    method: 'POST',
    body: JSON.stringify({ credential, reg_state: regState, name }),
  })
}

// ─── Passkey login endpoints ─────────────────────

/** Raw server response — binary fields are base64url strings, not ArrayBuffers. */
interface PasskeyLoginStartResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicKey: any
  auth_state: string
  user_id: string
}

export async function startPasskeyLogin(email: string): Promise<PasskeyLoginStartResponse> {
  return request<PasskeyLoginStartResponse>('/api/v1/auth/passkey/login-start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function finishPasskeyLogin(
  credential: ReturnType<typeof credentialToAuthenticationJSON>,
  authState: string,
  userId: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/passkey/login-finish', {
    method: 'POST',
    body: JSON.stringify({ credential, auth_state: authState, user_id: userId }),
  })
  if (data.session_token) {
    setToken(data.session_token)
  }
  return data
}

// ─── Passkey management endpoints ────────────────

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const data = await request<{ passkeys: PasskeyInfo[] }>('/api/v1/auth/passkeys')
  return data.passkeys
}

export async function deletePasskey(id: string): Promise<void> {
  await request<void>(`/api/v1/auth/passkeys/${id}`, { method: 'DELETE' })
}

// ─── Activity endpoints ──────────────────────────

export interface ActivityEvent {
  id: string
  type: string
  subject: string | null
  details: string | null
  where: string | null
  /** Client that triggered the event — "web" | "mobile-ios" | "mobile-android" | "desktop" | "cli" */
  device?: string | null
  created_at: string
}

export interface ActivityResponse {
  events: ActivityEvent[]
  total: number
  page: number
}

export async function listActivity(
  page?: number,
  type?: string,
  since?: string,
): Promise<ActivityResponse> {
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (type) params.set('type', type)
  if (since) params.set('since', since)
  const qs = params.toString()
  return request<ActivityResponse>(`/api/v1/activity${qs ? `?${qs}` : ''}`)
}

// ─── Account activity (0050) ─────────────────────

export interface AccountActivityEvent {
  id: string
  type: string
  description: string
  category: string
  outcome: string
  device: string | null
  country_code: string | null
  created_at: string
}

export interface AccountActivitySummary {
  last_login_at: string | null
  last_login_device: string | null
  active_sessions: number
  active_shares: number
  security_score: string
}

export interface AccountActivity {
  events: AccountActivityEvent[]
  summary: AccountActivitySummary
}

export interface SecurityFactor {
  key: string
  satisfied: boolean
}

export interface SecurityScore {
  score: number
  max: number
  label: string
  factors: SecurityFactor[]
}

export interface AccountSession {
  id: string
  device_name: string
  device_kind: string
  country_code: string | null
  last_active_at: string | null
  created_at: string
  is_current: boolean
}

export async function getAccountActivity(): Promise<AccountActivity> {
  return request<AccountActivity>('/api/v1/account/activity')
}

export async function getSecurityScore(): Promise<SecurityScore> {
  return request<SecurityScore>('/api/v1/account/security-score')
}

export async function getAccountSessions(): Promise<{ sessions: AccountSession[] }> {
  return request<{ sessions: AccountSession[] }>('/api/v1/account/sessions')
}

export async function revokeAccountSession(id: string): Promise<void> {
  await request<void>(`/api/v1/account/sessions/${id}`, { method: 'DELETE' })
}

export async function revokeAllOtherSessions(): Promise<{ revoked: number }> {
  return request<{ revoked: number }>('/api/v1/account/sessions/revoke-all-others', {
    method: 'POST',
  })
}

// ─── Workspace endpoints ──────────────────────────

export interface Workspace {
  id: string
  name: string
  owner_id: string
  role: string
  created_at: string
}

export interface WorkspaceMemberDetail {
  id: string
  email: string
  role: string
  joined_at: string
}

export interface PendingInvite {
  id: string
  email: string
  role: string
  invited_by: string
  created_at: string
  expires_at: string
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMemberDetail[]
  pending_invites: PendingInvite[]
}

export interface InviteInfo {
  id: string
  email: string
  role: string
  token: string
  workspace_name: string
  invited_by: string
  expires_at: string
  created_at: string
}

export interface AcceptInviteResponse {
  message: string
  workspace_id: string
  workspace_name: string
  role?: string
  invited_by?: string
}

export interface InvitePreview {
  workspace_name: string
  invited_by: string
  role: string
  expires_at: string
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return request<Workspace>('/api/v1/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ workspaces: Workspace[] }>('/api/v1/workspaces')
  return data.workspaces
}

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMembersResponse> {
  return request<WorkspaceMembersResponse>(
    `/api/v1/workspaces/${workspaceId}/members`,
  )
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  email: string,
  role?: string,
): Promise<InviteInfo> {
  return request<InviteInfo>(`/api/v1/workspaces/${workspaceId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

export async function acceptWorkspaceInvite(
  token: string,
): Promise<AcceptInviteResponse> {
  return request<AcceptInviteResponse>('/api/v1/workspaces/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await request<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await request<void>(
    `/api/v1/workspaces/${workspaceId}/members/${userId}/role`,
    {
      method: 'PUT',
      body: JSON.stringify({ role }),
    },
  )
}

export async function getInvitePreview(
  token: string,
): Promise<InvitePreview> {
  // Public endpoint — no auth header needed
  const res = await fetch(`${API_URL}/api/v1/workspaces/invite-preview/${token}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<InvitePreview>
}

// ─── Version History ──────────────────────────────────────

export interface FileVersion {
  id: string
  version_number: number
  size_bytes: number
  chunk_count: number
  created_by: string | null
  created_at: string
}

export async function listVersions(fileId: string): Promise<{
  file_id: string
  current_version: number
  versions: FileVersion[]
}> {
  return request(`/api/v1/files/${fileId}/versions`)
}

export async function downloadVersion(fileId: string, versionId: string): Promise<Blob> {
  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new ApiError('download failed', res.status)
  return res.blob()
}

export async function restoreVersion(fileId: string, versionId: string): Promise<{ message: string; version_number: number }> {
  return request(`/api/v1/files/${fileId}/versions/${versionId}/restore`, { method: 'POST' })
}

export async function deleteVersion(fileId: string, versionId: string): Promise<void> {
  await request(`/api/v1/files/${fileId}/versions/${versionId}`, { method: 'DELETE' })
}

export interface VersionSetting {
  id: string
  scope: string
  target_id: string | null
  enabled: boolean
  max_versions: number | null
  retention_days: number | null
}

export async function getVersionSettings(): Promise<{ settings: VersionSetting[] }> {
  return request('/api/v1/version-settings')
}

export async function setVersionSetting(params: {
  scope: string
  target_id?: string
  enabled: boolean
  max_versions?: number
  retention_days?: number
}): Promise<void> {
  await request('/api/v1/version-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

// ─── Notifications ────────────────────────────────────────

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  read: boolean
  created_at: string
}

export async function listNotifications(unreadOnly?: boolean): Promise<{
  notifications: Notification[]
  unread_count: number
}> {
  const params = unreadOnly ? '?unread_only=true' : ''
  return request(`/api/v1/notifications${params}`)
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/api/v1/notifications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: true }),
  })
}

export async function markAllNotificationsRead(): Promise<void> {
  await request('/api/v1/notifications/read-all', { method: 'POST' })
}

export async function deleteNotification(id: string): Promise<void> {
  await request(`/api/v1/notifications/${id}`, { method: 'DELETE' })
}

// ─── Sessions ─────────────────────────────────────────────

export interface Session {
  id: string
  is_current: boolean
  created_at: string
  expires_at: string
}

export async function listSessions(): Promise<{ sessions: Session[] }> {
  return request('/api/v1/auth/sessions')
}

export async function revokeSession(id: string): Promise<void> {
  await request(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' })
}

// ─── Admin impersonation ────────────────────────

export interface ImpersonateResponse {
  session_token: string
  user_id: string
  email: string
}

export async function adminImpersonate(userId: string): Promise<ImpersonateResponse> {
  const data = await request<ImpersonateResponse>(`/api/v1/admin/impersonate/${userId}`, {
    method: 'POST',
  })
  return data
}

// ─── Admin role management (superadmin-only on server) ──────────

export interface RoleChangeResponse {
  message: string
  user_id: string
  role: 'user' | 'admin' | 'superadmin'
}

/** Promote a user to admin. Server requires superadmin auth. */
export async function adminPromote(userId: string): Promise<RoleChangeResponse> {
  return request<RoleChangeResponse>(`/api/v1/admin/promote/${userId}`, {
    method: 'POST',
  })
}

/** Demote an admin back to regular user. Server requires superadmin auth. */
export async function adminDemote(userId: string): Promise<RoleChangeResponse> {
  return request<RoleChangeResponse>(`/api/v1/admin/demote/${userId}`, {
    method: 'POST',
  })
}

// ─── Admin stats & health ────────────────────────

export interface AdminStats {
  users: {
    total: number
    active_7d: number
    signups_today: number
  }
  files: {
    total: number
    storage_used_bytes: number
    uploads_today: number
  }
  shares: {
    active_links: number
    active_invites: number
    created_today: number
  }
}

export interface HealthWorkerItem {
  interval_secs: number
  last_run: string | null
  seconds_ago?: number | null
  status: string
}

export interface HealthResponse {
  status: string
  version: string
  uptime_seconds: number
  db: string
  blob_store?: string
  db_pool?: { active: number; idle: number; max: number; size: number }
  checks: {
    database: { status: string; latency_ms: number }
    blob_store: { status: string; pools: number }
  }
  background_workers?: {
    any_stale: boolean
    count: number
    items: Record<string, HealthWorkerItem>
  }
  websocket_connections?: number
  process_memory?: { rss_kb: number; rss_mb: number } | null
}

export async function getAdminStats(): Promise<AdminStats> {
  return request<AdminStats>('/api/v1/admin/stats')
}

// ─── Admin billing stats ─────────────────────────────────────────────────────

export interface AdminBillingStats {
  total_subscribers: number
  mrr_cents: number
  conversion_rate: number
  plan_distribution: {
    free: number
    personal: number
    pro: number
    data_hoarder: number
    // Legacy keys — may be absent on new servers
    team?: number
    business?: number
  }
  recent_invoices: Array<{
    id: string
    user_id: string
    amount_cents: number
    currency: string
    status: 'paid' | 'open' | 'void' | 'uncollectible'
    created_at: string
  }>
}

/**
 * Fetch aggregate billing stats from the admin API.
 * Returns null if the endpoint doesn't exist yet (404) so the UI can show
 * a graceful placeholder rather than crashing.
 */
export async function getAdminBillingStats(): Promise<AdminBillingStats | null> {
  try {
    return await request<AdminBillingStats>('/api/v1/admin/billing/stats')
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

// ─── Admin server config ─────────────────────────────────────────────────────

export interface AdminConfig {
  email: {
    provider: string | null
    configured: boolean
  }
  slack: {
    configured: boolean
    webhook_url_prefix: string | null
  }
  turnstile: {
    configured: boolean
    sitekey_prefix: string | null
  }
}

/**
 * Fetch server-side config flags from the admin API.
 * Returns null if the endpoint doesn't exist yet (404).
 */
export async function getAdminConfig(): Promise<AdminConfig | null> {
  try {
    return await request<AdminConfig>('/api/v1/admin/config')
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`)
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.json() as Promise<HealthResponse>
}

// ─── Abuse reports ──────────────────────────────

export async function reportShareLink(
  shareToken: string,
  reason: string,
): Promise<{ id: string }> {
  // Public endpoint — no auth header needed
  const res = await fetch(`${API_URL}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_token: shareToken, reason }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server returned an invalid response' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<{ id: string }>
}

// ─── Admin abuse reports ────────────────────────

export type AbuseReportStatus = 'pending' | 'reviewing' | 'actioned' | 'dismissed'

export interface AbuseReport {
  id: string
  share_token: string
  reporter_id: string | null
  reporter_ip: string | null
  reporter_email: string | null
  reason: string
  status: AbuseReportStatus
  admin_notes: string | null
  created_at: string
  resolved_at: string | null
}

export async function listAbuseReports(params?: {
  status?: AbuseReportStatus
  limit?: number
}): Promise<AbuseReport[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const q = qs.toString()
  const data = await request<{ reports: AbuseReport[]; count: number }>(
    `/api/v1/admin/reports${q ? `?${q}` : ''}`,
  )
  return data.reports
}

export async function updateAbuseReport(
  id: string,
  updates: { status: AbuseReportStatus; admin_notes?: string },
): Promise<{ id: string; status: AbuseReportStatus; resolved_at: string | null; message: string }> {
  return request(`/api/v1/admin/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

// ─── Constellation peer transfer ────────────────────
//
// Receiver-side endpoints for the Constellation transfer flow. These run
// without an active Beebeeb session — anyone with a 6-digit code (or
// session_id) can join, derive a SAS code with the sender, and download.
// Bearer auth is intentionally omitted; the per-session `download_token`
// returned at join time authenticates subsequent calls.
//
// Sender-side endpoints (init / approve / upload / cancel) live elsewhere
// — only Beebeeb users initiate transfers, and the web client is receive-
// only for v1.

export interface JoinTransferResponse {
  /** Sender's ephemeral X25519 public key, base64. */
  sender_pk: string
  /** One-time token the receiver presents on status / blob / ack. */
  download_token: string
}

/**
 * POST /api/v1/transfer/{session_id}/join — receiver joins a known session.
 * Used when the receiver has the session_id directly (e.g. from a scanned
 * constellation). For 6-digit code entry, use joinTransferByCode.
 */
export async function joinTransfer(
  sessionId: string,
  receiverPk: string,
): Promise<JoinTransferResponse> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_pk: receiverPk }),
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<JoinTransferResponse>
}

/**
 * POST /api/v1/transfer/join-by-code — receiver joins by the 6-digit
 * fallback code shown on the sender's screen. The server resolves the
 * code to an active session and returns the same shape as joinTransfer
 * with the resolved session_id added.
 */
export async function joinTransferByCode(
  code: string,
  receiverPk: string,
): Promise<JoinTransferResponse & { session_id: string }> {
  const res = await fetch(`${API_URL}/api/v1/transfer/join-by-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fallback_code: code, receiver_pk: receiverPk }),
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<JoinTransferResponse & { session_id: string }>
}

export interface TransferStatus {
  status: 'waiting' | 'joined' | 'approved' | 'ready' | 'downloaded' | 'complete' | 'cancelled' | 'expired'
  receiver_pk?: string
  blob_size?: number
  /** Encrypted (with transfer_key) filename hint, base64. */
  file_name_hint?: string
}

/**
 * GET /api/v1/transfer/{id}/status — receiver polls for sender approval +
 * upload completion. Authenticated with the per-session download_token.
 */
export async function getTransferStatus(
  sessionId: string,
  token: string,
): Promise<TransferStatus> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/status`, {
    method: 'GET',
    headers: { 'X-Transfer-Token': token },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.json() as Promise<TransferStatus>
}

/**
 * GET /api/v1/transfer/{id}/blob — receiver downloads the encrypted blob.
 * Returns the raw bytes as a Blob (nonce-prefixed AES-GCM ciphertext).
 */
export async function downloadTransferBlob(
  sessionId: string,
  token: string,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/blob`, {
    method: 'GET',
    headers: { 'X-Transfer-Token': token },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.blob()
}

/**
 * POST /api/v1/transfer/{id}/ack — receiver confirms successful decrypt.
 * Triggers server-side blob deletion and marks the session complete.
 */
export async function ackTransfer(sessionId: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/transfer/${sessionId}/ack`, {
    method: 'POST',
    headers: { 'X-Transfer-Token': token, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body.error ?? body.message ?? res.statusText
  } catch {
    return res.statusText
  }
}

// ─── Admin: pool migration ─────────────────────────────

export async function migrateAllPool(
  poolId: string,
  targetPoolId: string,
): Promise<{ migrations_queued: number }> {
  return request(`/api/v1/admin/storage-pools/${poolId}/migrate-all`, {
    method: 'POST',
    body: JSON.stringify({ target_pool_id: targetPoolId }),
  })
}

export async function decommissionPool(
  poolId: string,
  targetPoolId: string,
): Promise<{ pool_id: string; status: string; migrations_queued: number }> {
  return request(`/api/v1/admin/storage-pools/${poolId}/decommission`, {
    method: 'POST',
    body: JSON.stringify({ target_pool_id: targetPoolId }),
  })
}

export async function reconcileUsage(): Promise<{
  pools_corrected: number
  total_drift_bytes: number
}> {
  return request('/api/v1/admin/reconcile-usage', { method: 'POST' })
}

// ─── Admin: CSP reports ────────────────────────────────

export interface CspReport {
  id: string
  document_uri: string | null
  violated_directive: string | null
  blocked_uri: string | null
  source_file: string | null
  line_number: number | null
  created_at: string
}

export async function listCspReports(params?: {
  limit?: number
  offset?: number
}): Promise<{ reports: CspReport[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.offset) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request(`/api/v1/admin/csp-reports${qs ? `?${qs}` : ''}`)
}

// ─── Admin: user login IPs ────────────────────────────

export interface LoginIp {
  ip: string
  first_seen: string
  last_seen: string
}

export async function getUserLoginIps(userId: string): Promise<{ ips: LoginIp[] }> {
  return request(`/api/v1/admin/users/${userId}/login-ips`)
}

// ─── Admin: growth data ───────────────────────────────

export interface GrowthDataPoint {
  date: string
  value: number
}

export async function getAdminGrowthData(
  metric: 'signups' | 'storage' | 'shares',
  days: number = 30,
): Promise<{ data: GrowthDataPoint[] }> {
  return request(`/api/v1/admin/stats/growth?metric=${metric}&days=${days}`)
}

// ─── Storage pool lifecycle wizard (spec 011) ─────────────────────────────
//
// All endpoints are mounted at `/api/v1/admin/pools/:poolId/…` and gated on
// `SuperAdminUser` server-side. The existing Bearer token in localStorage
// carries that auth automatically via the `request()` helper.

export type LifecyclePhase =
  | 'active'
  | 'quiescing'
  | 'migrating'
  | 'drained'
  | 'deleted'

export type LifecycleOutcome =
  | 'in_progress'
  | 'aborted'
  | 'reverse_migrated'
  | 'archived'
  | 'completed_deleted'

export interface LifecycleRun {
  id: string
  pool_id: string
  target_pool_id: string
  started_by: string
  started_at: string
  current_phase: LifecyclePhase
  outcome: LifecycleOutcome
  terminated_at: string | null
}

/** Live stats for an active pool shown in the Phase 1 insights panel. */
export interface PoolInsights {
  used_bytes: number
  files_count: number
  users_with_files_count: number
  currently_active_users_count: number
  in_flight_uploads_count: number
  /** Rough estimate based on recent migration throughput; falls back to a
   *  static 50 MB/s baseline when no history data is available. */
  estimated_migration_seconds: number
}

/** Progress snapshot polled every 5 s during the migrating phase. */
export interface RunProgress {
  run: LifecycleRun
  /** 0..1 fraction of files migrated for this run. */
  phase_progress: number
  throughput_bytes_per_sec: number
  files_total: number
  files_migrated: number
  files_failed: number
  files_pending: number
  /** Remaining seconds at current throughput; 0 when complete. */
  eta_seconds: number
}

/** Single file_migrations row returned by getLifecycleRunFiles. */
export interface RunFileEntry {
  file_id: string
  /** Encrypted filename — UI shows truncated UUID or raw ciphertext; not decryptable in admin context. */
  name_encrypted: string
  size_bytes: number
  status: 'pending' | 'copying' | 'verifying' | 'done' | 'failed' | string
  error: string | null
  started_at: string | null
  completed_at: string | null
}

/**
 * POST /api/v1/admin/pools/:poolId/lifecycle/runs/:runId/files/:fileId/retry
 *
 * Resets a failed file_migration row to 'pending' so the worker picks it up
 * again. No-op if the file is already done/pending/copying.
 */
export async function retryFile(
  poolId: string,
  runId: string,
  fileId: string,
): Promise<{ status: string }> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/files/${fileId}/retry`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** GET /api/v1/admin/pools/:poolId/lifecycle/runs/:runId/files
 *
 *  Returns the 20 most recent file_migrations for the run, newest first.
 *  Used by the migrating panel's "Recent files" list. */
export async function getLifecycleRunFiles(
  poolId: string,
  runId: string,
): Promise<{ files: RunFileEntry[]; total: number }> {
  return request(`/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/files`)
}

/**
 * A single persisted migration event row, as returned by the events history
 * endpoint. Shape mirrors the WebSocket MigrationEvent variants plus an
 * auto-increment `id` used for replay (since_id cursor).
 *
 * All variant-specific fields are optional — use `type` to discriminate.
 */
export interface LifecycleRunEvent {
  /** DB sequence number — used as the since_id cursor for WS reconnect replay. */
  id: number
  type: string
  at: string
  // file event fields
  file_id?: string
  size_bytes?: number
  chunks?: number
  bytes_copied?: number
  chunks_copied?: number
  duration_ms?: number
  error?: string
  // throughput_sample fields
  bytes_per_sec?: number
  files_per_sec?: number
  // phase_changed fields
  from?: string
  to?: string
}

/**
 * GET /api/v1/admin/pools/:poolId/lifecycle/runs/:runId/events
 *
 * Returns persisted migration events for history backfill and event replay.
 * Supports cursor-based pagination via `since_id` (exclusive lower bound on
 * the event id column). Ordered by id ASC.
 *
 * NOTE: This endpoint is implemented in server task 0033 Phase 1. Until that
 * commit lands the endpoint returns 404 — callers must handle that gracefully.
 */
export async function getLifecycleRunEvents(
  poolId: string,
  runId: string,
  sinceId?: number,
  limit = 1000,
): Promise<{ events: LifecycleRunEvent[]; has_more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (sinceId !== undefined) params.set('since_id', String(sinceId))
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/events?${params}`,
  )
}

/** GET /api/v1/admin/pools/:poolId/insights */
export async function getPoolInsights(poolId: string): Promise<PoolInsights> {
  return request<PoolInsights>(`/api/v1/admin/pools/${poolId}/insights`)
}

/** POST /api/v1/admin/pools/:poolId/lifecycle/runs
 *
 *  Transitions pool active → quiescing and creates the run record. */
export async function startLifecycleRun(
  poolId: string,
  targetPoolId: string,
): Promise<{ run: LifecycleRun; pool_lifecycle_phase: LifecyclePhase }> {
  return request(`/api/v1/admin/pools/${poolId}/lifecycle/runs`, {
    method: 'POST',
    body: JSON.stringify({ target_pool_id: targetPoolId }),
  })
}

/** GET /api/v1/admin/pools/:poolId/lifecycle/runs/:runId
 *
 *  Returns the run with live progress counters. Poll this every 5 s during
 *  the migrating phase. */
export async function getLifecycleRun(
  poolId: string,
  runId: string,
): Promise<RunProgress> {
  return request<RunProgress>(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}`,
  )
}

/** GET /api/v1/admin/pools/:poolId/lifecycle/runs
 *
 *  Full history for this pool (capped at 100 rows, newest first). */
export async function listLifecycleRuns(
  poolId: string,
): Promise<{ runs: LifecycleRun[] }> {
  return request(`/api/v1/admin/pools/${poolId}/lifecycle/runs`)
}

/** POST …/advance — quiescing → migrating.
 *
 *  `expectedPhase` is an optimistic-concurrency check: the server rejects
 *  with 409 if the pool has moved on since the client last polled. */
export async function advanceLifecycleRun(
  poolId: string,
  runId: string,
  expectedPhase: LifecyclePhase,
): Promise<{ current_phase: LifecyclePhase }> {
  return request(`/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/advance`, {
    method: 'POST',
    body: JSON.stringify({ expected_phase: expectedPhase }),
  })
}

/** POST …/abort — quiescing → active (full abort) OR migrating → quiescing (pause).
 *
 *  When `reverseOrphanedWrites` is true (only meaningful for quiescing abort),
 *  the server seeds reverse migration rows so files written to the target
 *  during the quiescing window are moved back to the source. */
export async function abortLifecycleRun(
  poolId: string,
  runId: string,
  expectedPhase: LifecyclePhase,
  reverseOrphanedWrites: boolean,
): Promise<{
  current_phase: LifecyclePhase
  outcome: LifecycleOutcome
  orphaned_writes_count: number
  cancelled_migrations_count: number
}> {
  return request(`/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/abort`, {
    method: 'POST',
    body: JSON.stringify({
      expected_phase: expectedPhase,
      reverse_orphaned_writes: reverseOrphanedWrites,
    }),
  })
}

/** POST …/reverse-migrate — drained → migrating (target → source direction). */
export async function reverseMigrateRun(
  poolId: string,
  runId: string,
): Promise<{ current_phase: LifecyclePhase }> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/reverse-migrate`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** POST …/archive — drained (outcome=in_progress) → drained (outcome=archived).
 *
 *  The pool remains empty and accepts no new writes, but the row is kept for
 *  audit purposes. `reactivateRun` can undo this. */
export async function archiveRun(
  poolId: string,
  runId: string,
): Promise<{ current_phase: LifecyclePhase; outcome: LifecycleOutcome }> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/archive`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** POST …/reactivate — drained (outcome=archived) → active.
 *
 *  Clears the run binding and brings the pool back into the write rotation. */
export async function reactivateRun(
  poolId: string,
  runId: string,
): Promise<{ current_phase: LifecyclePhase }> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/reactivate`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** POST …/delete-pool — terminal: tombstones the pool row (phase=deleted).
 *
 *  `confirmationName` must exactly match `storage_pools.name`.
 *  After this call the pool is gone from write routing; the row stays for FK
 *  integrity. */
export async function deletePool(
  poolId: string,
  runId: string,
  confirmationName: string,
): Promise<{
  current_phase: LifecyclePhase
  pool_name: string
  deletion_outcome: string
}> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/delete-pool`,
    {
      method: 'POST',
      body: JSON.stringify({
        expected_phase: 'drained' as LifecyclePhase,
        confirmation_pool_name: confirmationName,
      }),
    },
  )
}

/** POST …/force-drain — escape hatch: hard-deletes stuck files so migration
 *  can complete.
 *
 *  `confirmationName` must match `storage_pools.name`.
 *  `fileIds` must be UUIDs of files currently on the source pool.
 *  Files are deleted permanently — no recovery path. */
export async function forceDrainRun(
  poolId: string,
  runId: string,
  confirmationName: string,
  fileIds: string[],
): Promise<{ files_deleted: number; advanced_to_drained: boolean }> {
  return request(
    `/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/force-drain`,
    {
      method: 'POST',
      body: JSON.stringify({
        expected_phase: 'migrating' as LifecyclePhase,
        confirmation_pool_name: confirmationName,
        file_ids: fileIds,
      }),
    },
  )
}

// ─── Google Drive import proxy ────────────────────────────────────────────────

/** Exchange a Google OAuth code for tokens via our server proxy. */
export async function googleTokenExchange(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string; email?: string }> {
  return request('/api/v1/import/google/token-exchange', {
    method: 'POST',
    body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
  })
}

/** Refresh a Google access token via our server proxy. */
export async function googleTokenRefresh(
  refreshToken: string,
): Promise<{ access_token: string }> {
  return request('/api/v1/import/google/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

// ─── Onboarding state (spec 024) ─────────────────────────────────────────────

export interface OnboardingState {
  /** User has verified their recovery phrase. */
  phrase_verified: boolean
  /** Server has a welcome file record (onboarding step 6 complete). */
  welcome_file_exists: boolean
  /** User has uploaded at least one non-welcome file. */
  first_upload_done: boolean
  /** User has created at least one active share link. */
  first_share_done: boolean
}

/** GET /api/v1/account/onboarding-state */
export async function getOnboardingState(): Promise<OnboardingState> {
  return request<OnboardingState>('/api/v1/account/onboarding-state')
}

/** POST /api/v1/account/onboarding/mark-welcome-file — registers the welcome file ID */
export async function markWelcomeFile(fileId: string): Promise<void> {
  await request<void>('/api/v1/account/onboarding/mark-welcome-file', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  })
}

/**
 * POST /dev/reset-onboarding — dev/test only.
 * Resets a user's onboarding state server-side for Playwright re-runs.
 */
export async function devResetOnboarding(email: string): Promise<void> {
  await request<void>('/dev/reset-onboarding', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

// ─── GDPR activity tracking (task 0020) ──────────────────────────────────────

/** User's current tracking opt-in state. */
export interface TrackingPreference {
  tracking_opted_in: boolean
  opted_in_at: string | null
  opted_out_at: string | null
}

/** GET /api/v1/me/tracking */
export async function getTrackingPreference(): Promise<TrackingPreference> {
  return request<TrackingPreference>('/api/v1/me/tracking')
}

/** PUT /api/v1/me/tracking — { opted_in: boolean } */
export async function setTrackingPreference(optedIn: boolean): Promise<TrackingPreference> {
  return request<TrackingPreference>('/api/v1/me/tracking', {
    method: 'PUT',
    body: JSON.stringify({ opted_in: optedIn }),
  })
}

/** One sign-in record returned to the user themselves. */
export interface MySignIn {
  at: string
  ip_anonymized: string | null
  user_agent: string | null
  country_code: string | null
  success: boolean
}

export interface MySignInsResponse {
  opted_in: boolean
  sign_ins: MySignIn[]
}

/** GET /api/v1/me/sign-ins — recent sign-ins for the authenticated user (GDPR opt-in). */
export async function getMySignIns(): Promise<MySignInsResponse> {
  return request<MySignInsResponse>('/api/v1/me/sign-ins')
}

/** One sign-in record (admin view, GDPR opt-in). */
export interface AdminSignIn {
  id: string
  at: string
  /** Anonymized per data minimization — last octet zeroed for IPv4. */
  ip_anonymized: string | null
  /** Parsed UA string, e.g. "Chrome 124 on macOS". */
  device: string | null
  country_code: string | null
  success: boolean
}

export interface AdminSignInsResponse {
  opted_in: boolean
  sign_ins: AdminSignIn[]
}

/** GET /api/v1/admin/users/:id/sign-ins */
export async function getAdminUserSignIns(userId: string): Promise<AdminSignInsResponse> {
  return request<AdminSignInsResponse>(`/api/v1/admin/users/${userId}/sign-ins`)
}

/** One GDPR activity event (admin view). */
export interface AdminActivityEvent {
  id: string
  at: string
  event_type: 'file_uploaded' | 'file_deleted' | 'file_downloaded' | 'share_created' | 'share_revoked' | 'folder_created' | string
  description: string
}

export interface AdminActivityResponse {
  opted_in: boolean
  events: AdminActivityEvent[]
}

/** GET /api/v1/admin/users/:id/activity */
export async function getAdminUserGdprActivity(userId: string): Promise<AdminActivityResponse> {
  return request<AdminActivityResponse>(`/api/v1/admin/users/${userId}/activity`)
}

export interface MyActivityResponse {
  opted_in: boolean
  events: ActivityEvent[]
}

/** GET /api/v1/me/activity — file activity events for the authenticated user (GDPR opt-in). */
export async function getMyActivity(opts?: {
  limit?: number
  offset?: number
  type?: string
}): Promise<MyActivityResponse> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  if (opts?.type) params.set('type', opts.type)
  const qs = params.toString()
  return request<MyActivityResponse>(`/api/v1/me/activity${qs ? `?${qs}` : ''}`)
}

// ─── Push notification preferences (task: notifications UI) ──────────────────

export interface NotificationPreferences {
  share_received: boolean
  storage_warning: boolean
  new_device_login: boolean
  backup_complete: boolean
}

/** GET /api/v1/notifications/preferences */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await request<{ preferences: NotificationPreferences }>('/api/v1/notifications/preferences')
  return res.preferences
}

/** PUT /api/v1/notifications/preferences */
export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const res = await request<{ preferences: NotificationPreferences }>('/api/v1/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  })
  return res.preferences
}

// ─── DSAR / privacy tools (spec 025) ─────────────────────────────────────────

export interface DataExportRequest {
  export_id: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | string
  estimated_seconds?: number
}

export interface DataExportStatus {
  export_id: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | string
  file_count?: number
  total_bytes?: number
  download_url?: string
  expires_at?: string
}

/** POST /api/v1/me/data-export — request a new data export */
export async function requestDataExport(confirmToken?: string): Promise<DataExportRequest> {
  return request<DataExportRequest>('/api/v1/me/data-export', {
    method: 'POST',
    headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
  })
}

/** GET /api/v1/me/data-export/:id — poll export status */
export async function getDataExportStatus(exportId: string): Promise<DataExportStatus> {
  return request<DataExportStatus>(`/api/v1/me/data-export/${exportId}`)
}

/** POST /api/v1/me/freeze — suspend all processing */
export async function freezeAccount(): Promise<{ frozen: boolean }> {
  return request<{ frozen: boolean }>('/api/v1/me/freeze', { method: 'POST' })
}

/** POST /api/v1/me/unfreeze — re-enable processing */
export async function unfreezeAccount(): Promise<{ frozen: boolean }> {
  return request<{ frozen: boolean }>('/api/v1/me/unfreeze', { method: 'POST' })
}

// ─── Data residency (task 0051) ───────────────────────────────────────────────

export interface AvailableRegion {
  continent: string
  display_name: string
  city: string
  provider: string
  is_default: boolean
}

export interface RegionsResponse {
  regions: AvailableRegion[]
}

export interface UserRegionResponse {
  preferred_region: string | null
  regions: AvailableRegion[]
}

/** GET /api/v1/regions — list all available storage regions */
export async function getAvailableRegions(): Promise<RegionsResponse> {
  return request<RegionsResponse>('/api/v1/regions')
}

/** GET /api/v1/me/region — current user's preferred region + available list */
export async function getUserRegion(): Promise<UserRegionResponse> {
  return request<UserRegionResponse>('/api/v1/me/region')
}

/** PUT /api/v1/me/region — set preferred region */
export async function setUserRegion(continent: string): Promise<{ preferred_region: string }> {
  return request<{ preferred_region: string }>('/api/v1/me/region', {
    method: 'PUT',
    body: JSON.stringify({ continent }),
  })
}
