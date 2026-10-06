/**
 * Task 1837 — the plan chooser after web signup, with NO entry allowance (prod switched
 * it off on 2026-10-06). Pure decisions and drawn pieces, from the vendored fixtures.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@beebeeb/shared'
import { TrialEndedCard, TrialStartCard, trialTermsLine } from '../src/components/no-card-trial'
import {
  NEVER_PAID_RETENTION_DAYS,
  cardTrialView,
  effectiveCardMethod,
  effectiveTrialDays,
  noCardTrialStatus,
  startTrialErrorCopy,
  trialEndedStatus,
  trialOfferView,
  trialUnavailableCopy,
} from '../src/lib/no-card-trial'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { planScreen, unsupportedAccountSteps } from '../src/lib/onboarding/plan'
import type { OnboardingDocument } from '../src/lib/onboarding/types'
import { fixtureJson } from './helpers/onboarding-fixtures'

function doc(name: string, mutate?: (d: Record<string, any>) => void): OnboardingDocument {
  const raw = fixtureJson(name)
  mutate?.(raw)
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error(`fixture ${name} did not parse: ${r.reason}`)
  return r.doc
}

const render = (el: React.ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))

/** A verified, plan-less web account: a no-card offer, and (optionally) the card trial advertised. */
const NO_PLAN = (opts: { noCard?: boolean | 'unavailable'; card?: boolean | Record<string, unknown> } = {}) =>
  doc('account.needs_plan.web.coupon.json', (d) => {
    delete d.offers.coupon
    d.steps = d.steps.filter((s: any) => s.id !== 'redeem_coupon')
    const choose = d.steps.find((s: any) => s.id === 'choose_plan')
    if (opts.card) {
      choose.params = {
        card_trial:
          typeof opts.card === 'object'
            ? opts.card
            : { length_days: 14, methods: ['creditcard', 'ideal'], checkout_endpoint: '/api/v1/billing/trial/checkout' },
      }
    }
    if (opts.noCard) {
      d.offers.trial = {
        available: opts.noCard === true,
        unavailable_reason: opts.noCard === true ? null : 'temporarily_unavailable',
        length_days: 14,
        cap_bytes: 10_000_000_000,
        start_endpoint: '/api/v1/billing/trial/start',
      }
      if (opts.noCard === true) {
        d.steps.push({
          id: 'start_trial',
          status: 'todo',
          required: false,
          ui: 'action',
          params: { length_days: 14, cap_bytes: 10_000_000_000, no_card: true },
        })
      }
    }
    if (!d.offers.trial) delete d.offers
  })

describe('1837 choose_plan is drawn by its own route, not "unsupported"', () => {
  test('a required choose_plan produces no "cannot show yet" step and no unsupported entry', () => {
    const d = NO_PLAN({ noCard: true })
    expect(d.steps.find((s) => s.id === 'choose_plan')?.required).toBe(true)
    expect(unsupportedAccountSteps(d)).toEqual([])
    const s = planScreen(d)
    expect(s.kind).toBe('account')
    if (s.kind === 'account') {
      expect(s.unsupported).toEqual([])
      expect(s.actions.map((a) => a.step.id)).toEqual(['choose_plan', 'start_trial'])
    }
  })

  test('an unknown required step is still unsupported (the routed list is not a loophole)', () => {
    const d = NO_PLAN({ noCard: true })
    d.steps.push({ id: 'verify_identity', status: 'todo', required: true, ui: 'action', params: {}, fallback: null })
    expect(unsupportedAccountSteps(d)).toEqual(['verify_identity'])
  })
})

describe('1837 the card trial the server advertises', () => {
  test('present, with its length and methods', () => {
    expect(cardTrialView(NO_PLAN({ noCard: true, card: true }))).toEqual({
      lengthDays: 14,
      methods: ['creditcard', 'ideal'],
    })
  })

  test('absent, malformed or unknown methods draw nothing; so does a document without a purchase surface', () => {
    expect(cardTrialView(NO_PLAN({ noCard: true }))).toBeNull()
    expect(cardTrialView(NO_PLAN({ noCard: true, card: { length_days: 0, methods: ['ideal'] } }))).toBeNull()
    expect(cardTrialView(NO_PLAN({ noCard: true, card: { length_days: 14, methods: ['paypal'] } }))).toBeNull()
    expect(cardTrialView(NO_PLAN({ noCard: true, card: { length_days: 14 } }))).toBeNull()
    expect(cardTrialView(NO_PLAN({ noCard: true, card: { length_days: 14, methods: ['ideal', 'bitcoin'] } }))?.methods).toEqual(['ideal'])
    const noCta = NO_PLAN({ noCard: true, card: true })
    expect(cardTrialView({ ...noCta, purchase: { ...noCta.purchase!, ctaAllowed: false } })).toBeNull()
    expect(cardTrialView(null)).toBeNull()
  })
})

describe('1840 round 2: the advertised card trial is authoritative', () => {
  const ideal7 = cardTrialView(NO_PLAN({ noCard: true, card: { length_days: 7, methods: ['ideal'] } }))
  const both14 = cardTrialView(NO_PLAN({ noCard: true, card: true }))

  test('a method the server does not advertise is repaired to one it does', () => {
    expect(effectiveCardMethod(ideal7, 'creditcard')).toBe('ideal')
    expect(effectiveCardMethod(both14, 'creditcard')).toBe('creditcard')
    expect(effectiveCardMethod(both14, 'ideal')).toBe('ideal')
    // No card trial advertised: the picker owns the choice, untouched.
    expect(effectiveCardMethod(null, 'creditcard')).toBe('creditcard')
  })

  test('the card trial length beats the plan trial_days; without one the plan decides', () => {
    expect(effectiveTrialDays(ideal7, 14)).toBe(7)
    expect(effectiveTrialDays(both14, 30)).toBe(14)
    expect(effectiveTrialDays(null, 14)).toBe(14)
  })
})

describe('1837 no allowance, no promise that anything stays', () => {
  test('the offer carries no allowance and the terms say what the end does', () => {
    const v = trialOfferView(NO_PLAN({ noCard: true }))
    expect(v?.kind).toBe('available')
    if (v?.kind !== 'available') return
    expect(v.allowanceBytes).toBeNull()
    const line = trialTermsLine(v)
    expect(line).toBe(
      `Up to 10 GB for 14 days. No card, nothing to cancel. If you do not choose a plan by then, your files become read-only and are deleted ${NEVER_PAID_RETENTION_DAYS} days after it ends.`,
    )
    expect(NEVER_PAID_RETENTION_DAYS).toBe(14)
    // An allowance of 0 is none: it must never print "Your 0 B stays".
    const zero = trialTermsLine({ ...v, allowanceBytes: 0 })
    expect(zero).toBe(line)
    expect(zero).not.toMatch(/stays|allowance|0 B/i)
  })

  test('with an allowance the sentence is what it was', () => {
    const v = trialOfferView(doc('account.allowance.web.json'))
    if (v?.kind !== 'available') throw new Error('fixture')
    expect(trialTermsLine(v)).toBe('Up to 10 GB for 14 days. No card, nothing to cancel. When it ends, your 2 GB stays.')
  })

  test('refusals and the unavailable reason do not name an allowance that is not there', () => {
    const api = (status: number, code: string, message = 'x') => new ApiError(message, status, code)
    for (const a of [null, 0, undefined]) {
      const copy = [
        trialUnavailableCopy('temporarily_unavailable', a),
        startTrialErrorCopy(api(409, 'trial_temporarily_unavailable'), a),
        startTrialErrorCopy(api(409, 'trial_requires_payment_method'), a),
        startTrialErrorCopy(api(429, 'rate_limit_exceeded', 'Rate limited — try again in 3 hours'), a),
      ]
      for (const c of copy) expect(c).not.toMatch(/stays|allowance/i)
      expect(copy[0]).toBe('We are not starting new trials right now. You can still subscribe to a plan.')
      expect(copy[3]).toContain('Try again in 3 hours.')
    }
  })

  test('the running trial says read-only then deleted, from the server copy when it sent one', () => {
    const base = doc('account.trialing_no_card.desktop.json', (d) => {
      delete d.account.storage.allowance_bytes
      delete d.account.storage.over_allowance
      d.copy = {}
    })
    const s = noCardTrialStatus(base, Date.parse('2026-10-10T09:00:00Z'), 'UTC')!
    expect(s.allowanceBytes).toBeNull()
    expect(s.consequence).toBe(
      'When it ends, your files become read-only and are deleted 14 days later unless you choose a plan. Nothing is charged.',
    )
    const served = doc('account.trialing_no_card.desktop.json', (d) => {
      delete d.account.storage.allowance_bytes
      delete d.account.storage.over_allowance
      d.copy = { trial_end_no_allowance: 'Server sentence.' }
    })
    expect(noCardTrialStatus(served, Date.parse('2026-10-10T09:00:00Z'), 'UTC')!.consequence).toBe('Server sentence.')
  })

  test('the ended trial: read-only, a date, no "free up space", no allowance', () => {
    const ended = doc('account.trial_ended.ios.json', (d) => {
      delete d.account.storage.allowance_bytes
      delete d.account.storage.over_allowance
      d.copy = {}
      d.purchase = { surface: 'in_page', cta_allowed: true, price_visibility: 'full', methods: ['ideal'] }
    })
    const s = trialEndedStatus(ended, 'UTC')!
    expect(s.allowanceBytes).toBeNull()
    expect(s.overByBytes).toBeNull()
    expect(s.body).toBe('Your trial ended. Your files are read-only and will be deleted on 1 Nov 2026 unless you choose a plan.')
    expect(`${s.body} ${s.trimGuidance}`).not.toMatch(/allowance|free up|stays/i)
    const html = render(createElement(TrialEndedCard, { status: s, variant: 'panel' }))
    expect(html).toContain('Read-only</div>')
    expect(html).not.toContain('above your allowance')
    // Without a purchase surface the sentence points at no purchase.
    const ios = trialEndedStatus(doc('account.trial_ended.ios.json', (d) => {
      delete d.account.storage.allowance_bytes
      d.copy = {}
    }), 'UTC')!
    expect(ios.body).not.toMatch(/plan/)
  })
})

describe('1837 the start card with no allowance', () => {
  test('says what happens, never "stays"', () => {
    const v = trialOfferView(NO_PLAN({ noCard: true }))
    if (v?.kind !== 'available') throw new Error('fixture')
    const html = render(createElement(TrialStartCard, { offer: v, onStart: async () => {} }))
    expect(html).toContain('deleted 14 days after it ends')
    expect(html).not.toMatch(/stays|0 B/)
  })
})
