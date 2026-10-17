import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isVaultFreePath } from '../src/lib/vault-free-paths'
import {
  buildAnswers,
  charCount,
  firstProblem,
  initialValues,
  loadSurvey,
  parseSurvey,
  selectedDetail,
  submitSurvey,
  FALLBACK_INTRO,
  type Survey,
  type SurveyValues,
} from '../src/lib/survey'

// The shape `GET /api/v1/surveys/{id}` answers for trial_ended_v1 (server task 1920).
const WIRE = {
  kind: 'trial_ended_v1',
  title: "We'd really like to know",
  intro: 'Your Beebeeb trial ended and you chose not to continue.',
  privacy_note: 'We store your answers with your account.',
  answered: false,
  expires_at: '2026-11-16T10:00:00Z',
  questions: [
    {
      id: 'reason',
      kind: 'single_choice',
      label: 'What was the main reason?',
      required: true,
      options: [
        { value: 'too_expensive', label: 'It was more than I want to pay' },
        { value: 'missing_feature', label: 'I was missing a feature', detail: { id: 'missing_feature_detail', label: 'Which feature?', max_length: 200 } },
        { value: 'other_service', label: 'I chose another service', detail: { id: 'other_service_detail', label: 'Which one?', max_length: 200 } },
        { value: 'other', label: 'Something else' },
      ],
    },
    { id: 'come_back', kind: 'short_text', label: 'What would make you come back?', help: 'Optional.', required: false, max_length: 500 },
    { id: 'anything_else', kind: 'long_text', label: 'Anything else?', help: 'Optional.', required: false, max_length: 2000 },
    { id: 'contact_ok', kind: 'checkbox', label: 'You may email me about my answer', required: false, default: false },
  ],
  thanks: { title: 'Thank you', body: 'We read every answer.' },
}

function survey(): Survey {
  const s = parseSurvey(WIRE)
  if (!s) throw new Error('fixture must parse')
  return s
}

function filled(over: Partial<SurveyValues> = {}): SurveyValues {
  const base = initialValues(survey())
  return {
    text: { ...base.text, ...over.text },
    checks: { ...base.checks, ...over.checks },
    details: { ...base.details, ...over.details },
  }
}

function fakeFetch(status: number, body?: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

const deps = (impl: typeof fetch) => ({ fetchImpl: impl, apiUrl: 'https://api.example.test' })

describe('parseSurvey', () => {
  test('reads the questions from the API answer, in order', () => {
    const s = survey()
    expect(s.questions.map((q) => q.id)).toEqual(['reason', 'come_back', 'anything_else', 'contact_ok'])
    expect(s.questions[0].options).toHaveLength(4)
    expect(s.questions[0].options[1].detail?.id).toBe('missing_feature_detail')
    expect(s.title).toBe("We'd really like to know")
    expect(s.thanks.body).toBe('We read every answer.')
  })

  test('a malformed body is not drawable', () => {
    expect(parseSurvey(null)).toBeNull()
    expect(parseSurvey({})).toBeNull()
    expect(parseSurvey({ ...WIRE, questions: 'x' })).toBeNull()
    expect(parseSurvey({ ...WIRE, questions: [{ id: 'reason', kind: 'single_choice', label: 'x', options: [] }] })).toBeNull()
  })

  test('an unknown OPTIONAL question kind is skipped, an unknown REQUIRED one makes it undrawable', () => {
    const optional = parseSurvey({ ...WIRE, questions: [...WIRE.questions, { id: 'rating', kind: 'scale', label: 'x', required: false }] })
    expect(optional?.questions.map((q) => q.id)).toEqual(['reason', 'come_back', 'anything_else', 'contact_ok'])
    expect(parseSurvey({ ...WIRE, questions: [...WIRE.questions, { id: 'rating', kind: 'scale', label: 'x', required: true }] })).toBeNull()
  })

  test('a missing intro falls back to the warm default, never to blank', () => {
    const { intro: _intro, ...rest } = WIRE
    expect(parseSurvey(rest)?.intro).toBe(FALLBACK_INTRO)
  })
})

describe('form rules mirror the server', () => {
  test('nothing picked: the required reason is the first problem', () => {
    expect(firstProblem(survey(), filled())).toEqual({ field: 'reason', message: 'Please choose one answer.' })
  })

  test('a picked reason is sendable with every optional box empty', () => {
    expect(firstProblem(survey(), filled({ text: { reason: 'too_expensive' } }))).toBeNull()
  })

  test('text over its limit is refused before sending, counted in characters', () => {
    const over = 'x'.repeat(501)
    expect(firstProblem(survey(), filled({ text: { reason: 'other', come_back: over } }))?.field).toBe('come_back')
    expect(charCount('a\u{1F600}b')).toBe(3)
  })

  test('a detail longer than its limit is refused only while ITS option is selected', () => {
    const long = 'y'.repeat(201)
    expect(firstProblem(survey(), filled({ text: { reason: 'missing_feature' }, details: { missing_feature_detail: long } }))?.field).toBe('missing_feature_detail')
    expect(firstProblem(survey(), filled({ text: { reason: 'other' }, details: { missing_feature_detail: long } }))).toBeNull()
  })

  test('selectedDetail follows the chosen option', () => {
    const q = survey().questions[0]
    expect(selectedDetail(q, filled({ text: { reason: 'other_service' } }))?.id).toBe('other_service_detail')
    expect(selectedDetail(q, filled({ text: { reason: 'too_expensive' } }))).toBeNull()
  })
})

describe('buildAnswers', () => {
  test('sends only what was answered: trimmed text, blank optionals dropped, contact_ok always explicit', () => {
    const answers = buildAnswers(survey(), filled({ text: { reason: 'too_expensive', come_back: '  a cheaper plan  ', anything_else: '   ' } }))
    expect(answers).toEqual({ reason: 'too_expensive', come_back: 'a cheaper plan', contact_ok: false })
  })

  test('a detail goes along only for the selected option, never a stale one', () => {
    const values = filled({
      text: { reason: 'other_service' },
      details: { missing_feature_detail: 'search', other_service_detail: '  Proton  ' },
    })
    const answers = buildAnswers(survey(), values)
    expect(answers).toEqual({ reason: 'other_service', other_service_detail: 'Proton', contact_ok: false })
    expect('missing_feature_detail' in answers).toBe(false)
  })

  test('a blank detail is left out, and a ticked box is sent as true', () => {
    const answers = buildAnswers(survey(), filled({ text: { reason: 'missing_feature' }, details: { missing_feature_detail: '  ' }, checks: { contact_ok: true } }))
    expect(answers).toEqual({ reason: 'missing_feature', contact_ok: true })
  })

  test('never invents a key the survey does not define', () => {
    const keys = Object.keys(buildAnswers(survey(), filled({ text: { reason: 'other', stray: 'x' } })))
    expect(keys.every((k) => ['reason', 'come_back', 'anything_else', 'contact_ok'].includes(k))).toBe(true)
  })
})

describe('loadSurvey', () => {
  test('GET carries the token in the query, no cookies, no referrer, no cache', async () => {
    const f = fakeFetch(200, WIRE)
    const r = await loadSurvey('a1b2', 'tok_en-1', deps(f.impl))
    expect(r.kind).toBe('ok')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe('https://api.example.test/api/v1/surveys/a1b2?token=tok_en-1')
    expect(f.calls[0].init.credentials).toBe('omit')
    expect(f.calls[0].init.cache).toBe('no-store')
    expect(f.calls[0].init.referrerPolicy).toBe('no-referrer')
    expect(f.calls[0].init.method).toBe('GET')
  })

  test('the id and token are encoded, never spliced raw into the URL', async () => {
    const f = fakeFetch(200, WIRE)
    await loadSurvey('a/../b', 't&x=1', deps(f.impl))
    expect(f.calls[0].url).toBe('https://api.example.test/api/v1/surveys/a%2F..%2Fb?token=t%26x%3D1')
  })

  test('a missing token is "invalid" without any request', async () => {
    const f = fakeFetch(200, WIRE)
    expect(await loadSurvey('a1b2', '', deps(f.impl))).toEqual({ kind: 'invalid' })
    expect(await loadSurvey('', 'tok', deps(f.impl))).toEqual({ kind: 'invalid' })
    expect(f.calls).toHaveLength(0)
  })

  test('the server 404 is one answer, whatever its body says', async () => {
    expect(await loadSurvey('a', 'b', deps(fakeFetch(404, { error: 'not found', message: 'This survey link is not valid or has expired.' }).impl))).toEqual({ kind: 'invalid' })
    expect(await loadSurvey('a', 'b', deps(fakeFetch(404, { error: 'expired' }).impl))).toEqual({ kind: 'invalid' })
  })

  test('429, 500, a network failure and a malformed 200 are "unavailable", not "invalid"', async () => {
    expect(await loadSurvey('a', 'b', deps(fakeFetch(429, {}).impl))).toEqual({ kind: 'unavailable', rateLimited: true })
    expect(await loadSurvey('a', 'b', deps(fakeFetch(500, {}).impl))).toEqual({ kind: 'unavailable', rateLimited: false })
    expect(await loadSurvey('a', 'b', deps(fakeFetch(200, { nope: 1 }).impl))).toEqual({ kind: 'unavailable', rateLimited: false })
    const boom = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await loadSurvey('a', 'b', deps(boom))).toEqual({ kind: 'unavailable', rateLimited: false })
  })

  test('answered:true comes through so the page can say so', async () => {
    const r = await loadSurvey('a', 'b', deps(fakeFetch(200, { ...WIRE, answered: true }).impl))
    expect(r.kind === 'ok' && r.survey.answered).toBe(true)
  })
})

describe('submitSurvey', () => {
  test('POST sends {token, answers} as JSON, no cookies', async () => {
    const f = fakeFetch(204)
    const r = await submitSurvey('a1b2', 'tok', { reason: 'other', contact_ok: false }, deps(f.impl))
    expect(r).toEqual({ kind: 'ok' })
    expect(f.calls[0].url).toBe('https://api.example.test/api/v1/surveys/a1b2')
    expect(f.calls[0].init.method).toBe('POST')
    expect(f.calls[0].init.credentials).toBe('omit')
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ token: 'tok', answers: { reason: 'other', contact_ok: false } })
    // The token travels in the body of a POST, never in its URL.
    expect(f.calls[0].url.includes('tok')).toBe(false)
  })

  test('409 is "already answered"; 404 is "invalid"', async () => {
    expect(await submitSurvey('a', 't', {}, deps(fakeFetch(409, { error: 'already_answered' }).impl))).toEqual({ kind: 'already_answered' })
    expect(await submitSurvey('a', 't', {}, deps(fakeFetch(404, { error: 'not found' }).impl))).toEqual({ kind: 'invalid' })
  })

  test('400 invalid_answers hands back the field and the server sentence', async () => {
    const r = await submitSurvey('a', 't', {}, deps(fakeFetch(400, { error: 'invalid_answers', field: 'come_back', message: 'Too long.' }).impl))
    expect(r).toEqual({ kind: 'refused', field: 'come_back', message: 'Too long.' })
  })

  test('413 is a refusal with its own words; 429 and 5xx are "unavailable"', async () => {
    const big = await submitSurvey('a', 't', {}, deps(fakeFetch(413, {}).impl))
    expect(big.kind === 'refused' && big.field === null).toBe(true)
    expect(await submitSurvey('a', 't', {}, deps(fakeFetch(429, {}).impl))).toEqual({ kind: 'unavailable', rateLimited: true })
    expect(await submitSurvey('a', 't', {}, deps(fakeFetch(503, {}).impl))).toEqual({ kind: 'unavailable', rateLimited: false })
  })
})

describe('the page stays out of the vault and the crypto', () => {
  const FORBIDDEN = /(key-context|crypto|vault|wasm|lib\/api['"]|auth-context|drive-data)/i
  const importsOf = (file: string) =>
    readFileSync(new URL(file, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /^\s*import\s+['"]/.test(l))

  test('survey.ts and survey.tsx import nothing from the vault, key, crypto or api modules', () => {
    const lines = [...importsOf('../src/lib/survey.ts'), ...importsOf('../src/pages/survey.tsx')]
    expect(lines.length).toBeGreaterThan(5)
    expect(lines.filter((l) => FORBIDDEN.test(l))).toEqual([])
  })

  test('only the exact survey shape is served outside the providers; neighbours get the normal app', () => {
    expect(isVaultFreePath('/surveys/6f1c0b5e-aaaa-bbbb-cccc-0123456789ab')).toBe(true)
    expect(isVaultFreePath('/surveys/abc/')).toBe(true)
    for (const p of ['/', '/surveys', '/surveys/', '/surveys/a/b', '/survey/abc', '/login', '/s/abc', '/return-to-app']) {
      expect(isVaultFreePath(p), p).toBe(false)
    }
  })

  test('app.tsx mounts the survey route OUTSIDE every provider that starts the vault or crypto', () => {
    const app = readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8')
    const open = app.indexOf('<VaultFreePages>')
    const close = app.indexOf('</VaultFreePages>')
    expect(open).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    // Every provider that touches the session, the vault key or the sync engine sits inside the wrapper.
    for (const provider of ['<ImpersonationProvider>', '<DevAuthGate>', '<AuthProvider>', '<KeyProvider>', '<WsProvider>', '<SyncProvider>']) {
      const at = app.indexOf(provider, open)
      expect(at, provider).toBeGreaterThan(open)
      expect(at, provider).toBeLessThan(close)
    }
    // The wrapper itself renders the survey route and nothing else.
    expect(app).toMatch(/function VaultFreePages[\s\S]*?<Route path="\/surveys\/:id" element=\{<SurveyPage \/>\} \/>/)
    // The main route table no longer carries it (so it can never be reached with providers by accident).
    expect(app.split('path="/surveys/:id"').length - 1).toBe(1)
    // And a stale session can never bounce it to /login (defence in depth).
    expect(app).toMatch(/PUBLIC_ROUTE_PATTERNS[\s\S]*?\/\^\\\/surveys\\\//)
  })
})
