/**
 * Task 1816 round 2 (Codex P2) — the cached account-stage onboarding document
 * and whether the gate may trust it. Pure transitions so the invariants are
 * testable without rendering the provider.
 *
 * `refreshPlanDetails` (billing_updated / subscription.changed / plan-changed)
 * must INVALIDATE the cached document: clear it and mark it unsettled until the
 * new answer (or the 8 s safety net) lands. Otherwise a stalled `/onboarding`
 * request leaves the stale document winning over the fresher subscription, so a
 * lapsed account keeps an `ok` gate and no banner.
 */
import type { OnboardingDocument } from './onboarding/types'

export interface AccountDocSlice {
  doc: OnboardingDocument | null
  /** The gate may decide: an answer (document or none) has landed, or the safety net fired. */
  settled: boolean
  /** Monotonic request id; a response for an older id is dropped. */
  seq: number
}

export function initialAccountDoc(flagOn: boolean): AccountDocSlice {
  return { doc: null, settled: !flagOn, seq: 0 }
}

/** A refresh starts (or the account changed): drop the cached document, mark unsettled. */
export function invalidateAccountDoc(prev: AccountDocSlice, flagOn: boolean): AccountDocSlice {
  return { doc: null, settled: !flagOn, seq: prev.seq + 1 }
}

/** A document request answered (`doc` null = unavailable -> the legacy state decides). */
export function landAccountDoc(
  prev: AccountDocSlice,
  seq: number,
  doc: OnboardingDocument | null,
): AccountDocSlice {
  if (seq !== prev.seq) return prev // superseded by a newer refresh / invalidation
  return { ...prev, doc, settled: true }
}

/** The 8 s safety net: give up waiting, let the legacy field decide. */
export function settleAccountDoc(prev: AccountDocSlice): AccountDocSlice {
  return prev.settled ? prev : { ...prev, settled: true }
}
