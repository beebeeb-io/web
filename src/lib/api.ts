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

let notifyError: ErrorNotifier | null = null
let onSessionExpired: SessionExpiredHandler | null = null

/** Register a callback to show a toast when the API is unreachable. */
export function registerErrorNotifier(fn: ErrorNotifier): void {
  notifyError = fn
}

/** Register a callback to handle 401 (token expired) globally. */
export function registerSessionExpiredHandler(fn: SessionExpiredHandler): void {
  onSessionExpired = fn
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

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    })
  } catch (_err) {
    const message = 'Could not reach the server. Check your connection and try again.'
    notifyError?.(message)
    throw new ApiError(message, 0)
  }

  if (res.status === 401 && path === '/api/v1/auth/me') {
    clearToken()
    onSessionExpired?.()
    throw new ApiError('Session expired', 401)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
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
): Promise<{ server_message: string }> {
  return request('/api/v1/opaque/register-start', {
    method: 'POST',
    body: JSON.stringify({ email, client_message: clientMessage }),
  })
}

export async function opaqueRegisterFinish(
  email: string,
  clientMessage: string,
  x25519PublicKey?: string,
  recoveryCheck?: string,
): Promise<{ user_id: string; session_token: string }> {
  const data = await request<{ user_id: string; session_token: string }>('/api/v1/opaque/register-finish', {
    method: 'POST',
    body: JSON.stringify({
      email,
      client_message: clientMessage,
      x25519_public_key: x25519PublicKey,
      recovery_check: recoveryCheck,
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

export async function verifyEmail(
  code: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
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
  mime_type: string
  size_bytes: number
  is_folder: boolean
  parent_id: string | null
  chunk_count: number
  is_starred?: boolean
  created_at: string
  updated_at: string
}

export async function listFiles(
  parentId?: string,
  trashed?: boolean,
): Promise<DriveFile[]> {
  const params = new URLSearchParams()
  if (parentId) params.set('parent_id', parentId)
  if (trashed !== undefined) params.set('trashed', String(trashed))
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

export async function uploadFile(
  file: File,
  parentId?: string,
): Promise<DriveFile> {
  const token = getToken()
  const metadata = JSON.stringify({
    name_encrypted: file.name,
    mime_type: file.type || 'application/octet-stream',
    size: file.size,
    parent_id: parentId ?? null,
  })

  const form = new FormData()
  form.append('metadata', new Blob([metadata], { type: 'application/json' }))
  form.append('chunk_0', file)

  const res = await fetch(`${API_URL}/api/v1/files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<DriveFile>
}

// ─── Chunked upload endpoints ────────────────────

export async function initUpload(metadata: {
  file_id?: string
  name_encrypted: string
  mime_type: string
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
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
  updates: { parent_id?: string; name_encrypted?: string },
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

export async function permanentDeleteFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}/permanent`, { method: 'DELETE' })
}

export async function toggleStar(
  id: string,
): Promise<{ id: string; is_starred: boolean }> {
  return request<{ id: string; is_starred: boolean }>(
    `/api/v1/files/${id}/star`,
    { method: 'PATCH' },
  )
}

// ─── Password / Account endpoints ───────────────

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string; salt: string; session_token: string }> {
  const data = await request<{
    message: string
    salt: string
    session_token: string
  }>('/api/v1/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
  setToken(data.session_token)
  return data
}

export async function deleteAccountPermanently(
  confirmation: string,
): Promise<{ message: string; shred_after: string }> {
  const data = await request<{ message: string; shred_after: string }>(
    '/api/v1/auth/account',
    {
      method: 'DELETE',
      body: JSON.stringify({ confirmation }),
    },
  )
  clearToken()
  return data
}

// ─── Share endpoints ────────────────────────────

export interface ShareOptions {
  expires_in_hours?: number | null
  max_opens?: number | null
  passphrase?: string
  can_download?: boolean
}

export interface ShareInfo {
  id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  can_download: boolean
  has_passphrase: boolean
  created_at: string
}

export interface ShareView {
  id: string
  name_encrypted?: string
  size_bytes?: number
  mime_type?: string
  shared_by?: string
  can_download?: boolean
  expires_at?: string | null
  max_opens?: number | null
  open_count?: number
  created_at?: string
  requires_passphrase?: boolean
  error?: string
  message?: string
}

export interface MyShare {
  id: string
  file_id: string
  token: string
  url: string
  expires_at: string | null
  max_opens: number | null
  open_count: number
  can_download: boolean
  has_passphrase: boolean
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }

  return res.json() as Promise<ShareView>
}

export async function downloadSharedFile(token: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/v1/shares/${token}/download`)
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

export async function listMyShares(): Promise<MyShare[]> {
  const data = await request<{ shares: MyShare[] }>('/api/v1/shares/mine')
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
  can_download?: boolean
  can_reshare?: boolean
  expires_at?: string | null
  size_bytes?: number
  is_folder?: boolean
  encrypted_file_key?: string
}

export async function createInvite(
  fileId: string,
  recipientEmail: string,
): Promise<{ invite_id: string; status: string; recipient_public_key?: string | null }> {
  return request('/api/v1/shares/invites', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId, recipient_email: recipientEmail }),
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
  updates: { can_download?: boolean; can_reshare?: boolean; expires_at?: string },
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

// ─── Billing endpoints ─────────────────────────

export interface Plan {
  id: string
  name: string
  price_eur: number
  price_yearly_eur: number
  storage_bytes: number
  storage_label: string
  per_seat: boolean
  min_seats: number
  features: string[]
}

export interface Subscription {
  plan: string
  billing_cycle: string
  seats: number
  region: string
  status: string
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
  region: string
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
  region: string
}): Promise<{ url: string }> {
  return request<{ url: string }>('/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function createPortalSession(): Promise<{ url: string }> {
  return request<{ url: string }>('/api/v1/billing/portal', {
    method: 'POST',
  })
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

// ─── Admin storage pool endpoints ────────────────

export interface StoragePool {
  id: string
  name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  display_name: string
  is_default: boolean
  is_active: boolean
  capacity_bytes: number | null
  used_bytes: number
  usage_pct: number | null
  created_at: string
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

// ─── Shared with me endpoints ────────────────────

export interface SharedWithMeItem {
  file_id?: string
  file_name_encrypted: string
  file_size: number
  from_email: string
  sender_public_key?: string
  access_level: string
  expires: string | null
  created_at: string
  is_folder: boolean
}

export async function listSharedWithMe(): Promise<SharedWithMeItem[]> {
  const data = await request<{ items: SharedWithMeItem[] }>('/api/v1/shared-with-me')
  return data.items
}

// ─── Passkey endpoints ──────────────────────────

export interface PasskeyInfo {
  id: string
  name: string
  created_at: string
}

export async function startPasskeyRegistration(): Promise<{
  publicKey: PublicKeyCredentialCreationOptions
  reg_state: string
}> {
  return request('/api/v1/auth/passkey/register-start', {
    method: 'POST',
  })
}

export async function finishPasskeyRegistration(
  credential: unknown,
  regState: string,
  name?: string,
): Promise<PasskeyInfo> {
  return request<PasskeyInfo>('/api/v1/auth/passkey/register-finish', {
    method: 'POST',
    body: JSON.stringify({ credential, reg_state: regState, name }),
  })
}

export async function startPasskeyLogin(email: string): Promise<{
  publicKey: PublicKeyCredentialRequestOptions
  auth_state: string
  user_id: string
}> {
  return request('/api/v1/auth/passkey/login-start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function finishPasskeyLogin(
  credential: unknown,
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<InvitePreview>
}
