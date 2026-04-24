const API_URL = 'http://localhost:3001'

const TOKEN_KEY = 'bb_session'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
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

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as { message?: string }).message ?? res.statusText,
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

interface AuthResponse {
  token: string
  user: AuthUser
}

export interface AuthUser {
  user_id: string
  email: string
  email_verified: boolean
}

export async function signup(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token)
  return data
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token)
  return data
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/v1/auth/logout', { method: 'POST' })
  } finally {
    clearToken()
  }
}

export async function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/api/v1/auth/me')
}

// ─── Drive / Files endpoints ─────────────────────

export interface DriveFile {
  id: string
  name_encrypted: string
  mime_type: string
  size: number
  is_folder: boolean
  parent_id: string | null
  trashed: boolean
  shared_with: number
  owner: string
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
  return request<DriveFile[]>(`/api/v1/files${qs ? `?${qs}` : ''}`)
}

export async function createFolder(
  nameEncrypted: string,
  parentId?: string,
): Promise<DriveFile> {
  return request<DriveFile>('/api/v1/files/folder', {
    method: 'POST',
    body: JSON.stringify({ name_encrypted: nameEncrypted, parent_id: parentId }),
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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as { message?: string }).message ?? res.statusText,
      res.status,
    )
  }

  return res.json() as Promise<DriveFile>
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

export async function deleteFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}`, { method: 'DELETE' })
}

export async function restoreFile(id: string): Promise<void> {
  await request<void>(`/api/v1/files/${id}/restore`, { method: 'POST' })
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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as { message?: string }).message ?? res.statusText,
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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as { message?: string }).message ?? res.statusText,
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
}): Promise<{ events: AuditEvent[]; count: number }> {
  const qs = new URLSearchParams()
  if (params?.actor) qs.set('actor', params.actor)
  if (params?.event) qs.set('event', params.event)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return request<{ events: AuditEvent[]; count: number }>(
    `/api/v1/admin/audit-log${q ? `?${q}` : ''}`,
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
