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
