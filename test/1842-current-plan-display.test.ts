import { describe, expect, test } from 'bun:test'
import { NO_CARD_TRIAL_PLAN_NAME, currentPlanName } from '../src/lib/current-plan-display'

describe('1842 currentPlanName', () => {
  const base = { accountStateLabel: null, hasNoPlan: false, planLabel: 'Pro' }
  test('a no-card trial is the trial, not the plan it is offered', () => {
    expect(currentPlanName({ ...base, noCardTrial: true })).toBe(NO_CARD_TRIAL_PLAN_NAME)
    expect(NO_CARD_TRIAL_PLAN_NAME).toBe('Trial, no card')
  })
  test('a card trial and a paid plan keep the plan name', () => {
    expect(currentPlanName({ ...base })).toBe('Pro')
    expect(currentPlanName({ ...base, noCardTrial: false })).toBe('Pro')
  })
  test('allowance and no-plan accounts are unchanged', () => {
    expect(currentPlanName({ ...base, accountStateLabel: 'allowance' })).toBe('Allowance')
    expect(currentPlanName({ ...base, hasNoPlan: true })).toBe('No plan')
  })
})
