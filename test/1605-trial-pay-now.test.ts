/**
 * Task 1605 — the "pay now" phase/poll state machine (../src/lib/trial-pay-now.ts).
 * Kept pure/timer-free so it is testable without React or fake timers.
 */
import { describe, expect, test } from 'bun:test'
import {
  stateAfterPayNowResult,
  stateAfterPayNowError,
  payNowPollDecision,
  payNowWaitingMessage,
  stateForPollOutcome,
  PAY_NOW_POLL_TIMEOUT_MS,
  PAY_NOW_SLOW_THRESHOLD_MS,
} from '../src/lib/trial-pay-now'

describe('stateAfterPayNowResult', () => {
  test('synchronous settlement (no pending flag) → settled', () => {
    expect(stateAfterPayNowResult({ payment_id: 'tr_1', status: 'paid', amount_cents: 4995 })).toEqual({
      phase: 'settled',
      paymentId: 'tr_1',
    })
  })

  test('pending: true → pending, with a waiting message', () => {
    const state = stateAfterPayNowResult({ payment_id: 'tr_2', pending: true })
    expect(state.phase).toBe('pending')
    expect(state.paymentId).toBe('tr_2')
    expect(state.message).toBeTruthy()
  })
})

describe('stateAfterPayNowError', () => {
  test('trial_not_active gets its own honest copy, not the generic fallback', () => {
    const state = stateAfterPayNowError({ status: 409, code: 'trial_not_active' })
    expect(state.phase).toBe('error')
    expect(state.message).toContain('already ended')
  })

  test('a short server message is passed through verbatim', () => {
    const state = stateAfterPayNowError({ status: 402, message: 'Your card was declined.' })
    expect(state.message).toBe('Your card was declined.')
  })

  test('an overlong/unsafe message falls back to the generic copy (never leaks a raw body)', () => {
    const long = 'x'.repeat(500)
    const state = stateAfterPayNowError({ status: 500, message: long })
    expect(state.message).toBe('Could not process your payment right now. Try again shortly.')
  })
})

describe('payNowPollDecision', () => {
  test('status active → settled, regardless of elapsed time', () => {
    expect(payNowPollDecision(0, 'active')).toBe('settled')
    expect(payNowPollDecision(59_000, 'active')).toBe('settled')
  })

  test('still trialing, under the timeout → keep_polling', () => {
    expect(payNowPollDecision(1000, 'trialing')).toBe('keep_polling')
  })

  test('at or past the bounded timeout, not yet active → timeout (never polls forever)', () => {
    expect(payNowPollDecision(PAY_NOW_POLL_TIMEOUT_MS, 'trialing')).toBe('timeout')
    expect(payNowPollDecision(PAY_NOW_POLL_TIMEOUT_MS + 1, 'trialing')).toBe('timeout')
  })

  test('a fetch failure (null status) still keeps polling until the timeout', () => {
    expect(payNowPollDecision(1000, null)).toBe('keep_polling')
  })
})

describe('payNowWaitingMessage', () => {
  test('short wait: a plain processing message', () => {
    expect(payNowWaitingMessage(0)).toBe('Payment is processing…')
  })

  test('past the slow threshold: a different, more informative message — never a silent unchanged spinner', () => {
    const msg = payNowWaitingMessage(PAY_NOW_SLOW_THRESHOLD_MS)
    expect(msg).not.toBe(payNowWaitingMessage(0))
    expect(msg).toContain('longer')
  })
})

describe('stateForPollOutcome', () => {
  test('settled outcome → settled phase, carries the payment id', () => {
    expect(stateForPollOutcome('settled', 5000, 'tr_9')).toEqual({ phase: 'settled', paymentId: 'tr_9' })
  })

  test('timeout outcome → error phase with a "may still complete" message, not a flat failure', () => {
    const state = stateForPollOutcome('timeout', PAY_NOW_POLL_TIMEOUT_MS, 'tr_9')
    expect(state.phase).toBe('error')
    expect(state.message).toContain('longer than expected')
  })

  test('keep_polling outcome → pending phase with the elapsed-aware waiting message', () => {
    const state = stateForPollOutcome('keep_polling', 20_000, 'tr_9')
    expect(state.phase).toBe('pending')
    expect(state.message).toBe(payNowWaitingMessage(20_000))
  })
})
