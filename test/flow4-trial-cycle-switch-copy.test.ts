import { describe, expect, test } from 'bun:test'
import { isTrialing, trialCycleSwitchNote, trialCycleSwitchToast } from '../src/lib/cycle-switch-copy'

describe('flow-4 finding 4 — trial cycle-switch copy', () => {
  test('only a trialing status counts as a trial', () => {
    expect(isTrialing('trialing')).toBe(true)
    for (const s of ['active', 'cancelling', 'past_due', '', null, undefined]) {
      expect(isTrialing(s)).toBe(false)
    }
  })

  test('annual note says nothing is charged today and names the trial end', () => {
    const note = trialCycleSwitchNote('yearly', '9 Oct 2026')
    expect(note).toContain('nothing is charged today')
    expect(note).toContain('annual billing starts on 9 Oct 2026')
    // Never the paid-subscriber promise, which is false during a trial.
    expect(note).not.toContain('current monthly period')
  })

  test('monthly note names the monthly cycle', () => {
    expect(trialCycleSwitchNote('monthly', '9 Oct 2026')).toContain('monthly billing starts on 9 Oct 2026')
  })

  test('toast copy names the cycle and the date', () => {
    expect(trialCycleSwitchToast('yearly', '9 Oct 2026')).toBe(
      'Nothing is charged during your trial. Add a payment method to start annual billing on 9 Oct 2026.',
    )
  })
})
