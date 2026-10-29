import { describe, expect, test } from 'bun:test'
import { outcomeFromRaw } from '../src/lib/onboarding/client'
import { parseOnboardingDocument, safeHttpsUrl, sameOriginApiPath } from '../src/lib/onboarding/parse'
import { fixtureFiles, fixtureJson, readInvalid } from './helpers/onboarding-fixtures'

/**
 * Task 1745 — the tolerant parser (spec 5.8). Every vendored fixture must parse,
 * and the forward-compatibility rules must hold on documents built from them.
 */

describe('every vendored fixture parses', () => {
  const files = fixtureFiles()
  test('there are 20 fixtures (count is the truth line, not the absence of failure)', () => {
    expect(files.length).toBe(20)
  })
  for (const f of files) {
    test(`${f}`, () => {
      const r = parseOnboardingDocument(fixtureJson(f))
      expect(r.ok).toBe(true)
    })
  }
})

describe('unknown values degrade to the value the spec names', () => {
  test('unknown step status is blocked (rule 4)', () => {
    const d = fixtureJson('pre_account.web.json')
    d.steps[0].status = 'quantum'
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.steps[0].status).toBe('blocked')
  })

  test('unknown purchase surface is none, and none cannot carry a call to action (rule 4, money fails closed)', () => {
    const d = fixtureJson('account.allowance.web.json')
    d.purchase.surface = 'teleport'
    const r = parseOnboardingDocument(d)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc.purchase?.surface).toBe('none')
      expect(r.doc.purchase?.ctaAllowed).toBe(false)
      expect(r.doc.trialOffer).toBeNull()
    }
  })

  test('cta_allowed absent is not allowed', () => {
    const d = fixtureJson('account.allowance.web.json')
    delete d.purchase.cta_allowed
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.purchase?.ctaAllowed).toBe(false)
  })

  test('unknown fields (top level, policy, step) are ignored (rule 2)', () => {
    const r = parseOnboardingDocument(fixtureJson('forward_compat.unknown_step.ios.json'))
    expect(r.ok).toBe(true)
  })

  test('capabilities outside the closed v1 set are not capabilities (rule 11)', () => {
    const d = fixtureJson('account.active.web.json')
    d.account.capabilities.teleport = { allowed: true }
    const r = parseOnboardingDocument(d)
    expect(r.ok && Object.keys(r.doc.account!.capabilities).sort()).not.toContain('teleport')
  })

  test('a step without `required: false` is required (fail toward stopping)', () => {
    const d = fixtureJson('pre_account.web.json')
    delete d.steps[0].required
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.steps[0].required).toBe(true)
  })
})

describe('schema major and malformed documents', () => {
  test('a newer major is unsupported_schema, never a guess (rule 5)', () => {
    const d = fixtureJson('pre_account.web.json')
    d.schema = 2
    expect(parseOnboardingDocument(d)).toEqual({ ok: false, reason: 'unsupported_schema', schema: 2 })
    expect(outcomeFromRaw(d)).toEqual({ kind: 'unsupported_schema' })
  })

  test('garbage is malformed and maps to the legacy path (rule 6)', () => {
    for (const raw of [null, 'x', 7, [], {}, { schema: 1 }, { schema: 1, stage: 'nope', steps: [] }, { schema: 1, stage: 'account', steps: 'x' }]) {
      const r = parseOnboardingDocument(raw)
      expect(r.ok).toBe(false)
      expect(outcomeFromRaw(raw)).toEqual({ kind: 'legacy', reason: 'malformed' })
    }
  })

  test('pre_account without policy is malformed; account without purchase is malformed', () => {
    const a = fixtureJson('pre_account.web.json')
    delete a.policy
    expect(parseOnboardingDocument(a).ok).toBe(false)
    const b = fixtureJson('account.active.web.json')
    delete b.purchase
    expect(parseOnboardingDocument(b).ok).toBe(false)
  })

  test('update_required still parses when the stage block is missing (rule 7 needs only the client block)', () => {
    const d = fixtureJson('client.update_required.ios.json')
    delete d.policy
    delete d.signup
    expect(parseOnboardingDocument(d).ok).toBe(true)
  })
})

describe('links and request paths from the document are validated once, here', () => {
  test('safeHttpsUrl keeps https and drops everything else', () => {
    expect(safeHttpsUrl('https://beebeeb.io/terms')).toBe('https://beebeeb.io/terms')
    for (const bad of ['javascript:alert(1)', 'http://beebeeb.io', 'data:text/html,x', '//evil.test', '/relative', 'not a url', 42, null]) {
      expect(safeHttpsUrl(bad)).toBeNull()
    }
  })

  test('sameOriginApiPath accepts /api/v1 paths only (contract README rule 8)', () => {
    expect(sameOriginApiPath('/api/v1/auth/pwned-range/{prefix}')).toBe('/api/v1/auth/pwned-range/{prefix}')
    expect(sameOriginApiPath('/api/v1/billing/trial/start')).toBe('/api/v1/billing/trial/start')
    for (const bad of [
      'https://evil.test/api/v1/x',
      '//evil.test/api/v1/x',
      '/api/v1/../admin',
      '/api/v2/x',
      '/other',
      'api/v1/x',
      '/api/v1//x',
      '/api/v1/x?y=1',
      '/api/v1/x#z',
      undefined,
    ]) {
      expect(sameOriginApiPath(bad)).toBeNull()
    }
  })

  test('a hostile breach endpoint is dropped (the ceremony then treats the check as an outage)', () => {
    const d = fixtureJson('pre_account.web.json')
    d.policy.password.breach_check.endpoint = 'https://evil.test/{prefix}'
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.policy?.password.breachCheck).toEqual({ endpoint: null, failOpen: true })
  })

  test('a breach endpoint without exactly one {prefix} slot is dropped', () => {
    for (const ep of ['/api/v1/auth/pwned-range/abc', '/api/v1/{prefix}/{prefix}']) {
      const d = fixtureJson('pre_account.web.json')
      d.policy.password.breach_check.endpoint = ep
      const r = parseOnboardingDocument(d)
      expect(r.ok && r.doc.policy?.password.breachCheck?.endpoint).toBeNull()
    }
  })

  test('a hostile trial start_endpoint drops the offer', () => {
    const d = fixtureJson('account.allowance.web.json')
    d.offers.trial.start_endpoint = 'https://evil.test/api/v1/billing/trial/start'
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.trialOffer).toBeNull()
  })

  test('a non-https document or terms URL is dropped, not rendered', () => {
    const d = fixtureJson('pre_account.web.json')
    d.policy.terms.url = 'javascript:alert(1)'
    d.fallback.url = 'http://beebeeb.io/signup'
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.policy?.terms.url).toBeNull()
    expect(r.ok && r.doc.fallback?.url).toBeNull()
  })

  test('fail_open defaults to the safe reading only when explicitly false', () => {
    const d = fixtureJson('pre_account.web.json')
    d.policy.password.breach_check.fail_open = false
    const r = parseOnboardingDocument(d)
    expect(r.ok && r.doc.policy?.password.breachCheck?.failOpen).toBe(false)
  })
})

describe('the schema-invalid documents (invalid/) are still handled safely by a tolerant client', () => {
  test('unknown required step without any fallback: parser accepts, planner falls back to the hard-coded web fallback', () => {
    const r = parseOnboardingDocument(readInvalid('unknown_required_step_no_fallback.json'))
    expect(r.ok).toBe(true)
  })

  test('a capability outside the closed set is ignored, a verified email with email_unverified denial parses', () => {
    expect(parseOnboardingDocument(readInvalid('capability_unknown_name.json')).ok).toBe(true)
    expect(parseOnboardingDocument(readInvalid('verified_email_denied_email_unverified.json')).ok).toBe(true)
  })
})
