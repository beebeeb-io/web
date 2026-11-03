// ─── API: Vault key escrow ───
// SECTION_MARKER_END
import { API_URL } from './api'
import type { AcceptInviteResponse, AccountActivity, AccountSession, ActivityResponse, FileVersion, HealthResponse, InviteInfo, InvitePreview, Notification, SecurityScore, Session, VersionSetting, Workspace, WorkspaceMembersResponse } from './api'
import { request, ApiError, getApiUrl, getToken, readErrorResponse, setToken } from '@beebeeb/shared'

// ─── Vault key escrow (passkey vault unlock) ──────

/**
 * Store an encrypted vault key blob on the server, keyed by passkey credential ID.
 * The blob is AES-256-GCM ciphertext — the server cannot decrypt it.
 */
export async function storeVaultKeyEscrow(
  credentialId: string,
  encryptedVaultKey: string,
): Promise<void> {
  await request<void>('/api/v1/auth/vault-key-escrow', {
    method: 'POST',
    body: JSON.stringify({
      credential_id: credentialId,
      encrypted_vault_key: encryptedVaultKey,
    }),
  })
}

/**
 * Retrieve the encrypted vault key blob for a given credential ID.
 * Returns the base64-encoded encrypted blob, or null if no escrow exists.
 */
export async function getVaultKeyEscrow(
  credentialId: string,
): Promise<string | null> {
  try {
    const data = await request<{ encrypted_vault_key: string }>(
      `/api/v1/auth/vault-key-escrow/${encodeURIComponent(credentialId)}`,
    )
    return data.encrypted_vault_key
  } catch (err) {
    // 404 = no escrow for this credential — not an error
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
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
    const { body, fallbackMessage } = await readErrorResponse(res)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
    )
  }
  return res.json() as Promise<InvitePreview>
}

/**
 * One row of the version list. `is_current` / `deletable` / `source` are the
 * server's task-1809 flags (absent on an older server; the UI falls back to
 * "not the current version", see `canDeleteVersion`).
 */
export interface VersionListItem extends FileVersion {
  is_current?: boolean
  deletable?: boolean
  source?: 'object_version' | 'file_version'
}

export interface VersionList {
  file_id: string
  current_version: number
  /** True while the account has no plan: only then do kept versions count against its storage. */
  versions_count_toward_quota?: boolean
  versions: VersionListItem[]
}

export async function listVersions(fileId: string): Promise<VersionList> {
  return request(`/api/v1/files/${fileId}/versions`)
}

export async function downloadVersion(fileId: string, versionId: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`, {
    headers,
    // task 0447 — authenticated version download; ship the cookie.
    credentials: 'include',
  })
  if (!res.ok) throw new ApiError('download failed', res.status)
  return res.blob()
}

export async function restoreVersion(fileId: string, versionId: string): Promise<{ message: string; version_number: number }> {
  return request(`/api/v1/files/${fileId}/versions/${versionId}/restore`, { method: 'POST' })
}

/**
 * Delete one kept version (task 1809). 404 = not yours / already gone, 409
 * `cannot_delete_current_version` = the file's current content (trash the file).
 */
export async function deleteVersion(
  fileId: string,
  versionId: string,
): Promise<{ version_number: number; size_bytes: number; source: 'object_version' | 'file_version' }> {
  return request(`/api/v1/files/${fileId}/versions/${versionId}`, { method: 'DELETE' })
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

export async function listSessions(): Promise<{ sessions: Session[] }> {
  return request('/api/v1/auth/sessions')
}

export async function revokeSession(id: string): Promise<void> {
  await request(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' })
}

/**
 * Token-based impersonation redemption (task 0161). Public endpoint — the
 * single-use 15-minute token in the body is itself the credential. On success
 * stores the returned session token so subsequent requests authenticate as
 * the impersonated user.
 */
export interface ImpersonationRedeemResponse {
  session_token: string
  user_id: string
  is_impersonation: true
  admin_user_id: string
}

export async function redeemImpersonationToken(
  token: string,
): Promise<ImpersonationRedeemResponse> {
  const data = await request<ImpersonationRedeemResponse>(
    '/api/v1/auth/impersonate',
    {
      method: 'POST',
      body: JSON.stringify({ token }),
    },
  )
  if (data.session_token) {
    setToken(data.session_token)
  }
  return data
}

/**
 * Mint a one-time handoff OTP and return the URL the browser should
 * navigate to (admin.beebeeb.io/auth/handoff?token=…). The OTP is
 * single-use and expires in 60 s — see
 * docs/superpowers/specs/2026-05-07-admin-portal-separation.md.
 */
export interface AdminHandoffResponse {
  token: string
  redirect_url: string
  expires_at: string
}
export async function requestAdminHandoff(): Promise<AdminHandoffResponse> {
  return request<AdminHandoffResponse>('/api/v1/auth/admin-handoff', {
    method: 'POST',
  })
}

// ── Client devices & sessions ─────────────────────────

export interface ClientDevice {
  id: string
  hostname: string
  platform: string
  bb_version: string | null
  last_seen: string
  created_at: string
  session_count: number
  /** null = no push token linked to this device; true/false = the linked token's mute state */
  notifications_enabled?: boolean | null
}

export interface ClientSession {
  id: string
  name: string
  session_type: string
  local_path: string | null
  remote_path: string
  status: string
  device_hostname: string
  device_platform: string
  device_id: string
  heartbeat_interval_secs: number
  alert_after_missed: number
  last_heartbeat: string | null
  files_synced: number | null
  files_total: number | null
  bytes_synced: number | null
  bytes_total: number | null
  heartbeat_status: string | null
  current_file: string | null
  speed_bps: number | null
  created_at: string
}

export async function listClientDevices(): Promise<{ devices: ClientDevice[] }> {
  return request<{ devices: ClientDevice[] }>('/api/v1/clients/devices')
}

export async function listClientSessions(): Promise<{ sessions: ClientSession[] }> {
  return request<{ sessions: ClientSession[] }>('/api/v1/clients/sessions')
}

export async function deleteClientSession(id: string): Promise<void> {
  await request<void>(`/api/v1/clients/sessions/${id}`, { method: 'DELETE' })
}

export async function deleteClientDevice(id: string): Promise<void> {
  await request<void>(`/api/v1/clients/devices/${id}`, { method: 'DELETE' })
}

/** PATCH /api/v1/clients/devices/{id}/notifications — mute or unmute push for a device */
export async function setDeviceNotifications(deviceId: string, enabled: boolean): Promise<void> {
  await request<void>(`/api/v1/clients/devices/${deviceId}/notifications`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`)
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.json() as Promise<HealthResponse>
}
