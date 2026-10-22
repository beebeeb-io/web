/**
 * Task 1605 — pure state/poll helpers for the "pay now" trial-cap flow
 * (`POST /billing/trial/pay-now`). Kept out of billing.tsx / the trial card
 * component so the state transitions are unit-testable without React or
 * real timers — the component just calls these on each tick / each API
 * response and renders whatever phase comes back.
 *
 * Flow: submitting → (pending → poll → settled) | settled | error.
 *   - `pending: true` in the pay-now response = an off-session mandate
 *     (SEPA) that settles over days via webhook — poll `getSubscription()`
 *     until `status === 'active'`, bounded, with an honest message if it
 *     takes a while.
 *   - No `pending` = settled synchronously (card/instant method) — refetch
 *     once and stop.
 */

export type PayNowPhase = 'idle' | 'submitting' | 'pending' | 'settled' | 'error'

export interface PayNowState {
  phase: PayNowPhase
  paymentId?: string
  message?: string
}

export interface PayNowPayResult {
  payment_id: string
  status?: string
  amount_cents?: number
  pending?: boolean
  /** Task 2092: set EXACTLY when status is `open` — a hosted, customer-present checkout. */
  checkout_url?: string | null
}

export const PAY_NOW_POLL_INTERVAL_MS = 3000
export const PAY_NOW_POLL_TIMEOUT_MS = 60_000
/** Past this much elapsed wait, swap to the "this can take longer" message. */
export const PAY_NOW_SLOW_THRESHOLD_MS = 15_000

export const IDLE_STATE: PayNowState = { phase: 'idle' }

/** The state right after `payTrialNow()` resolves (200, either shape). */
export function stateAfterPayNowResult(result: PayNowPayResult): PayNowState {
  if (result.pending) {
    return {
      phase: 'pending',
      paymentId: result.payment_id,
      message: payNowWaitingMessage(0),
    }
  }
  return { phase: 'settled', paymentId: result.payment_id }
}

export interface PayNowErrorLike {
  status?: number
  code?: string
  message?: string
}

/** The state right after `payTrialNow()` rejects. Never throws further — always returns a renderable state. */
export function stateAfterPayNowError(err: PayNowErrorLike): PayNowState {
  if (err.code === 'trial_not_active') {
    return {
      phase: 'error',
      message: 'Your trial has already ended, converted, or been cancelled. Refresh to see your current plan.',
    }
  }
  const fallback = 'Could not process your payment right now. Try again shortly.'
  return {
    phase: 'error',
    message: err.message && err.message.length <= 160 ? err.message : fallback,
  }
}

export type PollOutcome = 'keep_polling' | 'settled' | 'timeout'

/**
 * One tick of the bounded poll: given how long we've been waiting and the
 * freshly-fetched subscription's status, decide what to do next.
 * `status === 'active'` is the server's own unconditional signal (Step A of
 * `apply_trial_pay_now_settlement` flips it BEFORE anything Mollie-side is
 * confirmed) — reached whether the payment settled synchronously or the
 * webhook is still catching up on the Mollie-subscription side.
 */
export function payNowPollDecision(elapsedMs: number, status: string | null | undefined): PollOutcome {
  if (status === 'active') return 'settled'
  if (elapsedMs >= PAY_NOW_POLL_TIMEOUT_MS) return 'timeout'
  return 'keep_polling'
}

/** Honest, changing copy for a poll that is taking a while — never a silent spinner past the slow threshold. */
export function payNowWaitingMessage(elapsedMs: number): string {
  return elapsedMs >= PAY_NOW_SLOW_THRESHOLD_MS
    ? "Still processing — some payment methods take longer to settle. You can leave this page; your plan updates automatically once it clears."
    : 'Payment is processing…'
}

/** The state to render at each poll tick, given the outcome. */
export function stateForPollOutcome(outcome: PollOutcome, elapsedMs: number, paymentId?: string): PayNowState {
  if (outcome === 'settled') return { phase: 'settled', paymentId }
  if (outcome === 'timeout') {
    return {
      phase: 'error',
      paymentId,
      message:
        "This is taking longer than expected. Your payment may still complete — check back in a few minutes, or contact support if your plan hasn't updated.",
    }
  }
  return { phase: 'pending', paymentId, message: payNowWaitingMessage(elapsedMs) }
}

/* ── Task 2092: customer-present checkout (3-D Secure) ───────────────── */

/** sessionStorage key carrying the payment id across the checkout redirect. */
export const PAY_NOW_PAYMENT_STORAGE_KEY = 'bb_pay_now_payment_id'
/** Query param the checkout redirects back with: `returned` or `canceled`. */
export const PAY_NOW_RETURN_PARAM = 'trial_pay_now'

export type PayNowRouting =
  | { kind: 'redirect'; url: string; paymentId: string }
  | { kind: 'inline'; state: PayNowState }

/**
 * Task 2106 — the debug server's built-in mock Mollie hands out `http://localhost:<port>/…`
 * checkouts. Followed ONLY when the caller opts in (billing.tsx passes `import.meta.env.DEV`,
 * false in every production build) and only for loopback hosts.
 */
export function isLocalHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/**
 * Decide what to do with the pay-now response. A `checkout_url` means the
 * bank may ask for 3-D Secure, so the person is sent there. Without one (an
 * older server) the pre-2092 behaviour applies unchanged. Only https URLs are
 * ever followed.
 */
export function routePayNowResult(result: PayNowPayResult, opts: { allowLocalHttp?: boolean } = {}): PayNowRouting {
  const url = safeCheckoutUrl(result.checkout_url, opts)
  if (url) {
    return { kind: 'redirect', url, paymentId: result.payment_id }
  }
  // Task 2162: a checkout_url the guard refused (http, foreign host) is an error. It must not fall
  // through to the "settled" path below, which would announce an unlock that never happened.
  if (typeof result.checkout_url === 'string' && result.checkout_url.length > 0) {
    return {
      kind: 'inline',
      state: { phase: 'error', paymentId: result.payment_id, message: 'The payment page could not be opened. Please try again.' },
    }
  }
  return { kind: 'inline', state: stateAfterPayNowResult(result) }
}

/**
 * The one guard every hosted-checkout redirect goes through (pay-now, pay-overdue): https, or
 * (only when the caller opts in for a dev build) a loopback http URL. Anything else is null.
 */
export function safeCheckoutUrl(url: string | null | undefined, opts: { allowLocalHttp?: boolean } = {}): string | null {
  if (typeof url !== 'string') return null
  if (url.startsWith('https://')) return url
  return opts.allowLocalHttp === true && isLocalHttpUrl(url) ? url : null
}

export type PayNowReturnKind = 'returned' | 'canceled'

export function payNowReturnKind(param: string | null | undefined): PayNowReturnKind | null {
  return param === 'returned' || param === 'canceled' ? param : null
}

export type PayNowReturnDecision = 'paid' | 'failed' | 'keep_polling' | 'waiting'

/** One tick of the return poll, from the payment status and the time waited. */
export function payNowReturnDecision(status: string | null | undefined, elapsedMs: number): PayNowReturnDecision {
  if (status === 'paid') return 'paid'
  if (status === 'failed' || status === 'canceled' || status === 'expired') return 'failed'
  return elapsedMs >= PAY_NOW_POLL_TIMEOUT_MS ? 'waiting' : 'keep_polling'
}

/**
 * The stored payment marker is dropped only on a FINAL state. 'waiting' shows a
 * Refresh button and the payment may still be open, so it must stay.
 */
export function shouldClearPayNowMarker(decision: PayNowReturnDecision): boolean {
  return decision === 'paid' || decision === 'failed'
}

export type PayNowReturnViewKind = 'checking' | 'paid' | 'failed' | 'waiting' | 'canceled'

export interface PayNowReturnView {
  kind: PayNowReturnViewKind
  message: string
  /** Offer "Try again" (a definite failure or a cancel). */
  retry: boolean
  /** Offer "Refresh" (still undecided after the bound). */
  refresh: boolean
}

export function payNowReturnView(kind: PayNowReturnViewKind): PayNowReturnView {
  switch (kind) {
    case 'paid':
      return { kind, message: 'Payment received — your plan is active.', retry: false, refresh: false }
    case 'failed':
      return { kind, message: "Your bank didn't confirm the payment. Nothing was charged.", retry: true, refresh: false }
    case 'waiting':
      return { kind, message: "We're waiting for your bank's confirmation.", retry: false, refresh: true }
    case 'canceled':
      return { kind, message: 'Payment cancelled. Nothing was charged.', retry: true, refresh: false }
    default:
      return { kind: 'checking', message: 'Checking your payment…', retry: false, refresh: false }
  }
}
