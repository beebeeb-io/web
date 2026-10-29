/**
 * Task 2162 (web items 2-4): the pay-overdue return view, the softened intent-1 copy and the
 * 2106 P3 follow-ups.
 *
 * The server's POST /billing/pay-overdue answers { checkout_url, arrears_cents } (or
 * { checkout_url, reused: true }) and NO payment id, and the checkout returns to
 * ?paid_overdue=true for paid, failed and cancelled alike. So the return poll reads the
 * SUBSCRIPTION (the webhook's settlement flips past_due -> active); it cannot tell a decline from
 * a cancel, and says so.
 */
import { describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  PAY_OVERDUE_RETURN_PARAM,
  payOverdueReturnDecision,
  payOverdueReturnView,
  shouldHandlePayOverdueReturn,
} from '../src/lib/pay-overdue-return'
import { PAY_NOW_POLL_TIMEOUT_MS, routePayNowResult } from '../src/lib/trial-pay-now'
import {
  CONFIRM_OVERDUE_COPY,
  confirmPaymentBy,
  holdDateLabel,
} from '../src/lib/confirm-payment'
import { LiveNote } from '../src/components/live-note'

describe('pay-overdue return: poll the subscription, same bound as the 2092 pay-now return', () => {
  test('the param is paid_overdue=true and only that value is handled', () => {
    expect(PAY_OVERDUE_RETURN_PARAM).toBe('paid_overdue')
    expect(shouldHandlePayOverdueReturn('true')).toBe(true)
    expect(shouldHandlePayOverdueReturn('false')).toBe(false)
    expect(shouldHandlePayOverdueReturn(null)).toBe(false)
  })
  test('paid once the subscription is active and not frozen', () => {
    expect(payOverdueReturnDecision({ status: 'active', billing_state: 'active' }, 0)).toBe('paid')
    expect(payOverdueReturnDecision({ status: 'active' }, 0)).toBe('paid')
  })
  test('still past due or read-only: keep polling, then waiting at the bound (never failed)', () => {
    expect(payOverdueReturnDecision({ status: 'past_due', billing_state: 'grace' }, 1000)).toBe('keep_polling')
    expect(payOverdueReturnDecision({ status: 'past_due', billing_state: 'read_only' }, 1000)).toBe('keep_polling')
    expect(payOverdueReturnDecision({ status: 'active', billing_state: 'read_only' }, 1000)).toBe('keep_polling')
    expect(payOverdueReturnDecision(null, 1000)).toBe('keep_polling')
    expect(payOverdueReturnDecision({ status: 'past_due' }, PAY_NOW_POLL_TIMEOUT_MS)).toBe('waiting')
  })
  test('a paid answer wins even at the bound', () => {
    expect(payOverdueReturnDecision({ status: 'active' }, PAY_NOW_POLL_TIMEOUT_MS + 1)).toBe('paid')
  })
  test('views: checking, paid, waiting (Refresh + try again), honest about not knowing why', () => {
    expect(payOverdueReturnView('checking')).toMatchObject({ kind: 'checking', refresh: false, retry: false })
    expect(payOverdueReturnView('paid')).toMatchObject({ kind: 'paid', refresh: false, retry: false })
    const w = payOverdueReturnView('waiting')
    expect(w).toMatchObject({ kind: 'waiting', refresh: true, retry: true })
    expect(w.message).toContain('Nothing more is charged')
    expect(w.message.toLowerCase()).not.toContain('failed')
  })
})

describe('item 3: intent-1 copy is true for a plain decline too', () => {
  test('no claim about the card, offers the confirm step and the update alternative', () => {
    expect(CONFIRM_OVERDUE_COPY).not.toContain('Nothing is wrong')
    expect(CONFIRM_OVERDUE_COPY.toLowerCase()).toContain('did not go through')
    expect(CONFIRM_OVERDUE_COPY.toLowerCase()).toContain('update your payment method')
  })
})

describe('item 4: refused checkout_url is an error, not "settled"', () => {
  test('an http / foreign checkout_url never falls through to the paid path', () => {
    const r = routePayNowResult({ payment_id: 'tr_1', status: 'open', checkout_url: 'http://evil.example/x' })
    expect(r.kind).toBe('inline')
    if (r.kind === 'inline') {
      expect(r.state.phase).toBe('error')
      expect(r.state.message).toBeTruthy()
    }
  })
  test('no checkout_url at all (older server) keeps the settled behaviour', () => {
    const r = routePayNowResult({ payment_id: 'tr_2', status: 'paid' })
    expect(r).toEqual({ kind: 'inline', state: { phase: 'settled', paymentId: 'tr_2' } })
  })
})

describe('item 4: the hold-date formatter after cancelling', () => {
  const END_OF_HOLD = '2026-10-25T22:59:59Z' // 23:59:59 Amsterdam on the 25th
  test('a held row uses the Amsterdam day', () => {
    expect(holdDateLabel(END_OF_HOLD, true, () => 'LOCAL')).toBe('25 Oct 2026')
  })
  test('a cancelled held trial (no confirm_payment_by any more) still shows the Amsterdam day', () => {
    expect(holdDateLabel(END_OF_HOLD, false, () => 'LOCAL')).toBe('25 Oct 2026')
  })
  test('an ordinary trial end keeps the page formatter', () => {
    expect(holdDateLabel('2026-10-13T09:12:44Z', false, () => 'LOCAL')).toBe('LOCAL')
    expect(holdDateLabel(null, true, () => 'LOCAL')).toBe('LOCAL')
  })
})

describe('confirmPaymentBy follows the server hold until the server clears it', () => {
  const now = Date.parse('2026-10-26T00:00:00Z')
  test('past, equal, and future deadlines remain held while the server sends the field', () => {
    const clock = spyOn(Date, 'now').mockReturnValue(now)
    try {
      // Server trial::confirm_payment_hold_sql checks an unfinished lapse job, not wall time.
      for (const at of [now - 1, now, now + 1]) {
        const deadline = new Date(at).toISOString()
        expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: deadline })).toBe(deadline)
      }
      expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: null })).toBeNull()
      expect(confirmPaymentBy({ status: 'cancelled', confirm_payment_by: '2026-10-25T22:59:59Z' })).toBeNull()
    } finally {
      clock.mockRestore()
    }
  })
})

describe('item 4: a live region that exists before its text changes', () => {
  test('LiveNote renders the role=status element even with no text', () => {
    const empty = renderToStaticMarkup(createElement(LiveNote, { text: null }))
    expect(empty).toContain('role="status"')
    expect(empty).not.toContain('data-testid')
    const full = renderToStaticMarkup(createElement(LiveNote, { text: 'hello', testId: 'n' }))
    expect(full).toContain('role="status"')
    expect(full).toContain('hello')
    expect(full).toContain('data-testid="n"')
  })
})

describe('item 4: markup rules on the held card (source pins)', () => {
  const src = fs.readFileSync(`${import.meta.dir}/../src/pages/billing.tsx`, 'utf8')
  const card = src.slice(src.indexOf('data-testid="billing-trial-confirm"') - 200, src.indexOf('data-testid="billing-trial-confirm"') + 200)
  test('the held card Cancel button has type="button"', () => {
    const i = src.indexOf('data-testid="billing-trial-cancel"')
    const open = src.lastIndexOf('<button', i)
    expect(src.slice(open, i)).toContain('type="button"')
  })
  test('the held card uses the neutral card style, not the amber background', () => {
    expect(card).toContain('border-line bg-paper-2')
    expect(card).not.toContain('bg-amber-bg')
  })
})
