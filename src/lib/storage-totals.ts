/**
 * Task 1706 storage-total authority + allocation breakdown (review round 2,
 * Codex PR #132 findings #132-A / #132-B). Pure decision logic so the billing
 * page's two readouts (quota meter, "Current total" slider readout) and the
 * parenthetical allocation breakdown share ONE tested implementation.
 *
 * Field honesty note (#132-B): NO web payload exposes a bonus-specific field
 * — `StorageUsage` (/files/usage: used_bytes, plan_limit_bytes, plan_name),
 * `BillingUsage` (/billing/usage: used_bytes, quota_bytes, percentage) and
 * `StorageAddonState` (/billing/addons) all carry none, and the
 * subscription payload has no bonus field either. A "bonus storage" label
 * would therefore be an ungrounded claim; the breakdown renders the neutral
 * "additional storage" term for any positive unexplained remainder instead.
 */

/** Sub-GB rounding noise the SI formatting cannot render anyway — a
 * discrepancy at or below this is treated as "fully explained". */
export const ALLOCATION_TOLERANCE_BYTES = 500_000_000

function isPositiveFinite(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * The quota meter's total (task 1706 hierarchy + the #132-A transient
 * override). Hierarchy with the override OFF — reproduced EXACTLY from the
 * pre-review billing.tsx logic, no tb synthesis reintroduced:
 *   context `/files/usage` server truth → `addonState.effective_storage_bytes`
 *   (raw, 0 included — the caller's outer valid&&>0 guard owns the meta
 *   fallback) → static meta fallback.
 * `preferAddonBytes` (#132-A) promotes the add-on payload's server truth to
 * FIRST while the context usage is known-stale (the post-apply usage refresh
 * failed); the raw-path asymmetry is deliberate — it mirrors the un-overridden
 * branch so the caller's existing guard semantics stay intact.
 */
export function resolveMeterTotalBytes(
  contextPlanLimitBytes: number | null | undefined,
  addonEffectiveBytes: number | undefined,
  preferAddonBytes: boolean,
  metaFallbackBytes: number,
): number {
  if (preferAddonBytes && addonEffectiveBytes !== undefined) return addonEffectiveBytes
  if (isPositiveFinite(contextPlanLimitBytes)) return contextPlanLimitBytes as number
  if (addonEffectiveBytes !== undefined) return addonEffectiveBytes
  return metaFallbackBytes
}

/**
 * The storage slider's "Current total" (same authority question, different
 * fallback chain). With the override OFF: context server truth, else the TB
 * reconstruction `(baseTB + extraTB) × 1e12` — task 1706's demoted-but-kept
 * last resort for this readout, untouched. With the override ON the fresh
 * add-on bytes win ONLY when positive (a 0 effective field is not truth and
 * must not outrank either the context value or the reconstruction).
 */
export function resolveCurrentTotalBytes(
  contextPlanLimitBytes: number | null | undefined,
  addonEffectiveBytes: number | undefined,
  preferAddonBytes: boolean,
  reconstructionBytes: number,
): number {
  if (preferAddonBytes && addonEffectiveBytes !== undefined && addonEffectiveBytes > 0) {
    return addonEffectiveBytes
  }
  if (isPositiveFinite(contextPlanLimitBytes)) return contextPlanLimitBytes as number
  return reconstructionBytes
}

export interface StorageAllocationBreakdown {
  /** Render the parenthetical at all (extra > 0 AND the parts reconcile). */
  show: boolean
  baseBytes: number
  /** null when the extra add-on is 0 TB (parenthetical hidden anyway). */
  extraBytes: number | null
  /** Positive portion of the displayed total the base+extra parts do NOT
   * explain — rendered as the neutral "additional storage" term. null when
   * fully explained. */
  remainderBytes: number | null
  /** base+extra EXCEEDS the displayed total — parts cannot reconcile; the
   * parenthetical must be omitted rather than contradict the total. */
  irreconcilable: boolean
}

/**
 * #132-B — reconcile the displayed "Current total" against the base + extra
 * TB parts the parenthetical names. The original rendering showed the
 * bonus-inclusive server total next to a base+extra-only parenthetical,
 * which contradicts itself whenever any bonus storage exists ("2.2 TB
 * (1 TB base + 1 TB extra)").
 */
export function storageAllocationBreakdown(
  currentTotalBytes: number,
  baseTB: number,
  extraTB: number,
): StorageAllocationBreakdown {
  if (extraTB <= 0 || !Number.isFinite(currentTotalBytes)) {
    return { show: false, baseBytes: 0, extraBytes: null, remainderBytes: null, irreconcilable: true }
  }
  const baseBytes = Math.max(0, baseTB) * 1_000_000_000_000
  const extra = Math.max(0, extraTB) * 1_000_000_000_000
  const remainder = currentTotalBytes - (baseBytes + extra)
  if (Math.abs(remainder) <= ALLOCATION_TOLERANCE_BYTES) {
    return { show: true, baseBytes, extraBytes: extra, remainderBytes: null, irreconcilable: false }
  }
  if (remainder > 0) {
    return { show: true, baseBytes, extraBytes: extra, remainderBytes: remainder, irreconcilable: false }
  }
  return { show: false, baseBytes, extraBytes: extra, remainderBytes: null, irreconcilable: true }
}
