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

function itemNetBytes(item: QuotaCheckItem): number {
  return item.sizeBytes - (item.replacedSizeBytes ?? 0)
}

/**
 * Net additional bytes a batch of uploads would add to quota usage, after
 * crediting back the size of any replaced files. A raw signed sum across
 * the whole batch -- kept for display math (the "this upload needs N more"
 * toast) and as the low-level per-item building block. NOT what the actual
 * accept/reject decision should use for a multi-item batch -- see
 * `requiredQuotaBytes` below (task 1544 finding 2b).
 */
export function netQuotaDeltaBytes(items: QuotaCheckItem[]): number {
  return items.reduce((sum, item) => sum + itemNetBytes(item), 0)
}

/**
 * Bytes a batch would actually ADD to usage if every item in it is queued,
 * for the purpose of the accept/reject decision (task 1544 finding 2b).
 *
 * Each item's own net cost is clamped to >= 0 BEFORE summing across items.
 * `netQuotaDeltaBytes` above sums raw (possibly negative) deltas, which lets
 * a shrinking replacement's freed bytes silently fund a DIFFERENT file's
 * upload in the same batch -- but drive.tsx's queueResolvedUploads calls
 * doEncryptedUpload once per item, independently and immediately; nothing
 * waits for the shrink to actually land (the old file to actually be
 * replaced) before the other upload starts. A replacement's credit must
 * only ever reduce ITS OWN requirement, never a sibling's.
 */
export function requiredQuotaBytes(items: QuotaCheckItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, itemNetBytes(item)), 0)
}

/**
 * Returns true when uploading `items` would exceed `remaining` quota bytes.
 * `remaining === null` means usage data isn't available yet -- never block
 * on missing data (matches the pre-existing behavior of the inline check
 * this replaces).
 */
export function exceedsQuota(items: QuotaCheckItem[], remaining: number | null): boolean {
  if (remaining === null) return false
  return requiredQuotaBytes(items) > remaining
}

/**
 * Tracks bytes reserved by uploads that have been QUEUED (accepted by
 * `wouldExceed` and handed to doEncryptedUpload) but not yet reflected in
 * the server-reported `storageUsage` (task 1544 finding 2a).
 *
 * queueResolvedUploads' quota check runs against `storageUsage`, which is
 * React state that only updates after a fetch/refresh completes -- a real
 * network round trip. The duplicate-warning banner's "Upload anyway" path
 * calls queueResolvedUploads TWICE in quick succession for one selection
 * (once directly for the confirmed-duplicate file, once for the rest via
 * handleFilesSelected) -- both calls can run, and both would pass their
 * OWN check, against the exact same stale storageUsage snapshot, together
 * exceeding the real remaining quota. A reservation persists across those
 * calls until the upload it belongs to settles (success or failure), so a
 * later call's check sees the earlier call's still-in-flight bytes.
 *
 * One instance lives for the lifetime of the drive page (a `useRef`) -- it
 * is deliberately a plain class, not React state, so reserving/releasing
 * never triggers a re-render on its own.
 */
export class UploadQuotaLedger {
  private reserved = new Map<string, number>()

  /** Total bytes currently reserved by not-yet-settled uploads. */
  get reservedBytes(): number {
    let total = 0
    for (const bytes of this.reserved.values()) total += bytes
    return total
  }

  /**
   * Would queuing `items` exceed quota, given `remaining` bytes AND
   * whatever this ledger already has reserved for still-in-flight uploads
   * from an earlier call? `remaining === null` never blocks (matches
   * `exceedsQuota`).
   */
  wouldExceed(items: QuotaCheckItem[], remaining: number | null): boolean {
    if (remaining === null) return false
    return requiredQuotaBytes(items) > remaining - this.reservedBytes
  }

  /**
   * Reserve the bytes a just-accepted item will add, keyed by its upload
   * id -- `release()` must be called with the SAME id once that specific
   * upload settles. Clamped to >= 0, same as `requiredQuotaBytes`: a
   * shrinking replacement reserves nothing (it is not allowed to free
   * budget for anything else before it actually completes).
   */
  reserve(uploadId: string, item: QuotaCheckItem): void {
    this.reserved.set(uploadId, Math.max(0, itemNetBytes(item)))
  }

  /**
   * Release a reservation once its upload settles -- success (the next
   * storageUsage refresh will reflect it for real) OR failure (nothing
   * changed server-side, so the reservation must not linger and
   * permanently overcount). No-op if `uploadId` was never reserved.
   */
  release(uploadId: string): void {
    this.reserved.delete(uploadId)
  }
}
