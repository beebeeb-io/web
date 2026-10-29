import { describe, expect, test } from 'bun:test'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { planScreen, unsupportedAccountSteps } from '../src/lib/onboarding/plan'
import { clearAllDismissed, dismissKey, readDismissed, writeDismissed } from '../src/lib/onboarding/notice-dismissal'
import { fixtureJson } from './helpers/onboarding-fixtures'

function termsDoc(params: Record<string, unknown>) {
  const raw = fixtureJson('account.allowance.web.json')
  raw.blocking = true
  raw.steps.unshift({ id: 'accept_terms', status: 'todo', required: true, ui: 'action', params })
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error(r.reason)
  return r.doc
}

function memStorage() {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as unknown as Storage
}

describe('1822 P1: accept_terms without a version is undrawable', () => {
  for (const params of [{}, { version: '' }, { version: 3 }]) {
    test(`never blocks, reported unsupported (${JSON.stringify(params)})`, () => {
      const doc = termsDoc(params)
      const s = planScreen(doc)
      expect(s.kind).toBe('account')
      expect(unsupportedAccountSteps(doc)).toContain('accept_terms')
      if (s.kind === 'account') {
        expect(s.unsupported).toContain('accept_terms')
        expect(s.actions.some((a) => a.step.id === 'accept_terms')).toBe(false)
      }
    })
  }
  test('with a version it still blocks on the step screen', () => {
    const s = planScreen(termsDoc({ version: '2026-10' }))
    expect(s.kind).toBe('step')
    if (s.kind === 'step') expect(s.stepId).toBe('accept_terms')
  })
})

describe('1822 P2: dismissal is per account', () => {
  test('key carries the user id; another account does not inherit it', () => {
    const st = memStorage()
    writeDismissed('u1', 'verify_identity', st)
    expect(dismissKey('u1')).not.toBe(dismissKey('u2'))
    expect(readDismissed('u1', st)).toBe('verify_identity')
    expect(readDismissed('u2', st)).toBe('')
  })
  test('clearAllDismissed removes every account dismissal and nothing else', () => {
    const st = memStorage()
    writeDismissed('u1', 'a', st)
    writeDismissed('u2', 'b', st)
    st.setItem('other', 'keep')
    clearAllDismissed(st)
    expect(readDismissed('u1', st)).toBe('')
    expect(readDismissed('u2', st)).toBe('')
    expect(st.getItem('other')).toBe('keep')
  })
})
