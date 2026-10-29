import { describe, expect, test } from 'bun:test'
import type { Subscription } from '@beebeeb/shared'
import { reflectsUpgradeNoIntent } from '../src/lib/checkout-reconcile'
import { choosePlanEntry, hasTrialReturnIntent } from '../src/lib/trial-checkout'
import { ownHttpsUrl, parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { fixtureJson } from './helpers/onboarding-fixtures'

/**
 * Task 1753 review fixes (web): 1753-P2-01, 1753-P3-01, 1753-P3-02.
 */

const sub = (over: Partial<Subscription>): Subscription =>
  ({ plan: 'basic', billing_cycle: 'monthly', status: 'active', ...over }) as Subscription

describe('1753-P2-01: a bare ?upgraded=true never turns a trial into "Upgrade complete"', () => {
  test('no-intent fallback rejects a trialing subscription (no-card or card trial)', () => {
    expect(reflectsUpgradeNoIntent(sub({ status: 'trialing', plan: 'basic' }))).toBe(false)
    expect(reflectsUpgradeNoIntent(sub({ status: 'trialing', plan: 'pro' }))).toBe(false)
  })
  test('no-intent fallback rejects free and non-active states', () => {
    expect(reflectsUpgradeNoIntent(sub({ status: 'active', plan: 'free' }))).toBe(false)
    expect(reflectsUpgradeNoIntent(sub({ status: 'cancelled', plan: 'pro' }))).toBe(false)
  })
  test('no-intent fallback still accepts a real paid active subscription (1828 real return)', () => {
    expect(reflectsUpgradeNoIntent(sub({ status: 'active', plan: 'pro' }))).toBe(true)
  })
})

describe('1753-P3-01: ?returned=1 only reconciles when this browser started a trial checkout', () => {
  const base = { accountState: 'ok', fromBilling: false, subStatus: 'trialing', effectivePlan: 'basic', hasUsedTrial: false } as const
  test('hasTrialReturnIntent is true only for a trial-kind pending checkout', () => {
    expect(hasTrialReturnIntent(null)).toBe(false)
    expect(hasTrialReturnIntent({ kind: 'plan' } as never)).toBe(false)
    expect(hasTrialReturnIntent({ kind: 'storage' } as never)).toBe(false)
    expect(hasTrialReturnIntent({ kind: 'trial' } as never)).toBe(true)
  })
  test('returned=1 without a trial intent is a normal arrival, not a reconcile', () => {
    const e = choosePlanEntry({ ...base, returned: true, hasTrialIntent: false })
    expect(e.kind).not.toBe('reconcile')
    expect(e).toEqual({ kind: 'redirect', to: '/' })
  })
  test('returned=1 with a trial intent reconciles', () => {
    expect(choosePlanEntry({ ...base, returned: true, hasTrialIntent: true })).toEqual({ kind: 'reconcile' })
  })
  test('needs_plan with a crafted returned=1 and no intent still picks a plan', () => {
    expect(choosePlanEntry({ ...base, accountState: 'needs_plan', returned: true, hasTrialIntent: false })).toEqual({ kind: 'pick' })
  })
})

describe('1753-P3-02: document links are pinned to beebeeb.io', () => {
  test('ownHttpsUrl keeps https on beebeeb.io and subdomains only', () => {
    expect(ownHttpsUrl('https://beebeeb.io/terms')).toBe('https://beebeeb.io/terms')
    expect(ownHttpsUrl('https://app.beebeeb.io/signup')).toBe('https://app.beebeeb.io/signup')
    for (const bad of [
      'https://evil.test/signup',
      'https://beebeeb.io.evil.test/x',
      'https://evilbeebeeb.io/x',
      'https://beebeeb.io@evil.test/x',
      'https://beebeeb.io:8443/x',
      'http://beebeeb.io/x',
      'javascript:alert(1)',
      'mailto:a@beebeeb.io',
      42,
      null,
    ]) {
      expect(ownHttpsUrl(bad)).toBeNull()
    }
  })

  test('parser drops foreign web_url, terms links and fallback urls to null', () => {
    const d = fixtureJson('pre_account.web.json')
    d.signup = { ...(d.signup ?? {}), web_url: 'https://evil.test/signup' }
    d.fallback = { kind: 'use_web', url: 'https://evil.test/x' }
    if (d.policy?.terms) {
      d.policy.terms.url = 'https://evil.test/terms'
      d.policy.terms.privacy_url = 'https://evil.test/privacy'
    }
    const r = parseOnboardingDocument(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.signup?.webUrl).toBeNull()
    expect(r.doc.fallback?.url).toBeNull()
    if (r.doc.policy) {
      expect(r.doc.policy.terms.url).toBeNull()
      expect(r.doc.policy.terms.privacyUrl).toBeNull()
    }
  })

  test('step fallbacks are pinned too, and own links survive', () => {
    const d = fixtureJson('pre_account.web.json')
    d.steps[0].fallback = { kind: 'contact_support', url: 'https://evil.test/help' }
    d.steps[1] = { ...d.steps[1], fallback: { kind: 'use_web', url: 'https://beebeeb.io/signup' } }
    const r = parseOnboardingDocument(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.steps[0].fallback?.url).toBeNull()
    expect(r.doc.steps[1].fallback?.url).toBe('https://beebeeb.io/signup')
  })
})
