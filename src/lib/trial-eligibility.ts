/**
 * Trial-CTA eligibility (task 1517). Extracted out of `billing.tsx` so it is a
 * pure, directly testable function — no React, no closures over component
 * state — mirroring `checkout-reconcile.ts`'s rationale for the same move.
 *
 * Background: every trial CTA in `billing.tsx` (the "Start 14-day trial"
 * buttons AND the Compare-plans table's "Upgrade" buttons, which route
 * through the SAME `handleUpgradeOrTrial`) used to gate only on a local
 * `trialUsed` React state that starts `false` and is set `true` only AFTER a
 * live 409 `trial_already_used` from `POST /billing/trial/start`. An account
 * that had already used its trial in a PAST session therefore always saw the
 * trial CTA first, always attempted `startTrial()`, and always got the 409 —
 * wasting a round trip and (until the `request()` fix alongside this) once
 * surfacing the raw server error body in a toast instead of a clean message.
 *
 * The server has sent the authoritative `has_used_trial` boolean on every
 * `GET /billing/subscription` response since task 0905 (mirrors
 * `users.has_used_trial`) — `resolveHasUsedTrial` combines that server truth
 * with the local optimistic flag (kept for the instant between a live 409 and
 * `sub` re-fetching), and `isTrialEligible` is the single decision every CTA
 * in `billing.tsx` now calls to decide "start a trial" vs "go straight to
 * paid checkout".
 */

/**
 * Combine the server-authoritative `has_used_trial` (from `Subscription`)
 * with a same-session optimistic local flag into ONE eligibility signal.
 * `subHasUsedTrial` is `undefined` for a subscription payload from an older
 * server build that doesn't send the field yet — treated as "unknown, assume
 * not used" so the field's absence never wrongly hides trial CTAs.
 */
export function resolveHasUsedTrial(
  subHasUsedTrial: boolean | undefined,
  localTrialUsedFlag: boolean,
): boolean {
  return localTrialUsedFlag || subHasUsedTrial === true
}

export interface TrialEligibilityInput {
  /** The effective plan slug the user is currently on ('free', 'basic', …). */
  effectivePlan: string
  /** `sub?.status` — a live trial in progress is never "eligible to start a new one". */
  subStatus?: string | null
  /** `resolveHasUsedTrial(...)` — true blocks every trial CTA outright. */
  hasUsedTrial: boolean
  /** The TARGET plan is coming-soon (e.g. Teams/business) — never trial-eligible. */
  targetComingSoon?: boolean
}

/**
 * True when clicking a trial-capable CTA should start a NEW trial
 * (`POST /billing/trial/start`). False means the CTA must go straight to the
 * paid upgrade/checkout flow (`openUpgrade` / `createCheckoutSession`) and
 * must NEVER call `startTrial()` — the one-trial-per-account server rule
 * would just reject it.
 */
export function isTrialEligible({
  effectivePlan,
  subStatus,
  hasUsedTrial,
  targetComingSoon,
}: TrialEligibilityInput): boolean {
  return (
    effectivePlan === 'free' &&
    subStatus !== 'trialing' &&
    !hasUsedTrial &&
    !targetComingSoon
  )
}
