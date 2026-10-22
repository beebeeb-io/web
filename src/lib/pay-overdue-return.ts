/**
 * Task 2162 — the return from the pay-overdue checkout (`POST /billing/pay-overdue`, which
 * returns to `/settings/billing?paid_overdue=true`). Pure helpers, pinned by
 * `test/2162-pay-overdue-result.test.ts`.
 *
 * Differences from the 2092 trial pay-now return, all forced by the server:
 *   - pay-overdue answers `{ checkout_url, arrears_cents }` (or `{ checkout_url, reused: true }`)
 *     with NO payment id, so there is no id to persist and `GET /billing/payment/{id}/status`
 *     (and its 60 s cache of a non-final `open`, task 2161) is not involved at all.
 *   - the checkout returns to the same URL for paid, failed and cancelled, so the page cannot tell
 *     a decline from a cancel. It polls the SUBSCRIPTION: the webhook's settlement
 *     (`apply_pay_overdue_settlement`) sets `status = active, billing_state = active`.
 * The poll uses the same interval and bound as the pay-now return, then shows an honest
 * "still waiting" with Refresh. It never claims "failed" or "cancelled".
 */
import { PAY_NOW_POLL_TIMEOUT_MS } from './trial-pay-now'

export const PAY_OVERDUE_RETURN_PARAM = 'paid_overdue'

/** Only the exact value the server's redirect carries is handled. */
export function shouldHandlePayOverdueReturn(param: string | null | undefined): boolean {
  return param === 'true'
}

export type PayOverdueDecision = 'paid' | 'keep_polling' | 'waiting'

export interface PayOverdueSubFields {
  status?: string | null
  billing_state?: string | null
}

/** One tick: paid when the settlement has un-frozen the account; otherwise poll until the bound. */
export function payOverdueReturnDecision(
  sub: PayOverdueSubFields | null | undefined,
  elapsedMs: number,
): PayOverdueDecision {
  if (sub?.status === 'active' && sub.billing_state !== 'read_only') return 'paid'
  return elapsedMs >= PAY_NOW_POLL_TIMEOUT_MS ? 'waiting' : 'keep_polling'
}

export type PayOverdueViewKind = 'checking' | 'paid' | 'waiting'

export interface PayOverdueView {
  kind: PayOverdueViewKind
  message: string
  /** Offer "Refresh": check again. */
  refresh: boolean
  /** Offer "Try again": open the checkout again (the server reuses an open one). */
  retry: boolean
}

export function payOverdueReturnView(kind: PayOverdueViewKind): PayOverdueView {
  switch (kind) {
    case 'paid':
      return { kind, message: 'Payment received. Your account is active again.', refresh: false, retry: false }
    case 'waiting':
      return {
        kind,
        message:
          "We haven't received your payment yet. Some banks take a few minutes to confirm. If you cancelled or your bank declined it, you can try again. Nothing more is charged until you confirm.",
        refresh: true,
        retry: true,
      }
    default:
      return { kind: 'checking', message: 'Checking your payment…', refresh: false, retry: false }
  }
}
