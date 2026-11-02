import { ApiError, request } from '@beebeeb/shared'
import type { DriveFile } from '@beebeeb/shared'

// (moved to ./api-billing)
// (moved to ./api-storage-addons)
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
  folderKeyId: string,
  /** Contract 2237 §1: `l7` exactly when `keys` are L7 wraps; absent for legacy. */
  format?: 'l7',
): Promise<void> {
  await request(`/api/v1/shares/invites/${inviteId}/folder-keys`, {
    method: 'POST',
    body: JSON.stringify(format ? { keys, folder_key_id: folderKeyId, format } : { keys, folder_key_id: folderKeyId }),
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
