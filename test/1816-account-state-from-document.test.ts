import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  accountStateFromDocument,
  effectiveAccountState,
  planGateRedirect,
  resolveAccountState,
  CHOOSE_PLAN_PATH,
} from '../src/lib/account-state'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import type { OnboardingDocument } from '../src/lib/onboarding/types'

const DIR = join(import.meta.dir, '../src/contracts/onboarding/fixtures')

function fixture(name: string): OnboardingDocument {
  const parsed = parseOnboardingDocument(JSON.parse(readFileSync(join(DIR, name), 'utf8')))
  if (!parsed.ok) throw new Error(`fixture ${name} did not parse: ${parsed.reason}`)
  return parsed.doc
}

describe('1816 account state from the onboarding document', () => {
  test('an allowance account is ok: the legacy needs_plan label no longer gates it', () => {
    const doc = fixture('account.allowance.web.json')
    // The contract maps allowance to legacy needs_plan; that is exactly the bug.
    expect(resolveAccountState({ account_state: 'needs_plan' })).toBe('needs_plan')
    expect(accountStateFromDocument(doc)).toBe('ok')
    const state = effectiveAccountState(doc, { account_state: 'needs_plan' })
    expect(state).toBe('ok')
    expect(planGateRedirect('/', state)).toBeNull()
    expect(planGateRedirect('/files', state)).toBeNull()
  })

  test('needs_plan without an allowance still goes to the chooser', () => {
    const doc = fixture('account.needs_plan.ios.json')
    const state = effectiveAccountState(doc, { account_state: 'needs_plan' })
    expect(state).toBe('needs_plan')
    expect(planGateRedirect('/', state)).toBe(CHOOSE_PLAN_PATH)
  })

  test('lapsed and trial_ended keep the read-only (lapsed) treatment, no redirect', () => {
    for (const f of ['account.lapsed.ios.json', 'account.trial_ended.ios.json']) {
      const state = effectiveAccountState(fixture(f), { account_state: 'ok' })
      expect(state).toBe('lapsed')
      expect(planGateRedirect('/', state)).toBeNull()
    }
  })

  test('every other account fixture is ok', () => {
    const gated = new Set([
      'account.needs_plan.ios.json',
      'account.lapsed.ios.json',
      'account.trial_ended.ios.json',
    ])
    const names = readdirSync(DIR).filter((n) => n.startsWith('account.') && !gated.has(n))
    expect(names.length).toBe(11)
    for (const n of names) expect([n, accountStateFromDocument(fixture(n))]).toEqual([n, 'ok'])
  })

  test('the document wins over a disagreeing legacy field', () => {
    expect(effectiveAccountState(fixture('account.active.web.json'), { account_state: 'needs_plan' })).toBe('ok')
  })

  test('no document, or a pre-account one: the legacy field decides (fallback kept)', () => {
    expect(accountStateFromDocument(null)).toBeNull()
    expect(accountStateFromDocument(fixture('pre_account.web.json'))).toBeNull()
    expect(effectiveAccountState(null, { account_state: 'needs_plan' })).toBe('needs_plan')
    expect(effectiveAccountState(null, { account_state: 'lapsed' })).toBe('lapsed')
    expect(effectiveAccountState(null, null)).toBe('ok')
  })

  test('an unknown account.state label is ok (capabilities and server refusals stay the authority)', () => {
    const doc = fixture('account.active.web.json')
    const unknown = { ...doc, account: { ...doc.account!, state: 'some_future_state' } }
    expect(accountStateFromDocument(unknown)).toBe('ok')
  })
})
