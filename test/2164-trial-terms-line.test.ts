import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { trialTermsCopy, trialTermsLine } from '../src/lib/trial-checkout'

describe('task 2164: trial terms follow the offer', () => {
  test('no-card offer: says no card or iDEAL is needed, never the mandate line', () => {
    const line = trialTermsLine(14, { noCardOffered: true })
    expect(line).toBe('14-day free trial. No card or iDEAL needed to start.')
    expect(line).not.toContain('Card or iDEAL needed')
    expect(line).not.toContain('No charge until')
  })

  test('no no-card offer: keeps the mandate line unchanged', () => {
    expect(trialTermsLine(14, { noCardOffered: false })).toBe(trialTermsCopy(14))
    expect(trialTermsCopy(14)).toContain('Card or iDEAL needed to start')
  })

  test('signup renders the no-card line and never the mandate helper', () => {
    const src = readFileSync(new URL('../src/pages/signup.tsx', import.meta.url), 'utf8')
    expect(src).toContain('trialTermsLine(trialDays, { noCardOffered: true })')
    expect(src).not.toContain('trialTermsCopy')
  })
})
