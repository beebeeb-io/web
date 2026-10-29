import { describe, expect, test } from 'bun:test'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { formatCountdown, resendRemainingSeconds } from '../src/lib/onboarding/resend'
import { fixtureFiles, fixtureJson } from './helpers/onboarding-fixtures'

/**
 * Task 1738 — a resend sends a fresh code (Guus ruling 2026-10-05), at least
 * `policy.email_code.resend_after_seconds` after the last one. The wait comes
 * from the document, never from a constant in the screen.
 */

describe('the resend countdown follows the document', () => {
  test('every vendored pre-account fixture declares a 60 s resend window, and the parser carries it through', () => {
    const pre = fixtureFiles().filter((f) => fixtureJson(f).stage === 'pre_account')
    expect(pre.length).toBe(5)
    for (const f of pre) {
      const r = parseOnboardingDocument(fixtureJson(f))
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.doc.policy?.emailCode.resendAfterSeconds).toBe(60)
    }
  })

  test('a different window in the document is what the parser returns (nothing is hardcoded)', () => {
    const d = fixtureJson('pre_account.web.json')
    d.policy.email_code.resend_after_seconds = 120
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.policy?.emailCode.resendAfterSeconds).toBe(120)
  })

  test('remaining seconds count down from the send time and stop at 0', () => {
    const sent = 1_000_000
    expect(resendRemainingSeconds(sent, 60, sent)).toBe(60)
    expect(resendRemainingSeconds(sent, 60, sent + 1)).toBe(60) // 59.999 s left rounds up
    expect(resendRemainingSeconds(sent, 60, sent + 18_000)).toBe(42)
    expect(resendRemainingSeconds(sent, 60, sent + 59_001)).toBe(1)
    expect(resendRemainingSeconds(sent, 60, sent + 60_000)).toBe(0)
    expect(resendRemainingSeconds(sent, 60, sent + 600_000)).toBe(0)
    expect(resendRemainingSeconds(null, 60, sent)).toBe(0) // nothing sent yet: may ask now
  })

  test('the clock reads m:ss', () => {
    expect(formatCountdown(42)).toBe('0:42')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(900)).toBe('15:00')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-3)).toBe('0:00')
  })
})
