import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  accountDocumentBlocks,
  effectiveAccountState,
  planGateRedirect,
  ACCOUNT_STATUS_PATH,
} from '../src/lib/account-state'
import {
  initialAccountDoc,
  invalidateAccountDoc,
  landAccountDoc,
  settleAccountDoc,
} from '../src/lib/account-doc-cache'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { planScreen } from '../src/lib/onboarding/plan'
import type { OnboardingDocument } from '../src/lib/onboarding/types'

const DIR = join(import.meta.dir, '../src/contracts/onboarding/fixtures')

function doc(name: string, patch?: (raw: any) => void): OnboardingDocument {
  const raw = JSON.parse(readFileSync(join(DIR, name), 'utf8'))
  patch?.(raw)
  const parsed = parseOnboardingDocument(raw)
  if (!parsed.ok) throw new Error(`fixture ${name} did not parse: ${parsed.reason}`)
  return parsed.doc
}

/** allowance + a required, unfinished step the contract allows alongside it. */
const blockingAllowance = (stepId: string) =>
  doc('account.allowance.web.json', (raw) => {
    raw.blocking = true
    raw.steps.unshift({ id: stepId, status: 'todo', required: true, ui: 'action' })
  })

describe('1816 round 2 P1: a blocking account document never reaches the protected route', () => {
  test('allowance + blocking known required step: gate redirects to the document screen', () => {
    const d = blockingAllowance('billing_profile')
    expect(planScreen(d).kind).toBe('step') // the renderer shows the step
    expect(accountDocumentBlocks(d)).toBe(true)
    const state = effectiveAccountState(d, { account_state: 'needs_plan' })
    expect(state).toBe('ok')
    expect(planGateRedirect('/', state, accountDocumentBlocks(d))).toBe(ACCOUNT_STATUS_PATH)
    expect(planGateRedirect('/files', state, true)).toBe(ACCOUNT_STATUS_PATH)
    expect(planGateRedirect(ACCOUNT_STATUS_PATH, state, true)).toBeNull()
    expect(planGateRedirect('/logout', state, true)).toBeNull()
  })

  test('allowance + blocking unknown required step (e.g. updated terms): also blocks', () => {
    const d = blockingAllowance('accept_terms')
    expect(planScreen(d).kind).toBe('fallback')
    expect(accountDocumentBlocks(d)).toBe(true)
  })

  test('non-blocking documents and needs_plan are unchanged', () => {
    expect(accountDocumentBlocks(doc('account.allowance.web.json'))).toBe(false)
    expect(accountDocumentBlocks(doc('account.active.web.json'))).toBe(false)
    expect(accountDocumentBlocks(doc('account.lapsed.ios.json'))).toBe(false)
    expect(accountDocumentBlocks(null)).toBe(false)
    const np = doc('account.needs_plan.ios.json')
    expect(accountDocumentBlocks(np)).toBe(false)
    expect(planGateRedirect('/', 'needs_plan', false)).toBe('/choose-plan')
  })
})

describe('1816 round 2 P2: a billing refresh invalidates the cached document', () => {
  const allowance = doc('account.allowance.web.json')

  test('invalidate clears the doc and marks it unsettled; the stale doc no longer wins', () => {
    let s = landAccountDoc(initialAccountDoc(true), 0, allowance)
    expect(s.settled).toBe(true)
    expect(effectiveAccountState(s.doc, { account_state: 'lapsed' })).toBe('ok') // the bug shape
    s = invalidateAccountDoc(s, true)
    expect(s.doc).toBeNull()
    expect(s.settled).toBe(false)
    // Stalled /onboarding: the safety net settles it, and the FRESH subscription decides.
    s = settleAccountDoc(s)
    expect(s.settled).toBe(true)
    expect(effectiveAccountState(s.doc, { account_state: 'lapsed' })).toBe('lapsed')
  })

  test('a response for a superseded request is dropped', () => {
    let s = invalidateAccountDoc(initialAccountDoc(true), true) // seq 1
    const stale = s.seq
    s = invalidateAccountDoc(s, true) // seq 2
    expect(landAccountDoc(s, stale, allowance)).toBe(s)
    const landed = landAccountDoc(s, s.seq, allowance)
    expect(landed.doc).toBe(allowance)
    expect(landed.settled).toBe(true)
  })

  test('flag off: always settled, never a document', () => {
    const s = invalidateAccountDoc(initialAccountDoc(false), false)
    expect(s.settled).toBe(true)
    expect(s.doc).toBeNull()
  })
})
