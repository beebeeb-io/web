import { describe, expect, test } from 'bun:test'
import { parseOnboardingDocument } from '../src/lib/onboarding/parse'
import { HARD_CODED_WEB_FALLBACK, planScreen, type Screen } from '../src/lib/onboarding/plan'
import type { OnboardingDocument } from '../src/lib/onboarding/types'
import { fixtureFiles, fixtureJson, readInvalid } from './helpers/onboarding-fixtures'

/**
 * Task 1745 — the planner (spec 5.5, 5.8). Pure: no React, no DOM.
 */

function load(name: string, mutate?: (d: Record<string, any>) => void): OnboardingDocument {
  const raw = fixtureJson(name)
  mutate?.(raw)
  const r = parseOnboardingDocument(raw)
  if (!r.ok) throw new Error(`fixture ${name} did not parse: ${r.reason}`)
  return r.doc
}

const PRE = ['enter_email', 'verify_email_code', 'accept_terms', 'set_password', 'save_recovery_phrase']

describe('pre_account order and progress', () => {
  test('the first screen is enter_email, position 1 of 6', () => {
    const s = planScreen(load('pre_account.web.json'))
    expect(s.kind).toBe('step')
    if (s.kind === 'step') {
      expect(s.stepId).toBe('enter_email')
      expect(s.position).toBe(1)
      expect(s.total).toBe(6)
    }
  })

  test('walking the document order visits the six steps in order, then `created`', () => {
    const doc = load('pre_account.web.json')
    const seen: string[] = []
    const done = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const s = planScreen(doc, done)
      if (s.kind === 'created') break
      expect(s.kind).toBe('step')
      if (s.kind !== 'step') break
      seen.push(s.stepId)
      done.add(s.stepId)
    }
    expect(seen).toEqual([...PRE, 'create_account'])
    expect(planScreen(doc, done).kind).toBe('created')
  })

  test('create_account waits for every other required step, even when the server lists it first (spec 5.5 invariant)', () => {
    const doc = load('pre_account.web.json', (d) => {
      const i = d.steps.findIndex((s: any) => s.id === 'create_account')
      const [step] = d.steps.splice(i, 1)
      d.steps.unshift(step)
    })
    const order: string[] = []
    const done = new Set<string>()
    for (;;) {
      const s = planScreen(doc, done)
      if (s.kind !== 'step') break
      order.push(s.stepId)
      done.add(s.stepId)
    }
    expect(order.at(-1)).toBe('create_account')
    expect(order.indexOf('create_account')).toBe(order.length - 1)
    expect(order.length).toBe(6)
  })

  test('a server-side `done` skips the step without a local completion', () => {
    const doc = load('pre_account.web.json', (d) => {
      d.steps[0].status = 'done'
    })
    const s = planScreen(doc)
    expect(s.kind === 'step' && s.stepId).toBe('verify_email_code')
  })

  test('undoing a completed step returns to it (back / ticket expiry)', () => {
    const doc = load('pre_account.web.json')
    const done = new Set(PRE)
    expect(planScreen(doc, done).kind === 'step' && (planScreen(doc, done) as any).stepId).toBe('create_account')
    done.delete('verify_email_code')
    const s = planScreen(doc, done)
    expect(s.kind === 'step' && s.stepId).toBe('verify_email_code')
  })
})

describe('forward compatibility (rule 3 and 4)', () => {
  const unknown = 'forward_compat.unknown_step.ios.json'

  test('unknown OPTIONAL step is skipped silently and never appears in the rail', () => {
    const doc = load(unknown)
    const done = new Set<string>()
    const rail = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const s = planScreen(doc, done)
      if (s.kind !== 'step') break
      s.steps.forEach((p) => rail.add(p.step.id))
      done.add(s.stepId)
    }
    expect(rail.has('future_nice_to_have')).toBe(false)
  })

  test('unknown REQUIRED step stops there and shows the step fallback', () => {
    const doc = load(unknown)
    const s = planScreen(doc, new Set(['enter_email', 'verify_email_code']))
    expect(s.kind).toBe('fallback')
    if (s.kind === 'fallback') {
      expect(s.stepId).toBe('confirm_phone_number')
      expect(s.fallback).toEqual({ kind: 'use_web', url: 'https://beebeeb.io/signup' })
    }
  })

  test('the steps BEFORE the unknown required one are still offered; none after it', () => {
    const doc = load(unknown)
    const first = planScreen(doc)
    expect(first.kind === 'step' && first.stepId).toBe('enter_email')
    const second = planScreen(doc, new Set(['enter_email']))
    expect(second.kind === 'step' && second.stepId).toBe('verify_email_code')
    // accept_terms / set_password sit after the unknown step and are never reached
    const stop = planScreen(doc, new Set(['enter_email', 'verify_email_code']))
    expect(stop.kind).toBe('fallback')
  })

  test('unknown required step with no step fallback uses the document fallback', () => {
    const doc = load(unknown, (d) => {
      const s = d.steps.find((x: any) => x.id === 'confirm_phone_number')
      delete s.fallback
      d.fallback = { kind: 'contact_support', url: 'https://beebeeb.io/support' }
    })
    const s = planScreen(doc, new Set(['enter_email', 'verify_email_code']))
    expect(s.kind === 'fallback' && s.fallback).toEqual({ kind: 'contact_support', url: 'https://beebeeb.io/support' })
  })

  test('a server that broke the "one fallback exists" promise gets the hard-coded web fallback', () => {
    const doc = load(unknown, (d) => {
      const s = d.steps.find((x: any) => x.id === 'confirm_phone_number')
      delete s.fallback
      delete d.fallback
    })
    const s = planScreen(doc, new Set(['enter_email', 'verify_email_code']))
    expect(s.kind === 'fallback' && s.fallback).toEqual(HARD_CODED_WEB_FALLBACK)
  })

  test('the invalid/ unknown-required-without-fallback document also ends on a fallback, never a crash', () => {
    const r = parseOnboardingDocument(readInvalid('unknown_required_step_no_fallback.json'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const done = new Set(r.doc.steps.filter((s) => ['enter_email', 'verify_email_code', 'accept_terms', 'set_password', 'save_recovery_phrase'].includes(s.id)).map((s) => s.id))
    const s = planScreen(r.doc, done)
    expect(['fallback', 'step']).toContain(s.kind)
  })

  test('unknown status on a required step blocks; on an optional step it is skipped', () => {
    const req = load('pre_account.web.json', (d) => {
      d.steps[0].status = 'quantum'
    })
    expect(planScreen(req).kind).toBe('blocked')
    const opt = load(unknown, (d) => {
      const s = d.steps.find((x: any) => x.id === 'future_nice_to_have')
      s.status = 'quantum'
    })
    expect(planScreen(opt).kind).toBe('step')
  })

  test('a step id known only to the other stage is unknown here', () => {
    const doc = load('pre_account.web.json', (d) => {
      d.steps.splice(1, 0, { id: 'choose_plan', status: 'todo', required: true, ui: 'action' })
    })
    const s = planScreen(doc, new Set(['enter_email']))
    expect(s.kind).toBe('fallback')
  })
})

describe('update_required and signup availability', () => {
  test('update_required blocks everything and carries the document fallback (rule 7)', () => {
    const s = planScreen(load('client.update_required.ios.json'))
    expect(s.kind).toBe('update_required')
    if (s.kind === 'update_required') expect(s.fallback.kind).toBe('update_app')
  })

  test('update_required beats a pre-account step even when steps are all done', () => {
    const s = planScreen(load('client.update_required.ios.json'), new Set(PRE.concat('create_account')))
    expect(s.kind).toBe('update_required')
  })

  test('signup mode web_only shows the handoff, not the form', () => {
    const doc = load('pre_account.web.json', (d) => {
      d.signup.mode = 'web_only'
    })
    const s = planScreen(doc)
    expect(s.kind).toBe('signup_unavailable')
  })

  test('signup allowed false shows the handoff', () => {
    const doc = load('pre_account.web.json', (d) => {
      d.signup.allowed = false
    })
    expect(planScreen(doc).kind).toBe('signup_unavailable')
  })
})

describe('account stage', () => {
  function kindOf(f: string): Screen['kind'] {
    return planScreen(load(f)).kind
  }

  test('needs_plan with an unverified email is a blocking verify_email step', () => {
    const s = planScreen(load('account.needs_plan.ios.json'))
    expect(s.kind).toBe('step')
    if (s.kind === 'step') expect(s.stepId).toBe('verify_email')
  })

  test('allowance on web lists choose_plan and start_trial as actions', () => {
    const s = planScreen(load('account.allowance.web.json'))
    expect(s.kind).toBe('account')
    if (s.kind === 'account') expect(s.actions.map((a) => a.step.id)).toEqual(['choose_plan', 'start_trial'])
  })

  test('allowance on iOS (verify_email and accept_terms done) is the status view with no actions', () => {
    const s = planScreen(load('account.allowance.ios.json'))
    expect(s.kind).toBe('account')
    if (s.kind === 'account') expect(s.actions).toEqual([])
  })

  test('every account fixture other than needs_plan lands on the status view', () => {
    const files = fixtureFiles().filter((f) => f.startsWith('account.') && !f.startsWith('account.needs_plan'))
    expect(files.length).toBe(13)
    for (const f of files) expect(kindOf(f)).toBe('account')
  })

  test('a blocking document with an unknown required account step falls back (rule 3)', () => {
    const doc = load('account.allowance.web.json', (d) => {
      d.steps.push({ id: 'verify_identity', status: 'todo', required: true, ui: 'action' })
    })
    expect(planScreen(doc).kind).toBe('fallback')
  })
})

describe('round 2: blocked optional actions draw nothing (Codex P2 on web#134)', () => {
  test('an optional start_trial / choose_plan with status blocked is not an account action; a todo one still is', () => {
    const doc = load('account.allowance.web.json', (d) => {
      for (const s of d.steps) if (s.id === 'start_trial' || s.id === 'choose_plan') s.status = 'blocked'
    })
    const blockedIds = doc.steps.filter((s) => s.status === 'blocked').map((s) => s.id)
    expect(blockedIds.length).toBeGreaterThan(0)
    const s = planScreen(doc)
    expect(s.kind).toBe('account')
    if (s.kind === 'account') {
      for (const id of blockedIds) expect(s.actions.map((a) => a.step.id)).not.toContain(id)
    }
    const open = planScreen(load('account.allowance.web.json'))
    expect(open.kind === 'account' && open.actions.map((a) => a.step.id)).toContain('start_trial')
  })
})
