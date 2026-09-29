import { describe, expect, test } from 'bun:test'
import {
  isTrialing,
  isMandatedTrial,
  isCancelledTrial,
  trialCancelledSwitchNote,
  mandatedTrialCycleSwitchNote,
  mandatedTrialCycleSwitchToast,
  trialCycleSwitchNote,
  trialCycleSwitchToast,
  trialCycleSwitchNoteFor,
  trialCycleSwitchToastFor,
} from '../src/lib/cycle-switch-copy'

const TRIAL_END = '9 Oct 2026'
const TRIAL_END_ISO = '2026-10-09T00:00:00Z'

function mandatedTrial() {
  return { status: 'trialing', trial_auto_converts: true, trial_ends_at: TRIAL_END_ISO, current_period_end: TRIAL_END_ISO }
}
function noCardTrial() {
  return { status: 'trialing', trial_auto_converts: false, trial_ends_at: TRIAL_END_ISO, current_period_end: null }
}
function legacyTrialNoField() {
  // trial_auto_converts absent entirely (older server / mock fixture) — must
  // still be treated as the no-card (b) case, never mandated.
  return { status: 'trialing', trial_ends_at: TRIAL_END_ISO, current_period_end: null }
}
function cancelledTrial() {
  return { status: 'cancelling', trial_ends_at: TRIAL_END_ISO, current_period_end: TRIAL_END_ISO }
}
function cancellingPaid() {
  // A normal paid-plan cancellation: no trial_ends_at at all.
  return { status: 'cancelling', trial_ends_at: null, current_period_end: '2026-11-01T00:00:00Z' }
}

describe('flow-4 finding 4 / task 1604 — trial cycle-switch copy', () => {
  test('only a trialing status counts as a trial', () => {
    expect(isTrialing('trialing')).toBe(true)
    for (const s of ['active', 'cancelling', 'past_due', '', null, undefined]) {
      expect(isTrialing(s)).toBe(false)
    }
  })

  describe('case (a) — mandated trial (trial_auto_converts: true)', () => {
    test('isMandatedTrial is true only when trialing AND trial_auto_converts === true', () => {
      expect(isMandatedTrial(mandatedTrial())).toBe(true)
      expect(isMandatedTrial(noCardTrial())).toBe(false)
      expect(isMandatedTrial({ status: 'active', trial_auto_converts: true })).toBe(false)
      expect(isMandatedTrial(null)).toBe(false)
    })

    test('note: nothing charged today, names the new price, the trial-end date, and the cadence', () => {
      const yearly = mandatedTrialCycleSwitchNote('yearly', 'EUR 54.95', TRIAL_END)
      expect(yearly).toBe('Nothing is charged today. Your first charge of EUR 54.95 is on 9 Oct 2026, then every year.')

      const monthly = mandatedTrialCycleSwitchNote('monthly', 'EUR 5.49', TRIAL_END)
      expect(monthly).toBe('Nothing is charged today. Your first charge of EUR 5.49 is on 9 Oct 2026, then every month.')
    })

    test('note never uses the no-card "add a payment method" copy — a mandate already exists', () => {
      const note = mandatedTrialCycleSwitchNote('yearly', 'EUR 54.95', TRIAL_END)
      expect(note).not.toContain('add a payment method')
      expect(note).not.toContain('If you add')
    })

    test('toast confirms the (unchanged) first-charge date, not a new charge', () => {
      expect(mandatedTrialCycleSwitchToast('EUR 54.95', TRIAL_END)).toBe(
        'Nothing was charged. Your first charge of EUR 54.95 is still on 9 Oct 2026.',
      )
    })

    test('dispatcher routes a mandated trial to the mandated-trial note/toast', () => {
      expect(trialCycleSwitchNoteFor(mandatedTrial(), 'yearly', TRIAL_END, 'EUR 54.95')).toBe(
        mandatedTrialCycleSwitchNote('yearly', 'EUR 54.95', TRIAL_END),
      )
      expect(trialCycleSwitchToastFor(mandatedTrial(), 'yearly', TRIAL_END, 'EUR 54.95')).toBe(
        mandatedTrialCycleSwitchToast('EUR 54.95', TRIAL_END),
      )
    })
  })

  describe('case (b) — no-card trial (legacy)', () => {
    test('annual note says nothing is charged today and names the trial end', () => {
      const note = trialCycleSwitchNote('yearly', TRIAL_END)
      expect(note).toContain('nothing is charged today')
      expect(note).toContain(`annual billing starts on ${TRIAL_END}`)
      // Never the paid-subscriber promise, which is false during a trial.
      expect(note).not.toContain('current monthly period')
    })

    test('monthly note names the monthly cycle', () => {
      expect(trialCycleSwitchNote('monthly', TRIAL_END)).toContain(`monthly billing starts on ${TRIAL_END}`)
    })

    test('toast copy names the cycle and the date', () => {
      expect(trialCycleSwitchToast('yearly', TRIAL_END)).toBe(
        `Nothing is charged during your trial. Add a payment method to start annual billing on ${TRIAL_END}.`,
      )
    })

    test('dispatcher routes a no-card trial (explicit false) to the legacy note/toast', () => {
      expect(trialCycleSwitchNoteFor(noCardTrial(), 'yearly', TRIAL_END, 'EUR 54.95')).toBe(
        trialCycleSwitchNote('yearly', TRIAL_END),
      )
      expect(trialCycleSwitchToastFor(noCardTrial(), 'monthly', TRIAL_END, 'EUR 5.49')).toBe(
        trialCycleSwitchToast('monthly', TRIAL_END),
      )
    })

    test('dispatcher treats a MISSING trial_auto_converts (older server) as no-card too, never mandated', () => {
      expect(isMandatedTrial(legacyTrialNoField())).toBe(false)
      expect(trialCycleSwitchNoteFor(legacyTrialNoField(), 'yearly', TRIAL_END, 'EUR 54.95')).toBe(
        trialCycleSwitchNote('yearly', TRIAL_END),
      )
    })
  })

  describe('case (c) — cancelled trial (before its first charge)', () => {
    test('isCancelledTrial requires cancelling + a trial_ends_at that still equals current_period_end', () => {
      expect(isCancelledTrial(cancelledTrial())).toBe(true)
      // A normal paid cancellation (no trial) is not a cancelled trial.
      expect(isCancelledTrial(cancellingPaid())).toBe(false)
      // Trialing (not yet cancelled) is not a cancelled trial.
      expect(isCancelledTrial(mandatedTrial())).toBe(false)
      // cancelling with a trial_ends_at that has since diverged from
      // current_period_end (a converted-then-cancelled trial) is not this case.
      expect(
        isCancelledTrial({ status: 'cancelling', trial_ends_at: TRIAL_END_ISO, current_period_end: '2026-11-01T00:00:00Z' }),
      ).toBe(false)
      expect(isCancelledTrial(null)).toBe(false)
    })

    test('note text is the fixed "resume to change billing" copy', () => {
      expect(trialCancelledSwitchNote()).toBe('Your trial is cancelled — resume it to change billing.')
    })

    test('dispatcher routes a cancelled trial to the cancelled-trial note/toast regardless of mandated/no-card shape', () => {
      const cancelled = cancelledTrial()
      expect(trialCycleSwitchNoteFor(cancelled, 'yearly', TRIAL_END, 'EUR 54.95')).toBe(trialCancelledSwitchNote())
      expect(trialCycleSwitchToastFor(cancelled, 'yearly', TRIAL_END, 'EUR 54.95')).toBe(trialCancelledSwitchNote())
      // Even if trial_auto_converts happens to still be true on the stale row.
      expect(
        trialCycleSwitchNoteFor(
          { ...cancelled, trial_auto_converts: true },
          'monthly',
          TRIAL_END,
          'EUR 5.49',
        ),
      ).toBe(trialCancelledSwitchNote())
    })
  })
})
