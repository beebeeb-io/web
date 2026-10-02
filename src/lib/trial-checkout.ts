/**
 * Trial-with-mandate checkout (task 1037 — no free signups).
 *
 * Signup shows the trial plans first (Starter / Basic / Pro, monthly or
 * yearly); after onboarding the account lands on `/choose-plan`, where the
 * user picks a payment method and `POST /billing/trial/checkout` sends them to
 * Mollie. Card = a €0 first payment; iDEAL = €0.01, refunded, creating a SEPA
 * mandate. Mollie returns them to `/choose-plan?returned=1`, where the page
 * reconciles against `GET /billing/payment/{id}/status` + the subscription.
 *
 * Everything here is pure (no React) and pinned by
 * `test/1037-trial-at-signup.test.ts`.
 */

import type { AccountState, Plan, Subscription } from '@beebeeb/shared'
import { PLAN_META } from './plan-constants'
import type { BillingCycle, PlanIntent } from './plan-intent'
import { PAID_CHECKOUT_PATH, resolveAccountState } from './account-state'

/** The plans a trial can start on, in tier order (never Free, never Teams). */
export const TRIAL_PLAN_SLUGS = ['starter', 'basic', 'pro'] as const
export type TrialPlanSlug = (typeof TRIAL_PLAN_SLUGS)[number]

/** Used until `GET /billing/plans` answers (and when it sends no trial_days). */
export const DEFAULT_TRIAL_DAYS = 14

/** Preselected on /signup when the visitor arrived without a plan intent. */
export const DEFAULT_TRIAL_PLAN: TrialPlanSlug = 'basic'

export type TrialMethod = 'creditcard' | 'ideal'

export interface TrialPlanOption {
  id: TrialPlanSlug
  name: string
  /** EUR per month on the monthly cycle. */
  priceMonthly: number
  /** EUR per YEAR on the yearly cycle (the annual total, not a monthly equivalent). */
  priceYearly: number
  storageLabel: string
  trialDays: number
}

function storageLabelFromGB(gb: number): string {
  return gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`
}

/**
 * Plan cards for the trial picker: server prices, storage label and
 * `trial_days` where `GET /billing/plans` has them, `plan-constants.ts`
 * otherwise. Always Starter, Basic, Pro — in that order.
 */
export function buildTrialPlanOptions(apiPlans: Plan[] | null | undefined): TrialPlanOption[] {
  return TRIAL_PLAN_SLUGS.map((id) => {
    const meta = PLAN_META[id]
    const api = apiPlans?.find((p) => p.id === id)
    const trialDays =
      typeof api?.trial_days === 'number' && api.trial_days > 0 ? api.trial_days : DEFAULT_TRIAL_DAYS
    return {
      id,
      name: api?.name || meta.label,
      // Task 1701 — render the STORED price: a plan the API prices at €0 shows
      // €0, never the static fallback (the 1.99 substitution hid the owner's
      // stored price and sent testers to a checkout that then failed on the
      // zero amount — task 1702). The static constants only fill in when the
      // API has no row for the plan at all.
      priceMonthly: api ? api.price_eur : meta.priceMonthly,
      priceYearly: api ? api.price_yearly_eur : meta.priceYearly,
      storageLabel: api?.storage_label || storageLabelFromGB(meta.storageGB),
      trialDays,
    }
  })
}

export function isTrialPlanSlug(slug: string | null | undefined): slug is TrialPlanSlug {
  return (TRIAL_PLAN_SLUGS as readonly string[]).includes(slug ?? '')
}

/**
 * Task 1702 — true when the plan's price for `cycle` is €0: the server
 * activates it directly (no payment method, no mandate, no trial), so the
 * checkout flow must skip the payment steps entirely.
 */
export function isZeroPriceForCycle(
  priceMonthly: number,
  priceYearly: number,
  cycle: BillingCycle,
): boolean {
  return (cycle === 'yearly' ? priceYearly : priceMonthly) === 0
}

/** "€3.99", "€10", "€39.90" — cents shown only when there are any. */
export function formatEur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`
}

/** "€3.99/month" or "€39.90/year". */
export function trialPriceLabel(amount: number, cycle: BillingCycle): string {
  return `${formatEur(amount)}/${cycle === 'yearly' ? 'year' : 'month'}`
}

/** The honest one-liner shown next to every trial CTA. */
export function trialTermsCopy(days: number): string {
  return `${days}-day free trial. Card or iDEAL needed to start. No charge until day ${days + 1}; cancel any time before.`
}

export function startTrialLabel(days: number): string {
  return `Start ${days}-day free trial`
}

export const TRIAL_METHOD_COPY: Record<TrialMethod, { label: string; detail: string }> = {
  creditcard: { label: 'Card', detail: '€0 authorization, no charge today' },
  ideal: { label: 'iDEAL', detail: '€0.01 verification, refunded' },
}

/** "12 Oct 2026" — the billing page's date style. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The first charge date: today + `days` (what the summary promises). */
export function trialChargeDate(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return shortDate(d.toISOString())
}

/**
 * Billing summary line for a trial that already has a mandate and converts on
 * its own (`trial_auto_converts === true`).
 */
export function trialAutoConvertCopy(trialEndsAt: string, amount: number, cycle: BillingCycle): string {
  return `Trial — ends ${shortDate(trialEndsAt)}. Then ${trialPriceLabel(amount, cycle)}, charged automatically.`
}

/** `/choose-plan` with an optional preselection (and the billing entry marker). */
export function choosePlanPath(intent: PlanIntent | null, opts: { fromBilling?: boolean } = {}): string {
  const q = new URLSearchParams()
  if (intent) {
    q.set('plan', intent.plan)
    q.set('cycle', intent.cycle)
  }
  if (opts.fromBilling) q.set('from', 'billing')
  const qs = q.toString()
  return qs ? `/choose-plan?${qs}` : '/choose-plan'
}

export interface ChoosePlanEntryInput {
  accountState: AccountState
  /** `?returned=1` — Mollie sent the user back. */
  returned: boolean
  /** `?from=billing` — an existing account chose "Start trial" on billing. */
  fromBilling: boolean
  subStatus: string | null | undefined
  /** The plan the account is on right now ('free' for grandfathered Free). */
  effectivePlan: string
  hasUsedTrial: boolean
}

export type ChoosePlanEntry =
  | { kind: 'reconcile' }
  | { kind: 'pick' }
  | { kind: 'redirect'; to: string }

/**
 * What `/choose-plan` does on arrival.
 *
 * - A Mollie return always reconciles first.
 * - `needs_plan` picks a plan (this is the gate's destination).
 * - `lapsed` already used its trial → normal paid checkout.
 * - `ok` has nothing to choose here (entitled, grandfathered Free, or a server
 *   with the gate off / without `account_state`) → the drive. The one
 *   exception is a trial-eligible Free account sent here by billing's
 *   "Start trial" CTA; if that account is no longer eligible, billing's paid
 *   checkout is the right place.
 */
export function choosePlanEntry(input: ChoosePlanEntryInput): ChoosePlanEntry {
  if (input.returned) return { kind: 'reconcile' }
  if (input.accountState === 'needs_plan') return { kind: 'pick' }
  if (input.accountState === 'lapsed') return { kind: 'redirect', to: PAID_CHECKOUT_PATH }
  if (input.fromBilling) {
    const eligible =
      input.effectivePlan === 'free' && input.subStatus !== 'trialing' && !input.hasUsedTrial
    return eligible ? { kind: 'pick' } : { kind: 'redirect', to: PAID_CHECKOUT_PATH }
  }
  return { kind: 'redirect', to: '/' }
}

export type MandatePaymentStatus =
  | 'open'
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

export type TrialReturnOutcome = 'live' | 'failed' | 'blocked' | 'pending'

/** `trial_block_reason` for a card / bank account that already had a trial. */
export const TRIAL_BLOCK_PAYMENT_METHOD_USED = 'payment_method_already_used'

/**
 * Inline copy for a trial the server refused to start although the mandate
 * was paid (`trial_block_reason`). Null when there is no reason.
 */
export function trialBlockedCopy(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason === TRIAL_BLOCK_PAYMENT_METHOD_USED) {
    return "This card or bank account has already been used for a free trial. You can subscribe now — you'll be charged today."
  }
  return "We couldn't start a free trial with this payment method. You can subscribe now — you'll be charged today."
}

/**
 * Reconcile after the Mollie return. The subscription is the truth for
 * success (the webhook, not the redirect, starts the trial) and for a
 * refused trial (`trial_block_reason`); the payment status is the truth for
 * failure.
 */
export function trialReturnOutcome(
  paymentStatus: MandatePaymentStatus | null,
  sub: Subscription | null,
): TrialReturnOutcome {
  if (sub && resolveAccountState(sub) === 'ok') {
    if (sub.status === 'trialing') return 'live'
    if (sub.status === 'active' && sub.plan !== 'free') return 'live'
  }
  if (paymentStatus === 'failed' || paymentStatus === 'canceled' || paymentStatus === 'expired') {
    return 'failed'
  }
  // One trial per payment method: the mandate went through but the server
  // started no trial. The reason is cleared on every /trial/checkout, so one
  // seen after the return belongs to THIS attempt — no need to wait for the
  // payment status call to say "paid".
  if (sub?.trial_block_reason) return 'blocked'
  return 'pending'
}

/** Inline error copy for a mandate payment that did not go through. */
export function trialReturnFailedCopy(status: MandatePaymentStatus | null): string {
  if (status === 'canceled') return 'The payment was cancelled, so your trial has not started. Nothing was charged — you can try again.'
  if (status === 'expired') return 'The payment page expired before it was completed, so your trial has not started. You can try again.'
  return 'The payment could not be completed, so your trial has not started. Nothing was charged — try again or choose another method.'
}

export type TrialCheckoutErrorKind = 'trial_used' | 'has_plan' | 'billing_profile' | 'error'

/**
 * Where a failed `POST /billing/trial/checkout` sends the user.
 *   - 409 `trial_already_used`            → normal paid checkout on billing.
 *   - 409 `trial_has_active_subscription` → the account already has a plan.
 *   - 400 `billing_profile_required`      → collect the billing profile first
 *     (the endpoint resolves VAT exactly like `/billing/checkout`, whose error
 *     text STARTS with the code rather than carrying it as `error`).
 */
export function classifyTrialCheckoutError(err: unknown): TrialCheckoutErrorKind {
  if (!err || typeof err !== 'object') return 'error'
  const e = err as { status?: unknown; code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : ''
  if (code === 'trial_already_used') return 'trial_used'
  if (code === 'trial_has_active_subscription') return 'has_plan'
  if (code === 'billing_profile_required' || message.startsWith('billing_profile_required')) {
    return 'billing_profile'
  }
  return 'error'
}

/**
 * EUR the trial converts into per cycle: the row's `mollie_amount_cents` (what
 * Mollie will actually charge), else the catalogue price for the cycle, else
 * plan-constants. Null for an unknown plan.
 *
 * Task 1701 — the API catalogue price passes through VERBATIM, including €0:
 * the old `p > 0` guard substituted the static 1.99 for a plan the owner
 * stored at €0. The plan-constants fallback (only reached when the API has no
 * matching row at all) keeps its guard — there the real price is unknowable,
 * and guessing €0 would be as wrong as guessing 1.99.
 */
export function trialRenewalAmount(
  sub: Pick<Subscription, 'plan' | 'billing_cycle' | 'mollie_amount_cents'>,
  plan: Pick<Plan, 'id' | 'price_eur' | 'price_yearly_eur'> | null | undefined,
): number | null {
  if (typeof sub.mollie_amount_cents === 'number' && sub.mollie_amount_cents > 0) {
    return sub.mollie_amount_cents / 100
  }
  const yearly = sub.billing_cycle === 'yearly'
  if (plan && plan.id === sub.plan) {
    return yearly ? plan.price_yearly_eur : plan.price_eur
  }
  const meta = PLAN_META[sub.plan]
  if (!meta) return null
  const p = yearly ? meta.priceYearly : meta.priceMonthly
  return p > 0 ? p : null
}
