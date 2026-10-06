/**
 * Task 1757 — the no-card trial on the web (server task 1755). Pure decisions and the
 * drawn components, from the vendored contract fixtures (no jsdom: server-side render).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@beebeeb/shared'
import { NoCardTrialStatusCard, TrialEndedCard, TrialStartCard, TrialUnavailableNote } from '../src/components/no-card-trial'
import {
  accountStateFromError,
  trialEndedUploadNotice,
  uploadRefusalNotice,
  PAID_CHECKOUT_PATH,
} from '../src/lib/account-state'
import {
  isTypedRefusal,
  noCardTrialStatus,
  shareRefusalCopy,
  startTrialErrorCopy,
  trialBillingRefusalCopy,
  trialCapShortfallNotice,
  trialEndedAllowanceNotice,
  trialEndedStatus,
  trialOfferView,
  trialUnavailableCopy,
} from '../src/lib/no-card-trial'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import type { OnboardingDocument } from '../src/lib/onboarding/types'
import { userFriendlyError } from '../src/lib/user-friendly-error'
import { fixtureJson } from './helpers/onboarding-fixtures'

function doc(name: string, mutate?: (d: Record<string, any>) => void): OnboardingDocument {
  const raw = fixtureJson(name)
  mutate?.(raw)
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error(`fixture ${name} did not parse: ${r.reason}`)
  return r.doc
}

const render = (el: React.ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))

describe('the offer comes from the document, not from a guess', () => {
  test('web allowance: available, with the document\'s length, cap and allowance', () => {
    const v = trialOfferView(doc('account.allowance.web.json'))
    expect(v).toEqual({
      kind: 'available',
      lengthDays: 14,
      capBytes: 10_000_000_000,
      startEndpoint: '/api/v1/billing/trial/start',
      allowanceBytes: 2_000_000_000,
    })
  })

  test('each unavailable reason has its own honest sentence, with the allowance named', () => {
    const reasons = ['already_used', 'email_unverified', 'temporarily_unavailable', 'not_offered_here']
    const seen = new Set<string>()
    for (const reason of reasons) {
      const v = trialOfferView(
        doc('account.allowance.web.json', (d) => {
          d.offers.trial = { ...d.offers.trial, available: false, unavailable_reason: reason }
        }),
      )
      expect(v?.kind).toBe('unavailable')
      if (v?.kind === 'unavailable') {
        expect(v.reason).toBe(reason)
        seen.add(v.message)
      }
    }
    expect(seen.size).toBe(4)
    expect(trialUnavailableCopy('temporarily_unavailable', 2_000_000_000)).toBe(
      'We are not starting new trials right now. Your 2 GB stays.',
    )
  })

  test('money fails closed: no purchase permission, no offer, no pre-account document -> nothing', () => {
    expect(trialOfferView(doc('account.allowance.ios.json'))).toBeNull()
    expect(
      trialOfferView(
        doc('account.allowance.web.json', (d) => {
          d.purchase.cta_allowed = false
        }),
      ),
    ).toBeNull()
    // The parser already drops the offer when no call to action is allowed; the view checks
    // again on its own (defense in depth), so an offer smuggled past the parser still draws nothing.
    const smuggled = doc('account.allowance.web.json')
    expect(trialOfferView(smuggled)?.kind).toBe('available')
    expect(trialOfferView({ ...smuggled, purchase: { ...smuggled.purchase!, ctaAllowed: false } })).toBeNull()
    expect(trialOfferView(doc('account.active.web.json'))).toBeNull()
    expect(trialOfferView(doc('pre_account.web.json'))).toBeNull()
    expect(trialOfferView(null)).toBeNull()
  })
})

describe('every refusal of starting a trial has its own words', () => {
  const api = (status: number, code: string, message = 'x') => new ApiError(message, status, code)
  const cases: Array<[string, unknown, RegExp]> = [
    ['trial_temporarily_unavailable', api(409, 'trial_temporarily_unavailable'), /not starting new trials right now\. Your 2 GB stays\./],
    ['trial_already_used', api(409, 'trial_already_used'), /already had your trial/],
    ['trial_previously_subscribed', api(409, 'trial_previously_subscribed'), /never subscribed\. Choose a plan/],
    ['trial_has_active_subscription', api(409, 'trial_has_active_subscription'), /already have a plan/],
    ['email_unverified', api(403, 'email_unverified'), /Confirm your email address/],
    ['trial_checkout_retired', api(409, 'trial_checkout_retired'), /no longer need a card/],
    ['429', api(429, 'rate_limit_exceeded', 'Rate limited — try again in 3 hours'), /Too many trials.*Your 2 GB stays\. Try again in 3 hours\./],
    ['429 without a wait', api(429, 'rate_limit_exceeded', 'Rate limited — please wait'), /Try again later\./],
    ['an onboarding-port 429', Object.assign(new Error('x'), { code: 'rate_limited' }), /Too many trials/],
    ['400 plan', api(400, 'bad_request'), /cannot be tried/],
  ]
  for (const [name, err, re] of cases) {
    test(name, () => expect(startTrialErrorCopy(err, 2_000_000_000)).toMatch(re))
  }

  test('anything else says nothing was charged and files are unchanged, never "something went wrong"', () => {
    const t = startTrialErrorCopy(new Error('boom'))
    expect(t).toContain('Nothing was charged')
    expect(t).not.toMatch(/something went wrong/i)
  })

  test('none of the refusals mentions a card, a payment method or authorization', () => {
    for (const [, err] of cases) expect(startTrialErrorCopy(err, 2_000_000_000)).not.toMatch(/authoriz|payment method|iDEAL/i)
  })
})

describe('the running trial: end date, days left, cap meter, what the end means', () => {
  const NOW = Date.parse('2026-10-10T09:00:00Z')

  test('trialing_no_card fixture', () => {
    const s = noCardTrialStatus(doc('account.trialing_no_card.desktop.json'), NOW, 'UTC')
    expect(s).not.toBeNull()
    expect(s?.endsOn).toBe('18 Oct 2026')
    expect(s?.daysLeft).toBe(8)
    expect(s?.daysLeftLabel).toBe('8 days left')
    expect(s?.capBytes).toBe(10_000_000_000)
    expect(s?.usedBytes).toBe(6_300_000_000)
    expect(s?.fraction).toBeCloseTo(0.63, 2)
    expect(s?.atCap).toBe(false)
    // The server's sentence wins over client wording.
    expect(s?.consequence).toBe(
      'Your trial ends on 18 Oct. Files above 2 GB become read-only and are deleted 14 days later unless you subscribe or free up space.',
    )
    expect(s?.sharingNote).toBe('You can keep up to 5 share links active during the trial.')
  })

  test('without server copy and within the allowance: the allowance stays, nothing is charged', () => {
    const s = noCardTrialStatus(
      doc('account.trialing_no_card.desktop.json', (d) => {
        delete d.copy
        d.account.storage.used_bytes = 100_000_000
        d.account.storage.over_allowance = false
      }),
      NOW,
    )
    expect(s?.consequence).toBe('When it ends, your 2 GB stays. Nothing is charged.')
  })

  test('without server copy and over the allowance: the part that hurts is said', () => {
    const s = noCardTrialStatus(
      doc('account.trialing_no_card.desktop.json', (d) => {
        delete d.copy
      }),
      NOW,
    )
    expect(s?.consequence).toBe('When it ends, files above 2 GB become read-only. Nothing is charged.')
  })

  test('the meter and the sentence follow the drive\'s live usage, not the stale document', () => {
    // The document was fetched with 100 MB used (within the allowance, no server sentence).
    const fetched = doc('account.trialing_no_card.desktop.json', (d) => {
      delete d.copy
      d.account.storage.used_bytes = 100_000_000
      d.account.storage.over_allowance = false
    })
    expect(noCardTrialStatus(fetched, NOW, 'UTC')?.consequence).toBe('When it ends, your 2 GB stays. Nothing is charged.')
    // Then the person uploaded 4 GB: the live figure says over the allowance.
    const live = noCardTrialStatus(fetched, NOW, 'UTC', 4_100_000_000)
    expect(live?.usedBytes).toBe(4_100_000_000)
    expect(live?.fraction).toBeCloseTo(0.41, 2)
    expect(live?.overAllowance).toBe(true)
    expect(live?.consequence).toBe('When it ends, files above 2 GB become read-only. Nothing is charged.')
    // The server's sentence is used only while it still describes the account.
    const withCopy = doc('account.trialing_no_card.desktop.json')
    expect(noCardTrialStatus(withCopy, NOW, 'UTC', 6_300_000_000)?.consequence).toContain('Your trial ends on 18 Oct.')
    expect(noCardTrialStatus(withCopy, NOW, 'UTC', 500_000_000)?.consequence).toBe('When it ends, your 2 GB stays. Nothing is charged.')
  })

  test('sharing during the trial is honest in both directions', () => {
    const paused = noCardTrialStatus(
      doc('account.trialing_no_card.desktop.json', (d) => {
        d.account.capabilities.share = { allowed: false, reason: 'plan_required' }
      }),
      NOW,
    )
    expect(paused?.sharingNote).toBe('Sharing starts with a plan. Your trial keeps your files private.')
  })

  test('1 day left, today, and at the cap', () => {
    const d = doc('account.trialing_no_card.desktop.json', (x) => {
      x.account.storage.used_bytes = 10_000_000_000
    })
    expect(noCardTrialStatus(d, Date.parse('2026-10-17T10:00:00Z'))?.daysLeftLabel).toBe('1 day left')
    expect(noCardTrialStatus(d, Date.parse('2026-10-19T10:00:00Z'))?.daysLeftLabel).toBe('Ends today')
    expect(noCardTrialStatus(d, NOW)?.atCap).toBe(true)
  })

  test('only a no-card trial is this status', () => {
    expect(noCardTrialStatus(doc('account.trialing.desktop.json'))).toBeNull()
    expect(noCardTrialStatus(doc('account.allowance.web.json'))).toBeNull()
    expect(noCardTrialStatus(null)).toBeNull()
  })
})

describe('the trial that ended', () => {
  const overWeb = (d: Record<string, any>) => {
    d.purchase = { surface: 'in_page', cta_allowed: true, price_visibility: 'full', methods: ['ideal'] }
  }

  test('over the allowance: server sentence, deletion date, how much to free, that the trash counts', () => {
    const s = trialEndedStatus(doc('account.trial_ended.ios.json'), 'UTC')
    expect(s?.deletionDay).toBe('1 Nov 2026')
    expect(s?.body).toBe('Your trial ended. Files above 2 GB are read-only and will be deleted on 1 Nov unless you free up space.')
    expect(s?.overByBytes).toBe(4_300_000_000)
    expect(s?.trimGuidance).toContain('Free up 4.3 GB')
    expect(s?.trimGuidance).toContain('Trash')
    expect(s?.trimGuidance).toContain('still count')
    // iOS: no purchase call to action, so no Subscribe.
    expect(s?.canSubscribe).toBe(false)
    expect(trialEndedStatus(doc('account.trial_ended.ios.json', overWeb))?.canSubscribe).toBe(true)
  })

  test('only the trial_ended state', () => {
    expect(trialEndedStatus(doc('account.allowance.web.json'))).toBeNull()
    expect(trialEndedStatus(doc('account.lapsed.ios.json'))).toBeNull()
  })

  test('under the allowance the document says allowance; the one-time notice needs the account\'s own used-trial flag', () => {
    const allowance = doc('account.allowance.web.json')
    expect(trialEndedAllowanceNotice(allowance, true)?.body).toContain('Your 2 GB stays.')
    expect(trialEndedAllowanceNotice(allowance, true)?.body).toContain('Nothing was charged')
    expect(trialEndedAllowanceNotice(allowance, false)).toBeNull()
    expect(trialEndedAllowanceNotice(allowance, undefined)).toBeNull()
    expect(trialEndedAllowanceNotice(doc('account.trialing_no_card.desktop.json'), true)).toBeNull()
  })

  test('the upload notice carries the guidance and the way out', () => {
    const n = trialEndedUploadNotice(trialEndedStatus(doc('account.trial_ended.ios.json')))
    expect(n.title).toBe('Your trial has ended')
    expect(n.description).toContain('Trash')
    expect(n.href).toBe(PAID_CHECKOUT_PATH)
    expect(trialEndedUploadNotice(null).description).toContain('the trash counts')
  })
})

describe('refusals while uploading, sharing, cancelling', () => {
  const cap = (message: string, extra: Record<string, unknown> = {}) =>
    new ApiError(message, 413, 'quota_exceeded', { error: 'quota_exceeded', limit_bytes: 10_000_000_000, used_bytes: 10_000_000_000, is_trial_cap: true, ...extra })

  test('the trial-cap 413 names the cap it came with (10 GB, not 25) and a no-card trial subscribes at checkout', () => {
    const msg = "You've reached the 10 GB trial storage cap. Subscribe to unlock your full plan storage."
    const n = uploadRefusalNotice(cap(msg), { noCardTrial: true })
    expect(n?.title).toBe('10 GB trial cap reached')
    expect(n?.description).toBe(msg)
    expect(n?.href).toBe(PAID_CHECKOUT_PATH)
    // The mandated trial keeps "pay now" on /billing.
    const mandated = uploadRefusalNotice(cap("You've reached the 25 GB trial storage cap. Pay now to unlock your full plan storage.", { limit_bytes: 25_000_000_000 }))
    expect(mandated?.title).toBe('25 GB trial cap reached')
    expect(mandated?.href).toBe('/billing')
  })

  test('userFriendlyError keeps the server\'s no-card cap sentence (86 characters, past the generic 80 cutoff)', () => {
    const msg = "You've reached the 10 GB trial storage cap. Subscribe to unlock your full plan storage."
    expect(msg.length).toBeGreaterThan(80)
    expect(userFriendlyError(cap(msg))).toBe(msg)
    expect(userFriendlyError(new ApiError('over', 413, 'quota_exceeded', { is_trial_cap: false }))).toContain('Storage full')
  })

  test('trial_ended is a lapsed-style refusal with its own words', () => {
    const err = new ApiError('x', 409, 'trial_ended')
    expect(accountStateFromError(err)).toBe('lapsed')
    expect(userFriendlyError(err)).toContain('free up space (the trash counts)')
  })

  test('sharing during the trial: paused, or the five-link limit', () => {
    const paused = new ApiError('x', 409, 'trial_sharing_unavailable')
    const limit = new ApiError('x', 409, 'trial_share_limit_reached')
    expect(userFriendlyError(paused)).toBe('Sharing starts with a plan. Your trial keeps your files private.')
    expect(userFriendlyError(limit)).toBe('A trial can hold 5 active share links. Revoke one, or choose a plan for more.')
    expect(shareRefusalCopy(paused)).not.toBeNull()
    expect(shareRefusalCopy(new Error('x'))).toBeNull()
  })

  test('a typed refusal is never retried as a share-token collision', () => {
    for (const code of ['trial_sharing_unavailable', 'trial_share_limit_reached', 'plan_required', 'account_lapsed', 'trial_ended']) {
      expect(isTypedRefusal(new ApiError('x', 409, code))).toBe(true)
    }
    // A bare 409 (the token collision) and other errors are not typed refusals.
    expect(isTypedRefusal(new ApiError('collision', 409))).toBe(false)
    expect(isTypedRefusal(new ApiError('x', 409, 'something_else'))).toBe(false)
    expect(isTypedRefusal(new Error('x'))).toBe(false)
  })

  test('billing actions that do not apply to a trial without a card', () => {
    expect(trialBillingRefusalCopy(new ApiError('x', 409, 'no_subscription_to_cancel'))).toContain('nothing to cancel and nothing will be charged')
    expect(userFriendlyError(new ApiError('x', 409, 'no_subscription_to_cancel'))).toContain('nothing to cancel')
    expect(userFriendlyError(new ApiError('x', 409, 'trial_convert_unavailable'))).toContain('choose a plan and pay at checkout')
    expect(userFriendlyError(new ApiError('x', 409, 'trial_checkout_retired'))).toContain('no longer need a card')
  })

  test('every typed start refusal reaches the user as its own sentence, not "something went wrong"', () => {
    for (const code of ['trial_temporarily_unavailable', 'trial_already_used', 'trial_previously_subscribed', 'trial_has_active_subscription']) {
      const t = userFriendlyError(new ApiError('x', 409, code))
      expect(t).not.toMatch(/something went wrong|permission/i)
    }
  })

  test('the client pre-flight at the cap says the cap, the room left, and to subscribe', () => {
    const s = noCardTrialStatus(doc('account.trialing_no_card.desktop.json'))
    const n = trialCapShortfallNotice(s, 5_000_000_000, 3_700_000_000)
    expect(n?.title).toBe('10 GB trial cap reached')
    expect(n?.description).toBe("This upload needs 5 GB but your trial has 3.7 GB left of its 10 GB cap. Subscribe to unlock your plan's storage.")
    expect(n?.href).toBe(PAID_CHECKOUT_PATH)
    expect(trialCapShortfallNotice(null, 1, 0)).toBeNull()
  })
})

describe('the drawn components', () => {
  const available = trialOfferView(doc('account.allowance.web.json'))
  if (available?.kind !== 'available') throw new Error('fixture')

  test('start card: the button says no card, the terms name the cap and the allowance, nothing asks for payment', () => {
    const html = render(createElement(TrialStartCard, { offer: available, onStart: async () => {} }))
    expect(html).toContain('Start 14-day trial, no card')
    expect(html).toContain('data-testid="start-trial"')
    expect(html).toContain('Up to 10 GB for 14 days. No card, nothing to cancel. When it ends, your 2 GB stays.')
    expect(html).toContain('data-testid="trial-plan-picker"')
    expect(html).toContain('Nothing is billed.')
    expect(html).toContain('if you subscribe')
    expect(html).not.toMatch(/iDEAL|authoriz|Mollie|payment method|trial-method-picker|then billed/i)
  })

  test('unavailable note: the reason in words, with a way forward except when the email is unconfirmed', () => {
    const v = trialOfferView(
      doc('account.allowance.web.json', (d) => {
        d.offers.trial = { ...d.offers.trial, available: false, unavailable_reason: 'temporarily_unavailable' }
      }),
    )
    if (v?.kind !== 'unavailable') throw new Error('fixture')
    const html = render(createElement(TrialUnavailableNote, { offer: v }))
    expect(html).toContain('data-testid="trial-unavailable"')
    expect(html).toContain('We are not starting new trials right now. Your 2 GB stays.')
    expect(html).toContain('See plans')
    expect(render(createElement(TrialUnavailableNote, { offer: { ...v, reason: 'email_unverified' } }))).not.toContain('See plans')
  })

  test('the running-trial banner: end date, days left, meter, consequence; Subscribe only where a purchase is allowed', () => {
    const s = noCardTrialStatus(doc('account.trialing_no_card.desktop.json'), Date.parse('2026-10-10T09:00:00Z'), 'UTC')!
    const html = render(createElement(NoCardTrialStatusCard, { status: s, canSubscribe: true, variant: 'banner' }))
    expect(html).toContain('data-testid="trial-banner-no-card"')
    expect(html).toContain('18 Oct 2026')
    expect(html).toContain('8 days left')
    expect(html).toContain('6.3 GB of 10 GB')
    expect(html).toContain('data-testid="trial-consequence"')
    expect(html).toContain('data-testid="trial-subscribe"')
    expect(html).not.toMatch(/Add payment method|automatically|charged on/i)
    expect(render(createElement(NoCardTrialStatusCard, { status: s, canSubscribe: false, variant: 'banner' }))).not.toContain('trial-subscribe')
    const panel = render(createElement(NoCardTrialStatusCard, { status: s, canSubscribe: true, variant: 'panel' }))
    expect(panel).toContain('data-testid="billing-no-card-trial"')
    expect(panel).toContain('nothing to cancel')
  })

  test('the ended banner: body, trim guidance with the trash, Subscribe only with a purchase surface', () => {
    const s = trialEndedStatus(doc('account.trial_ended.ios.json', (d) => {
      d.purchase = { surface: 'in_page', cta_allowed: true, price_visibility: 'full', methods: ['ideal'] }
    }), 'UTC')!
    const html = render(createElement(TrialEndedCard, { status: s, variant: 'banner' }))
    expect(html).toContain('data-testid="trial-ended-banner"')
    expect(html).toContain('deleted on 1 Nov')
    expect(html).toContain('Trash')
    expect(html).toContain('data-testid="trial-ended-subscribe"')
    const ios = trialEndedStatus(doc('account.trial_ended.ios.json'), 'UTC')!
    expect(render(createElement(TrialEndedCard, { status: ios, variant: 'banner' }))).not.toContain('trial-ended-subscribe')
  })
})
