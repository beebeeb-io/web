import { request } from '@beebeeb/shared'
import type { CreateFolderLinkRequest, FolderAccessLevel, FolderLink, FolderLinkCreated, SharedFolderActivityResponse, UpdateFolderLinkRequest } from './folder-link-types'

// (moved to ./api-support)
// ─── Shared-folder links (task 2237b) ───────────────────────────────────────
// Thin wrappers only: every decision (key custody, passphrase, copy) lives in
// the link modules, not here.

/** Owner: every live link on a folder they own. */
export async function listFolderLinks(folderId: string): Promise<FolderLink[]> {
  const body = await request<{ links: FolderLink[] }>(
    `/api/v1/shares/folder-links?folder_id=${encodeURIComponent(folderId)}`,
  )
  return body.links
}

export async function createFolderLink(req: CreateFolderLinkRequest): Promise<FolderLinkCreated> {
  return request<FolderLinkCreated>('/api/v1/shares/folder-links', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function updateFolderLink(
  id: string,
  patch: UpdateFolderLinkRequest,
): Promise<FolderLink> {
  return request<FolderLink>(`/api/v1/shares/folder-links/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function revokeFolderLink(id: string): Promise<void> {
  await request<unknown>(`/api/v1/shares/folder-links/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export interface SharedFolderInfo {
  folder_id: string
  role: 'owner' | 'member'
  access_level: FolderAccessLevel
  key_version: number
  owner_wrapped_folder_key: string | null
  wrapped_folder_key: string | null
}

/** Owner or member: custody of the shared folder's key. */
export async function getSharedFolder(folderId: string): Promise<SharedFolderInfo> {
  return request<SharedFolderInfo>(`/api/v1/shared-folders/${encodeURIComponent(folderId)}`)
}

/** Owner: publish the folder key wrapped to the master key. */
export async function registerSharedFolderKey(
  folderId: string,
  body: { owner_wrapped_folder_key: string; key_version: number },
): Promise<{ created: boolean; key_version: number }> {
  return request(`/api/v1/shared-folders/${encodeURIComponent(folderId)}/key`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** Owner or member: the wrapped key of every file in the shared subtree. */
export async function listSharedFolderKeys(
  folderId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ keys: { file_id: string; encrypted_file_key: string }[]; next_cursor: string | null }> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)
  const query = params.toString()
  return request(
    `/api/v1/shared-folders/${encodeURIComponent(folderId)}/keys${query ? `?${query}` : ''}`,
  )
}

/**
 * Owner-only insert of per-file wraps; existing rows remain unchanged. The
 * route serves custody folders only, so its wraps are always L7 and say so
 * (contract 2237 §1).
 */
export async function publishSharedFolderKeys(
  folderId: string,
  keys: { file_id: string; encrypted_file_key: string }[],
): Promise<{ written: number; skipped: number }> {
  return request(`/api/v1/shared-folders/${encodeURIComponent(folderId)}/keys`, {
    method: 'POST', body: JSON.stringify({ keys, format: 'l7' }),
  })
}

/** Owner: adopt a file a guest added, by wrapping its key to the master key. */
export async function adoptOwnerFileKey(
  fileId: string,
  ownerWrappedFileKey: string,
): Promise<{ adopted: boolean }> {
  return request(`/api/v1/files/${encodeURIComponent(fileId)}/owner-key`, {
    method: 'POST',
    body: JSON.stringify({ owner_wrapped_file_key: ownerWrappedFileKey }),
  })
}

export async function getSharedFolderActivity(
  folderId: string,
  limit?: number,
): Promise<SharedFolderActivityResponse> {
  const query = limit === undefined ? '' : `?limit=${limit}`
  return request(`/api/v1/shared-folders/${encodeURIComponent(folderId)}/activity${query}`)
}
