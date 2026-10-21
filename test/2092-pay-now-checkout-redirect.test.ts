/**
 * Task 2092 — pay-now becomes customer-present. The server returns a hosted
 * `checkout_url` exactly when the payment is `open` (the bank can ask 3-D
 * Secure); the client redirects, then settles on the return from the payment
 * status. An OLD server (no checkout_url) keeps today's behaviour.
 */
import { describe, expect, test } from 'bun:test'
import {
  routePayNowResult,
  payNowReturnKind,
  payNowReturnDecision,
  payNowReturnView,
  PAY_NOW_POLL_TIMEOUT_MS,
} from '../src/lib/trial-pay-now'

describe('routePayNowResult', () => {
  test('checkout_url present -> redirect to it, carrying the payment id', () => {
    expect(
      routePayNowResult({ payment_id: 'tr_1', status: 'open', checkout_url: 'https://pay.example/checkout/tr_1', amount_cents: 1990 }),
    ).toEqual({ kind: 'redirect', url: 'https://pay.example/checkout/tr_1', paymentId: 'tr_1' })
  })

  test('legacy response, paid, no checkout_url -> unchanged settled state', () => {
    expect(routePayNowResult({ payment_id: 'tr_2', status: 'paid', amount_cents: 1990 })).toEqual({
      kind: 'inline',
      state: { phase: 'settled', paymentId: 'tr_2' },
    })
  })

  test('legacy response, pending, no checkout_url -> unchanged pending state', () => {
    const r = routePayNowResult({ payment_id: 'tr_3', pending: true })
    expect(r.kind).toBe('inline')
    if (r.kind === 'inline') expect(r.state.phase).toBe('pending')
  })

  test('empty or non-https checkout_url is never followed', () => {
    expect(routePayNowResult({ payment_id: 'tr_4', checkout_url: '' }).kind).toBe('inline')
    expect(routePayNowResult({ payment_id: 'tr_5', checkout_url: 'javascript:alert(1)' }).kind).toBe('inline')
  })
})

describe('payNowReturnKind', () => {
  test('maps the query param', () => {
    expect(payNowReturnKind('returned')).toBe('returned')
    expect(payNowReturnKind('canceled')).toBe('canceled')
    expect(payNowReturnKind(null)).toBeNull()
    expect(payNowReturnKind('x')).toBeNull()
  })
})

describe('payNowReturnDecision', () => {
  test('paid settles', () => expect(payNowReturnDecision('paid', 0)).toBe('paid'))
  test.each(['failed', 'canceled', 'expired'] as const)('%s is a definite failure', (s) => {
    expect(payNowReturnDecision(s, 0)).toBe('failed')
  })
  test.each(['open', 'pending', 'authorized', 'unknown'] as const)('%s keeps polling inside the bound', (s) => {
    expect(payNowReturnDecision(s, 1000)).toBe('keep_polling')
  })
  test('still open past the bound -> waiting', () => {
    expect(payNowReturnDecision('pending', PAY_NOW_POLL_TIMEOUT_MS)).toBe('waiting')
  })
  test('a failure is reported even past the bound', () => {
    expect(payNowReturnDecision('failed', PAY_NOW_POLL_TIMEOUT_MS + 1)).toBe('failed')
  })
})

describe('payNowReturnView copy', () => {
  test('paid / failed / waiting / canceled are honest and name no provider', () => {
    expect(payNowReturnView('paid').message).toBe('Payment received — your plan is active.')
    expect(payNowReturnView('failed').message).toBe("Your bank didn't confirm the payment. Nothing was charged.")
    expect(payNowReturnView('failed').retry).toBe(true)
    expect(payNowReturnView('waiting').message).toBe("We're waiting for your bank's confirmation.")
    expect(payNowReturnView('canceled').message).toBe('Payment cancelled. Nothing was charged.')
    for (const k of ['paid', 'failed', 'waiting', 'canceled', 'checking'] as const) {
      expect(payNowReturnView(k).message.toLowerCase()).not.toContain('mollie')
    }
  })
})
