/**
 * upload-quota.ts
 *
 * Client-side pre-upload quota check. Mirrors the server's replace-credit
 * logic (repos/server/beebeeb-api/src/routes/uploads.rs, ~line 495-513):
 *
 *   let projected_used = uq.used_bytes
 *     .saturating_sub(replace_prior_size)
 *     .saturating_add(file_size_bytes);
 *   if uq.quota_bytes > 0 && projected_used > uq.quota_bytes { QuotaExceeded }
 *
 * A file being uploaded as a version-replace (auto-version, or an explicit
 * "Replace" from the conflict dialog) has the EXISTING file's size credited
 * back before comparing to the plan limit -- a same-size-or-smaller version
 * replace at 0 remaining quota is allowed, exactly as the server allows it.
 *
 * Before this module existed, drive.tsx's quota pre-check ran BEFORE
 * conflict/auto-version resolution and compared the raw selected-file size
 * to `remaining`, with no credit -- silently blocking a normal "save a new
 * version of my file" upload for any user at/near their quota, with a
 * "Not enough storage" toast the server would not have produced.
 * (Task 1544 finding 1.)
 */

export interface QuotaCheckItem {
  /** Size in bytes of the file about to be uploaded. */
  sizeBytes: number
  /** Size in bytes of the EXISTING file this upload will replace (auto-version
   *  or explicit "Replace"), if any. Leave undefined for a brand-new file or
   *  a "Keep both" upload -- those get no credit, matching the server (a
   *  "Keep both" upload creates a new file; it does not free the old one). */
  replacedSizeBytes?: number
}

/**
 * Net additional bytes a batch of uploads would add to quota usage, after
 * crediting back the size of any replaced files.
 */
export function netQuotaDeltaBytes(items: QuotaCheckItem[]): number {
  return items.reduce((sum, item) => sum + item.sizeBytes - (item.replacedSizeBytes ?? 0), 0)
}

/**
 * Returns true when uploading `items` would exceed `remaining` quota bytes.
 * `remaining === null` means usage data isn't available yet -- never block
 * on missing data (matches the pre-existing behavior of the inline check
 * this replaces).
 */
export function exceedsQuota(items: QuotaCheckItem[], remaining: number | null): boolean {
  if (remaining === null) return false
  return netQuotaDeltaBytes(items) > remaining
}
