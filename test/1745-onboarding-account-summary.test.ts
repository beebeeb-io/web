import { describe, expect, test } from 'bun:test'
import { formatDay, formatSize, summarizeAccount } from '../src/lib/onboarding/account-summary'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import type { OnboardingDocument } from '../src/lib/onboarding/types'
import { fixtureFiles, fixtureJson } from './helpers/onboarding-fixtures'

function load(name: string, mutate?: (d: Record<string, any>) => void): OnboardingDocument {
  const raw = fixtureJson(name)
  mutate?.(raw)
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error('fixture did not parse')
  return r.doc
}

const UTC = 'UTC'

describe('formatSize / formatDay', () => {
  test('decimal sizes, trimmed', () => {
    expect(formatSize(2_000_000_000)).toBe('2 GB')
    expect(formatSize(6_300_000_000)).toBe('6.3 GB')
    expect(formatSize(10_000_000_000)).toBe('10 GB')
    expect(formatSize(500_000_000)).toBe('500 MB')
    expect(formatSize(1_500_000_000_000)).toBe('1.5 TB')
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(-1)).toBe('0 B')
  })

  test('formatDay is null for missing or garbage', () => {
    expect(formatDay(null)).toBeNull()
    expect(formatDay('nope')).toBeNull()
    expect(formatDay('2026-10-18T09:00:00Z', UTC)).toBe('18 Oct 2026')
  })
})

describe('summarizeAccount over every account fixture', () => {
  const files = fixtureFiles().filter((f) => f.startsWith('account.'))
  test('14 account fixtures', () => expect(files.length).toBe(14))
  for (const f of files) {
    test(`${f} summarises without throwing and names its state`, () => {
      const doc = load(f)
      const s = summarizeAccount(doc, UTC)
      expect(s.state).toBe(doc.account!.state)
      expect(s.headline.length).toBeGreaterThan(0)
      expect(s.rows.map((r) => r.name)).toContain('download')
      expect(s.rows.map((r) => r.name)).toContain('upload')
      expect(s.rows.map((r) => r.name)).toContain('share')
    })
  }
})

describe('state wording (spec 4b, 5.4 B to E)', () => {
  test('allowance (web): 2 GB headline, upload up to 2 GB, share needs a plan, purchase allowed', () => {
    const s = summarizeAccount(load('account.allowance.web.json'), UTC)
    expect(s.headline).toBe('You have 2 GB to start with')
    expect(s.rows.find((r) => r.name === 'upload')).toMatchObject({ allowed: true, detail: 'Up to 2 GB' })
    expect(s.rows.find((r) => r.name === 'share')).toMatchObject({ allowed: false, detail: 'Needs a plan' })
    expect(s.canOfferPurchase).toBe(true)
    expect(s.plansManagedNote).toBeNull()
  })

  test('allowance (iOS): the same rows, no purchase, the server note is shown', () => {
    const s = summarizeAccount(load('account.allowance.ios.json'), UTC)
    expect(s.canOfferPurchase).toBe(false)
  })

  test('trialing_no_card (desktop): runs until 18 Oct, nothing charged, server over-allowance copy used verbatim', () => {
    const doc = load('account.trialing_no_card.desktop.json')
    const s = summarizeAccount(doc, UTC)
    expect(s.headline).toBe('Your trial runs until 18 Oct 2026')
    expect(s.lines[0]).toBe('No card is on file, so nothing will be charged.')
    expect(s.lines).toContain(doc.copy.trial_end_over_allowance)
    expect(s.tone).toBe('attention')
    expect(s.usage).toMatchObject({ usedBytes: 6_300_000_000, quotaBytes: 10_000_000_000, allowanceBytes: 2_000_000_000, overAllowance: true })
    expect(s.rows.find((r) => r.name === 'share')?.detail).toBe('Up to 5 active links')
  })

  test('trial_ended (iOS): restricted, server copy verbatim, upload and share denied for trial_ended, no purchase', () => {
    const doc = load('account.trial_ended.ios.json')
    const s = summarizeAccount(doc, UTC)
    expect(s.headline).toBe('Your trial has ended')
    expect(s.tone).toBe('restricted')
    expect(s.lines).toEqual([doc.copy.trial_ended_over_allowance])
    expect(s.rows.find((r) => r.name === 'upload')).toMatchObject({ allowed: false, detail: 'Trial ended', rawReason: null })
    expect(s.canOfferPurchase).toBe(false)
    expect(s.plansManagedNote).toBe('Plans are managed from your account on the web.')
  })

  test('trial_ended without server copy falls back to a generic line with the deletion date', () => {
    const doc = load('account.trial_ended.ios.json', (d) => {
      delete d.copy
    })
    const s = summarizeAccount(doc, UTC)
    expect(s.lines[0]).toContain('1 Nov 2026')
  })

  test('needs_plan, email not verified: asks to verify, restricted', () => {
    const s = summarizeAccount(load('account.needs_plan.ios.json'), UTC)
    expect(s.headline).toBe('Verify your email to continue')
    expect(s.tone).toBe('restricted')
    expect(s.rows.find((r) => r.name === 'upload')?.detail).toBe('Verify your email first')
  })

  test('an unknown account.state is only a label: generic headline, the capability rows carry the truth (rule 4)', () => {
    const s = summarizeAccount(load('account.active.web.json', (d) => { d.account.state = 'quantum' }), UTC)
    expect(s.headline).toBe('Your account')
    expect(s.rows.find((r) => r.name === 'upload')?.allowed).toBe(true)
  })

  test('an unknown capability reason is shown as the raw code, not dropped', () => {
    const s = summarizeAccount(load('account.read_only.web.json', (d) => { d.account.capabilities.upload.reason = 'new_future_reason' }), UTC)
    const up = s.rows.find((r) => r.name === 'upload')!
    expect(up.allowed).toBe(false)
    expect(up.rawReason).toBe('new_future_reason')
  })

  test('an absent capability is not allowed (rule 11)', () => {
    const s = summarizeAccount(load('account.active.web.json', (d) => { delete d.account.capabilities.share }), UTC)
    expect(s.rows.find((r) => r.name === 'share')?.allowed).toBe(false)
  })

  test('the client never invents a price, a charge date or a trial length', () => {
    for (const f of fixtureFiles().filter((x) => x.startsWith('account.'))) {
      const s = summarizeAccount(load(f), UTC)
      const text = [s.headline, ...s.lines].join(' ')
      expect(text).not.toMatch(/€|EUR|\$|per month|per year/i)
    }
  })
})
