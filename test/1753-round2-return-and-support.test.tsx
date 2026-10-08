import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Subscription } from '@beebeeb/shared'
import { hasServerTrialEvidence } from '../src/lib/trial-checkout'
import { FallbackAction } from '../src/components/onboarding/blocking-screens'

const sub = (o: Partial<Subscription>) => ({ plan: 'basic', status: 'active', ...o }) as Subscription

describe('1753 round 2: markerless Mollie return', () => {
  test('mandate-backed trial is server evidence', () => {
    expect(hasServerTrialEvidence(sub({ status: 'trialing', trial_auto_converts: true }))).toBe(true)
  })
  test('refused trial is server evidence', () => {
    expect(hasServerTrialEvidence(sub({ trial_block_reason: 'payment_method_used' }))).toBe(true)
  })
  test('no-card trial, plain account, null are not evidence', () => {
    expect(hasServerTrialEvidence(sub({ status: 'trialing' }))).toBe(false)
    expect(hasServerTrialEvidence(sub({ plan: 'free' }))).toBe(false)
    expect(hasServerTrialEvidence(null)).toBe(false)
  })
})

describe('1753 round 2: contact_support link', () => {
  test('uses the pinned fallback url when present', () => {
    const h = renderToStaticMarkup(<FallbackAction fallback={{ kind: 'contact_support', url: 'https://beebeeb.io/support' }} testId="x" />)
    expect(h).toContain('href="https://beebeeb.io/support"')
  })
  test('defaults to mailto without a url', () => {
    const h = renderToStaticMarkup(<FallbackAction fallback={{ kind: 'contact_support', url: null }} testId="x" />)
    expect(h).toContain('href="mailto:support@beebeeb.io"')
  })
})
