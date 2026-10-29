/**
 * Task 1920, review round on web#168.
 *
 *  1. Privacy (Codex thread on survey.tsx:5): the survey promises answers are not tied to the
 *     person unless they tick the box, so the page must make no credentialed request at all.
 *     The old page rendered AuthShell, which mounts AnnouncementBanner -> listAnnouncements()
 *     through the shared request() client (bearer + `credentials: 'include'`). Here: the page's
 *     whole local import graph never reaches that client, and the survey GET/POST send no
 *     Authorization header and no cookies. The browser-level proof is in e2e/1920-survey.spec.ts.
 *  2. Limits (Codex thread on survey.tsx:196): HTML `maxLength` counts UTF-16 code units, the
 *     server counts code points, so the inputs carry no `maxLength`; the code-point rule in
 *     `firstProblem` is the one limit.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveyForm } from '../src/pages/survey'
import { charCount, firstProblem, initialValues, loadSurvey, parseSurvey, submitSurvey, type Survey } from '../src/lib/survey'

const SRC = path.resolve(import.meta.dir, '../src')

const WIRE = {
  kind: 'trial_ended_v1',
  title: 'Why?',
  intro: 'Intro.',
  privacy_note: 'Note.',
  answered: false,
  expires_at: '2026-11-16T10:00:00Z',
  questions: [
    {
      id: 'reason',
      kind: 'single_choice',
      label: 'What was the main reason?',
      required: true,
      options: [
        { value: 'missing_feature', label: 'I was missing a feature', detail: { id: 'missing_feature_detail', label: 'Which feature?', max_length: 200 } },
        { value: 'other', label: 'Something else' },
      ],
    },
    { id: 'come_back', kind: 'short_text', label: 'What would make you come back?', required: false, max_length: 500 },
    { id: 'anything_else', kind: 'long_text', label: 'Anything else?', required: false, max_length: 2000 },
    { id: 'contact_ok', kind: 'checkbox', label: 'You may email me', required: false, default: false },
  ],
  thanks: { title: 'Thank you', body: 'We read every answer.' },
}

function survey(): Survey {
  const s = parseSurvey(WIRE)
  if (!s) throw new Error('fixture must parse')
  return s
}

/** Every local module reachable from `entry` through static/dynamic relative imports. */
function localImportClosure(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec)
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (existsSync(cand) && !cand.endsWith('/') && /\.(ts|tsx)$/.test(cand)) return cand
    }
    return null
  }
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const next = resolve(file, m[1])
      if (next) queue.push(next)
    }
  }
  return [...seen].map((f) => path.relative(SRC, f))
}

describe('the survey page makes no credentialed request', () => {
  const closure = localImportClosure(path.join(SRC, 'pages/survey.tsx'))

  test('its local import graph never reaches the api client, the announcement banner or the auth shell', () => {
    expect(closure.length).toBeGreaterThan(1)
    const offenders = closure.filter((f) => /^(lib\/api\.ts|components\/announcement-banner\.tsx|components\/auth-shell\.tsx|lib\/auth-context\.tsx)$/.test(f))
    expect(offenders).toEqual([])
  })

  test('no module in that graph takes the shared request() client or the announcements call', () => {
    const uses = closure.filter((f) => {
      // Code only: a comment that names the banner's call is not a call.
      const src = readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return /\b(request|listAnnouncements|getToken)\b[^\n]*from\s+['"]@beebeeb\/shared['"]/.test(src) || /\blistAnnouncements\s*\(/.test(src)
    })
    expect(uses).toEqual([])
  })

  // Headers normalises names to lower case, so `Authorization` and `authorization` both show up here.
  const lowerKeys = (h: HeadersInit | undefined) => [...new Headers(h ?? {}).keys()]

  test('the survey GET carries no Authorization header and no cookies', async () => {
    const calls: RequestInit[] = []
    const impl = (async (_url: string, init: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify(WIRE), { status: 200 })
    }) as unknown as typeof fetch
    await loadSurvey('a1', 'tok', { fetchImpl: impl, apiUrl: 'https://api.example.test' })
    expect(calls).toHaveLength(1)
    expect(lowerKeys(calls[0].headers)).not.toContain('authorization')
    expect(lowerKeys(calls[0].headers)).not.toContain('cookie')
    expect(calls[0].credentials).toBe('omit')
  })

  test('the survey POST carries no Authorization header and no cookies', async () => {
    const calls: RequestInit[] = []
    const impl = (async (_url: string, init: RequestInit) => {
      calls.push(init)
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    await submitSurvey('a1', 'tok', { reason: 'other', contact_ok: false }, { fetchImpl: impl, apiUrl: 'https://api.example.test' })
    expect(calls).toHaveLength(1)
    expect(lowerKeys(calls[0].headers)).not.toContain('authorization')
    expect(lowerKeys(calls[0].headers)).not.toContain('cookie')
    expect(calls[0].credentials).toBe('omit')
  })
})

describe('text limits are code points, not UTF-16 units', () => {
  const EMOJI = '\u{1F600}'

  test('500 emoji fit a 500-character answer, 501 are refused', () => {
    const s = survey()
    const base = initialValues(s)
    const at = (n: number) => ({ ...base, text: { ...base.text, reason: 'other', come_back: EMOJI.repeat(n) } })
    expect(EMOJI.repeat(500).length).toBe(1000) // what HTML maxLength would count
    expect(charCount(EMOJI.repeat(500))).toBe(500)
    expect(firstProblem(s, at(500))).toBeNull()
    expect(firstProblem(s, at(501))).toEqual({ field: 'come_back', message: 'Please keep this to 500 characters or fewer.' })
  })

  test('the same holds for a detail field (200)', () => {
    const s = survey()
    const base = initialValues(s)
    const at = (n: number) => ({
      ...base,
      text: { ...base.text, reason: 'missing_feature' },
      details: { ...base.details, missing_feature_detail: EMOJI.repeat(n) },
    })
    expect(firstProblem(s, at(200))).toBeNull()
    expect(firstProblem(s, at(201))?.field).toBe('missing_feature_detail')
  })

  test('the drawn form carries no maxLength on any field (it would count UTF-16 units)', () => {
    const s = survey()
    const html = renderToStaticMarkup(
      <SurveyForm survey={s} id="a1" token="tok" onSent={() => {}} onAlreadyAnswered={() => {}} onInvalid={() => {}} />,
    )
    // Sanity: the text fields are actually in the markup this test inspects.
    expect((html.match(/<textarea|<input type="text"/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(html.toLowerCase()).not.toContain('maxlength')
  })

  test('no field in the page source sets maxLength (the detail input is drawn only once its option is picked)', () => {
    const page = readFileSync(path.join(SRC, 'pages/survey.tsx'), 'utf8')
    expect(page).toContain('<input')
    expect(page.match(/maxLength\s*=/g) ?? []).toEqual([])
  })
})
