/**
 * Task 2106 — the client side of server 2092b (3-D Secure at renewal and at
 * trial end). Pure helpers, pinned by `test/2106-confirm-payment.test.ts`.
 *
 * Two server facts drive this:
 *   - When the bank asks for confirmation of a trial's first charge, the trial
 *     is HELD for 3 days instead of lapsing. `GET /billing/subscription` then
 *     carries `confirm_payment_by` (RFC 3339). `trial_auto_converts` stays true
 *     (the trial is still mandated), so it can NOT tell a held trial from a
 *     normal one: `confirm_payment_by` alone does. A held trial does not charge
 *     by itself, so no banner may say "charged automatically" for it.
 *   - The two mails link to `?confirm_payment=1` (renewal / past due: starts
 *     `POST /billing/pay-overdue`) and `?confirm_payment=trial` (held trial:
 *     starts `POST /billing/trial/pay-now`). `/billing` redirects to
 *     `/settings/billing` with the query intact, so both paths work.
 */

export const CONFIRM_PAYMENT_PARAM = 'confirm_payment'

import { cardTrialCancelCopy } from './no-card-trial'

export interface ConfirmPaymentFields {
  status?: string | null
  confirm_payment_by?: string | null
}

/**
 * The end of the confirmation hold, or null when the trial is not held. Only a
 * `trialing` row with a parseable date counts: a stale field on any other
 * status is ignored.
 */
export function confirmPaymentBy(sub: ConfirmPaymentFields | null | undefined): string | null {
  if (!sub || sub.status !== 'trialing') return null
  const iso = sub.confirm_payment_by
  if (typeof iso !== 'string' || iso.length === 0) return null
  const at = new Date(iso).getTime()
  // The server clears the hold after its lapse job completes, which can be delayed.
  // An elapsed deadline must never turn a held trial into an automatic-charge promise.
  return Number.isNaN(at) ? null : iso
}

/**
 * ONE formatter for every date that belongs to a hold (the banner, the period line, the
 * cycle-switch copy, the cancel copy). The hold ends at 23:59:59 Europe/Amsterdam on the stated
 * day and the mail names that day, so it is shown on that clock: in the viewer's own timezone the
 * same instant can read as the next day. The format is en-GB short ("25 Oct 2026"), exactly what
 * the rest of the billing page and the mail use.
 */
export function formatConfirmDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  })
}

/** True when the instant is 23:59:59 on some Amsterdam day: exactly where a hold ends. */
function isAmsterdamDayEnd(iso: string): boolean {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return false
  const clock = t.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/Amsterdam' })
  return clock === '23:59:59'
}

/**
 * The label for a date on the billing page that may belong to a hold. While held, and also after
 * the customer cancels the held trial (the server then drops `confirm_payment_by` but keeps the
 * end-of-hold instant as the trial end), the date is the Amsterdam day the mail named. Any other
 * date goes through the page's own formatter.
 */
export function holdDateLabel(iso: string | null, held: boolean, fallback: (iso: string | null) => string): string {
  return iso && (held || isAmsterdamDayEnd(iso)) ? formatConfirmDate(iso) : fallback(iso)
}

/** The banner sentence. Honest and plain: what the bank asked, by when, what happens otherwise. */
export function confirmPaymentBannerCopy(iso: string): string {
  return `Your bank asks you to confirm your first payment. Confirm by ${formatConfirmDate(iso)}, or your trial ends then.`
}

export interface ChargesAutomaticallyFields extends ConfirmPaymentFields {
  trial_auto_converts?: boolean | null
}

/**
 * The ONE predicate behind every "charged automatically" / "your first charge is on" promise:
 * a mandated trial that is NOT held. A held trial keeps `trial_auto_converts: true` but does not
 * charge by itself; it ends unless the customer confirms the payment.
 */
export function chargesAutomatically(sub: ChargesAutomaticallyFields | null | undefined): boolean {
  return !!sub && sub.status === 'trialing' && sub.trial_auto_converts === true && confirmPaymentBy(sub) === null
}

/**
 * Past-due banner for `?confirm_payment=1`. The mail link alone does not say WHY the payment
 * failed (a bank asking for confirmation, or a plain decline), so this claims neither.
 */
export const CONFIRM_OVERDUE_COPY =
  'Your last payment did not go through. Your bank may need you to confirm it yourself, which takes a minute. If it was declined, update your payment method instead.'

/** The reassurance on a HELD trial, where the bank has asked for confirmation: nothing is wrong with the card. */
export const CONFIRM_PAYMENT_REASSURANCE =
  'Nothing is wrong with your card. Some banks need you to approve a payment yourself, and that takes a minute.'

export const CONFIRM_PAYMENT_CTA = 'Confirm payment'

export type ConfirmPaymentIntent = 'overdue' | 'trial'

/** `?confirm_payment=1` -> pay-overdue, `=trial` -> pay-now, anything else -> nothing. */
export function confirmPaymentIntent(param: string | null | undefined): ConfirmPaymentIntent | null {
  if (param === '1') return 'overdue'
  if (param === 'trial') return 'trial'
  return null
}

/** Where the app shell's banner sends the customer: billing, which starts pay-now. */
export const CONFIRM_PAYMENT_TRIAL_PATH = `/settings/billing?${CONFIRM_PAYMENT_PARAM}=trial`

/**
 * Cancel copy for a HELD trial. The card-trial copy opens with "Cancelling stops the automatic
 * charge", which is false here (a held trial has none); the rest (read-only, retention) is the same.
 */
export function heldTrialCancelCopy(trialEndDay: string): string {
  const rest = cardTrialCancelCopy(trialEndDay).replace(/^Cancelling stops the automatic charge\.\s*/, '')
  return `Cancelling ends your trial, and nothing is charged. ${rest}`
}

export type ConfirmIntentAction =
  | { kind: 'none' }
  | { kind: 'wait' }
  | { kind: 'ignore' }
  | { kind: 'pay-now' }
  | { kind: 'pay-overdue' }
  | { kind: 'note'; text: string }

/**
 * What the billing page does with `?confirm_payment=`. The intent is consumed only after a
 * SUCCESSFUL subscription load: while loading, or after a failed load, it waits and the param stays
 * in the URL so Retry acts on it. It starts a checkout only for the state the mail described.
 */
export function confirmIntentAction(
  raw: string | null,
  sub: (ConfirmPaymentFields & { billing_state?: string | null }) | null | undefined,
  load: { loading: boolean; loadFailed: boolean },
): ConfirmIntentAction {
  if (raw === null) return { kind: 'none' }
  if (load.loading || load.loadFailed) return { kind: 'wait' }
  const intent = confirmPaymentIntent(raw)
  if (intent === 'trial') {
    return confirmPaymentBy(sub) !== null
      ? { kind: 'pay-now' }
      : { kind: 'note', text: 'There is no payment waiting for your confirmation on your trial right now.' }
  }
  if (intent === 'overdue') {
    return sub?.status === 'past_due' || sub?.billing_state === 'read_only'
      ? { kind: 'pay-overdue' }
      : { kind: 'note', text: 'There is no outstanding payment to confirm right now.' }
  }
  return { kind: 'ignore' }
}

