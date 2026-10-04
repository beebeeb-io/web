import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { OnboardingRenderer } from '../src/components/onboarding/renderer'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { coreCeremonyPorts, type OnboardingPorts } from '../src/lib/onboarding/ports'
import { fixtureFiles, fixtureJson } from './helpers/onboarding-fixtures'

/**
 * Task 1745 — every vendored fixture renders without crashing, and the FIRST
 * screen the planner picks is the one we expect. Server-side render: this repo
 * has no jsdom (see test/1517-trial-cta-decision.test.ts), so effects do not
 * run; that is fine for "does the tree draw" and the screen marker. The
 * interactive paths (ceremony, typing) are covered by the Playwright spec.
 */

const ports: OnboardingPorts = {
  actions: {
    emailStart: async () => {},
    emailVerify: async () => ({ ticket: 't' }),
    registerStart: async () => new Uint8Array(),
    registerFinish: async () => ({ userId: 'u' }),
    verifyEmail: async () => {},
    startTrial: async () => {},
    refresh: async () => {},
  },
  ceremony: coreCeremonyPorts,
  fetchBreachBody: async () => null,
  onAccountCreated: async () => {},
}

function html(name: string, initialCompleted?: string[], mutate?: (d: Record<string, any>) => void): string {
  const raw = fixtureJson(name)
  mutate?.(raw)
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error('fixture did not parse')
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(OnboardingRenderer, { doc: r.doc, ports, initialCompleted })),
  )
}

function screenOf(markup: string): string | null {
  const m = markup.match(/data-testid="onboarding-screen" data-screen="([^"]+)"/)
  return m ? m[1] : null
}

/** What the first screen of each fixture must be. */
const EXPECTED: Record<string, string> = {
  'account.active.web.json': 'account:active',
  'account.allowance.desktop.json': 'account:allowance',
  'account.allowance.ios.json': 'account:allowance',
  'account.allowance.web.json': 'account:allowance',
  'account.frozen.desktop.json': 'account:frozen',
  'account.lapsed.ios.json': 'account:lapsed',
  'account.legacy_free.web.json': 'account:legacy_free',
  'account.needs_plan.ios.json': 'step:verify_email',
  'account.past_due.web.json': 'account:past_due',
  'account.read_only.web.json': 'account:read_only',
  'account.trial_cancelling.web.json': 'account:trial_cancelling',
  'account.trial_ended.ios.json': 'account:trial_ended',
  'account.trialing.desktop.json': 'account:trialing',
  'account.trialing_no_card.desktop.json': 'account:trialing_no_card',
  'client.update_required.ios.json': 'update_required',
  'forward_compat.unknown_step.ios.json': 'step:enter_email',
  'pre_account.desktop.json': 'step:enter_email',
  'pre_account.ios.json': 'step:enter_email',
  'pre_account.web.json': 'step:enter_email',
}

describe('every fixture renders', () => {
  const files = fixtureFiles()
  test('the expectation table covers exactly the 19 vendored fixtures', () => {
    expect(files.length).toBe(19)
    expect(Object.keys(EXPECTED).sort()).toEqual(files)
  })

  for (const f of files) {
    test(`${f} draws the ${EXPECTED[f]} screen`, () => {
      const markup = html(f)
      expect(markup.length).toBeGreaterThan(200)
      expect(screenOf(markup)).toBe(EXPECTED[f])
    })
  }
})

describe('what the screens say (fixtures B to E, spec 5.4)', () => {
  test('iOS allowance and trial_ended draw no purchase affordance at all (0 links to billing, 0 trial buttons)', () => {
    for (const f of ['account.allowance.ios.json', 'account.trial_ended.ios.json']) {
      const m = html(f)
      expect(m).not.toContain('/billing')
      expect(m).not.toContain('start-trial')
      expect(m).not.toContain('step-start_trial')
      expect(m).not.toContain('step-choose_plan')
    }
  })

  test('a misbehaving document cannot buy its way onto a no-purchase surface: surface none + injected choose_plan/start_trial/offers draw nothing', () => {
    const m = html('account.allowance.ios.json', undefined, (d) => {
      d.steps.push(
        { id: 'choose_plan', status: 'todo', required: false, ui: 'action' },
        { id: 'subscribe', status: 'todo', required: false, ui: 'action' },
        { id: 'billing_profile', status: 'todo', required: false, ui: 'action' },
        { id: 'start_trial', status: 'todo', required: false, ui: 'action', params: { length_days: 14, cap_bytes: 1, no_card: true } },
      )
      d.offers = { trial: { available: true, unavailable_reason: null, length_days: 14, cap_bytes: 10000000000, start_endpoint: '/api/v1/billing/trial/start' } }
      d.purchase.cta_allowed = true // surface is still `none`
    })
    expect(screenOf(m)).toBe('account:allowance')
    for (const marker of ['/billing', '/settings/billing', 'start-trial', 'step-start_trial', 'step-choose_plan', 'step-subscribe', 'step-billing_profile']) {
      expect(m).not.toContain(marker)
    }
  })

  test('web allowance draws the plans link and the trial card (the offer is available)', () => {
    const m = html('account.allowance.web.json')
    expect(m).toContain('data-testid="step-choose_plan"')
    expect(m).toContain('data-testid="step-start_trial"')
    expect(m).toContain('data-testid="start-trial"')
    expect(m).toContain('Start a 14-day trial')
  })

  test('trialing_no_card draws the server-supplied over-allowance sentence verbatim and the usage line', () => {
    const m = html('account.trialing_no_card.desktop.json')
    expect(m).toContain('Your trial ends on 18 Oct. Files above 2 GB become read-only')
    expect(m).toContain('data-testid="usage-over-allowance"')
  })

  test('trial_ended draws the server sentence and the plans-managed-on-web note', () => {
    const m = html('account.trial_ended.ios.json')
    expect(m).toContain('Your trial ended. Files above 2 GB are read-only')
    expect(m).toContain('Plans are managed from your account on the web.')
  })

  test('update_required draws a blocking screen with a single action and no form', () => {
    const m = html('client.update_required.ios.json')
    expect(m).toContain('data-testid="update-required-action"')
    expect(m).not.toContain('data-testid="onboarding-email"')
  })

  test('unknown required step: after the first two steps the fallback screen names the step id', () => {
    const m = html('forward_compat.unknown_step.ios.json', ['enter_email', 'verify_email_code'])
    expect(screenOf(m)).toBe('fallback')
    expect(m).toContain('confirm_phone_number')
    expect(m).toContain('href="https://beebeeb.io/signup"')
  })

  test('the pre-account first screen carries the server region line, not a hard-coded one', () => {
    expect(html('pre_account.web.json')).toContain('Stored in the EU.')
  })

  test('no emoji anywhere in any fixture screen (brand rule)', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    for (const f of fixtureFiles()) expect(html(f)).not.toMatch(emoji)
  })
})
