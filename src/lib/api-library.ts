import { ApiError, request } from '@beebeeb/shared'
import type { BillingUsage, DriveFile, Plan, StorageUsage } from '@beebeeb/shared'

export async function getStorageUsage(): Promise<StorageUsage> {
  return request<StorageUsage>('/api/v1/files/usage')
}

/**
 * GET /api/v1/files/all-images
 *
 * Returns every non-trashed file the server knows is an image (mime_type LIKE
 * 'image/%'), across all folders, in a single request. Replaces the recursive
 * walk() pattern in the Photos page (N+1 requests) with a single round-trip.
 *
 * Note: ZK-uploaded files have null mime_type on the server, so they are NOT
 * returned here. The Photos page falls back to the recursive walk for those
 * files after decrypting their metadata from name_encrypted. The endpoint is
 * best-effort: it catches the common case (legacy uploads and Camera Roll
 * backups) while new ZK uploads still appear after decryption.
 */
export async function getAllImages(): Promise<DriveFile[]> {
  const data = await request<{ files: DriveFile[] }>('/api/v1/files/all-images')
  return data.files
}

/**
 * GET /api/v1/files/media
 *
 * Returns every non-trashed file the client flagged as media (is_media=true)
 * at upload time, ordered newest first. Works for fully zero-knowledge uploads
 * where the MIME type is encrypted — the server does not need to decrypt anything.
 *
 * Replaces the /all-images endpoint for the Photos tab. The client sets is_media
 * based on the file's MIME type before encryption so both legacy mime_type-based
 * and new ZK-encrypted uploads appear in the same grid.
 */
export async function getMediaFiles(): Promise<DriveFile[]> {
  const data = await request<{ files: DriveFile[] }>('/api/v1/files/media')
  return data.files
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
