import { ApiError, readErrorResponse, request } from '@beebeeb/shared'
import type { CreateBundleShareRequest, InviteActivity, MyShare, ShareInfo, ShareInvite, ShareOptions, ShareStats, ShareView, SharedFileDownload } from '@beebeeb/shared'
import { API_URL } from './api-session'

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

/**
 * Create a bundle share (task 0417): ONE anonymous public link over an ordered
 * set of files. The caller has already generated K_c client-side and wrapped
 * each item's FileKey under it (see prepareBundleShareItems in crypto.ts) — the
 * server only ever sees the opaque wrapped blobs. Returns the same envelope
 * shape as a single-file share plus `share_type:'bundle'` + `item_count`.
 */
export async function createBundleShare(req: CreateBundleShareRequest): Promise<ShareInfo & { share_type?: string; item_count?: number }> {
  return request('/api/v1/shares', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/**
 * Fetch a share manifest. Bundle-aware: when the share is a bundle the server
 * returns `share_type:'bundle'` + the ordered `items` array (keyset-paginated
 * by `position`) + `next_cursor`. For a single-file share the legacy body is
 * returned unchanged. Pass `page.cursor`/`page.limit` to walk a large bundle.
 */
export async function getShare(
  token: string,
  page?: { cursor?: number | null; limit?: number },
): Promise<ShareView> {
  // Public endpoint — no auth header
  const params = new URLSearchParams()
  if (page?.cursor != null) params.set('cursor', String(page.cursor))
  if (page?.limit != null) params.set('limit', String(page.limit))
  const qs = params.toString()
  const res = await fetch(`${API_URL}/api/v1/shares/${token}${qs ? `?${qs}` : ''}`)

  if (!res.ok) {
    const { body, fallbackMessage } = await readErrorResponse(res)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
    )
  }

  return res.json() as Promise<ShareView>
}

/**
 * Download one item of a bundle share (task 0417). The recipient unwraps the
 * item's FileKey from the manifest (`unwrapBundleItemKey`) and uses it to
 * decrypt the streamed ciphertext. `passphrase` (if the bundle is locked) is
 * sent via the `X-Share-Passphrase` HEADER only — never a query parameter.
 */
export async function downloadBundleItem(
  token: string,
  fileId: string,
  passphrase?: string,
): Promise<SharedFileDownload & { chunkSize: number | null }> {
  const headers: HeadersInit = passphrase
    ? { 'X-Share-Passphrase': passphrase }
    : {}
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/shares/${token}/items/${fileId}/download`, { headers })
  } catch (e) {
    // fetch threw before any response (offline / DNS / reset / CORS) — surface
    // as network-class (status 0) so withNetworkRetry treats it as transient.
    throw new ApiError(e instanceof Error ? e.message : 'Network error', 0)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    const message = ((body?.message ?? body?.error) || res.statusText || 'Download failed') as string
    throw new ApiError(message, res.status)
  }

  const parseHeaderInt = (value: string | null): number | null => {
    if (!value) return null
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const chunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count'))
  const chunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size'))
  const originalSize = parseHeaderInt(res.headers.get('X-Original-Size'))
  const blob = await res.blob()
  return { blob, chunkCount, chunkSize, originalSize }
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
    const { body, fallbackMessage } = await readErrorResponse(res)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
    )
  }

  return res.json() as Promise<ShareView>
}

export async function downloadSharedFile(
  token: string,
  passphrase?: string,
): Promise<SharedFileDownload & { chunkSize: number | null }> {
  const headers: HeadersInit = passphrase
    ? { 'X-Share-Passphrase': passphrase }
    : {}
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/shares/${token}/download`, { headers })
  } catch (e) {
    // fetch threw before any response (offline / DNS / reset / CORS) — surface
    // as network-class (status 0) so withNetworkRetry treats it as transient.
    throw new ApiError(e instanceof Error ? e.message : 'Network error', 0)
  }
  if (!res.ok) {
    // Try to read the server's JSON error body so we surface the real message
    // (e.g. "link has expired", "incorrect passphrase") instead of the opaque
    // HTTP status text, which is empty in HTTP/2.
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    const message = ((body?.message ?? body?.error) || res.statusText || 'Download failed') as string
    throw new ApiError(message, res.status)
  }

  const parseHeaderInt = (value: string | null): number | null => {
    if (!value) return null
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const chunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count'))
  const chunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size'))
  const originalSize = parseHeaderInt(res.headers.get('X-Original-Size'))
  const blob = await res.blob()
  return { blob, chunkCount, chunkSize, originalSize }
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
  // Omit the Range header: it is a non-simple header that triggers a preflight,
  // and the server doesn't support range requests on the share download endpoint
  // anyway. We slice client-side.
  const headers: HeadersInit = passphrase
    ? { 'X-Share-Passphrase': passphrase }
    : {}
  const res = await fetch(`${API_URL}/api/v1/shares/${token}/download`, { headers })
  if (!res.ok) {
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

export interface SharingContact {
  user_id: string
  email: string
  username?: string | null
  display_name?: string | null
  x25519_public_key?: string | null
}

export async function listSharingContacts(): Promise<SharingContact[]> {
  const data = await request<{ contacts: SharingContact[] }>('/api/v1/contacts')
  return data.contacts ?? []
}

export async function resolveSharingContact(query: string): Promise<SharingContact | null> {
  const data = await request<{ contact: SharingContact | null }>(
    `/api/v1/contacts/resolve?query=${encodeURIComponent(query)}`,
  )
  return data.contact ?? null
}

export async function createInvite(
  fileId: string,
  recipientEmail: string,
  folderShare?: {
    is_folder_share: boolean
    encrypted_folder_key: string
    encrypted_owner_folder_key: string
    folder_keys: { file_id: string; encrypted_file_key: string }[]
    /** base64 of core's folder_key_id for the key used (task 2133). */
    folder_key_id: string
    /** Contract 2237 §1: `l7` exactly when `folder_keys` are L7 wraps. */
    format?: 'l7'
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

export async function getShareStats(): Promise<ShareStats> {
  return request<ShareStats>('/api/v1/shares/stats')
}
