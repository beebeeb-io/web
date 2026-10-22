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
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

/**
 * The hold ends at 23:59:59 Europe/Amsterdam on the stated day (and the mail
 * names that day), so the date is shown on that clock: in the viewer's own
 * timezone the same instant could read as the next day and contradict the mail.
 * The language and number format follow the viewer's locale.
 */
export function formatConfirmDate(iso: string, locale?: string | string[]): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  })
}

/** The banner sentence. Honest and plain: what the bank asked, by when, what happens otherwise. */
export function confirmPaymentBannerCopy(iso: string, locale?: string | string[]): string {
  return `Your bank asks you to confirm your first payment. Confirm by ${formatConfirmDate(iso, locale)}, or your trial ends then.`
}

/** The reassurance that goes with it: nothing is wrong with the card. */
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
