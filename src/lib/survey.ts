/**
 * The exit survey a person reaches from the "trial ended" follow-up email (task 1920).
 *
 * Link: `<APP_URL>/surveys/<id>?token=<token>`. The invitation IS the credential, so the
 * page works without a session and this module talks to the API with a plain `fetch`:
 * no cookies, no bearer token, no global error toasts, and no import of `./api` (which
 * pulls in the crypto worker). The questions come from the server (`GET /api/v1/surveys/{id}`),
 * never from this file; the rules below only mirror what the server will enforce so the
 * person hears about a problem before sending, not after.
 *
 * Server contract: `.claude/skills/beebeeb-api.md` -> "Trial-ended exit survey".
 */
import { getApiUrl } from '@beebeeb/shared'

export type QuestionKind = 'single_choice' | 'short_text' | 'long_text' | 'checkbox'

export interface SurveyDetail {
  id: string
  label: string
  max_length: number
}

export interface SurveyOption {
  value: string
  label: string
  detail: SurveyDetail | null
}

export interface SurveyQuestion {
  id: string
  kind: QuestionKind
  label: string
  help: string | null
  required: boolean
  max_length: number | null
  default: boolean
  options: SurveyOption[]
}

export interface Survey {
  kind: string
  title: string
  intro: string
  privacy_note: string
  answered: boolean
  expires_at: string | null
  questions: SurveyQuestion[]
  thanks: { title: string; body: string }
}

/** What the person has typed or picked: one entry per question id, plus one per detail id. */
export interface SurveyValues {
  /** Question id -> chosen option value / typed text. */
  text: Record<string, string>
  /** Checkbox question id -> ticked. */
  checks: Record<string, boolean>
  /** Detail id -> typed text (only the selected option's detail is ever sent). */
  details: Record<string, string>
}

export const SURVEY_SUPPORT_EMAIL = 'support@beebeeb.io'

/** Shown when the API sends no `intro` (older server). The server's own intro wins. */
export const FALLBACK_INTRO =
  "Your trial ended. Thanks for trying Beebeeb. If you have a minute, we'd really like to know why you didn't continue. It's optional, and it helps us a lot."

const KINDS: readonly QuestionKind[] = ['single_choice', 'short_text', 'long_text', 'checkbox']

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseOption(raw: unknown): SurveyOption | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const value = str(o.value)
  const label = str(o.label)
  if (!value || !label) return null
  let detail: SurveyDetail | null = null
  if (o.detail && typeof o.detail === 'object') {
    const d = o.detail as Record<string, unknown>
    const id = str(d.id)
    const dl = str(d.label)
    if (id && dl) {
      detail = { id, label: dl, max_length: typeof d.max_length === 'number' ? d.max_length : 200 }
    }
  }
  return { value, label, detail }
}

function parseQuestion(raw: unknown): SurveyQuestion | 'unknown' | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  const id = str(q.id)
  const label = str(q.label)
  if (!id || !label) return null
  if (!KINDS.includes(q.kind as QuestionKind)) return 'unknown'
  const kind = q.kind as QuestionKind
  const options = Array.isArray(q.options)
    ? q.options.map(parseOption).filter((o): o is SurveyOption => o !== null)
    : []
  if (kind === 'single_choice' && options.length === 0) return null
  return {
    id,
    kind,
    label,
    help: str(q.help),
    required: q.required === true,
    max_length: typeof q.max_length === 'number' ? q.max_length : null,
    default: q.default === true,
    options,
  }
}

/**
 * Validate a `GET /surveys/{id}` body. Returns null when it is not something this page can
 * safely draw (the page then says "could not load", not a half-built form). A question kind
 * this build does not know is skipped when optional; when REQUIRED it makes the whole survey
 * undrawable, because the person could never satisfy it.
 */
export function parseSurvey(raw: unknown): Survey | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const title = str(s.title)
  const kind = str(s.kind)
  if (!title || !kind || !Array.isArray(s.questions)) return null
  const questions: SurveyQuestion[] = []
  for (const rawQ of s.questions) {
    const q = parseQuestion(rawQ)
    if (q === null) return null
    if (q === 'unknown') {
      if ((rawQ as Record<string, unknown>).required === true) return null
      continue
    }
    questions.push(q)
  }
  const thanksRaw = s.thanks && typeof s.thanks === 'object' ? (s.thanks as Record<string, unknown>) : {}
  return {
    kind,
    title,
    intro: str(s.intro) ?? FALLBACK_INTRO,
    privacy_note: str(s.privacy_note) ?? '',
    answered: s.answered === true,
    expires_at: str(s.expires_at),
    questions,
    thanks: {
      title: str(thanksRaw.title) ?? 'Thank you',
      body: str(thanksRaw.body) ?? 'We read every answer.',
    },
  }
}

/** Empty form: nothing picked, nothing typed, checkboxes at the server's default. */
export function initialValues(survey: Survey): SurveyValues {
  const text: Record<string, string> = {}
  const checks: Record<string, boolean> = {}
  for (const q of survey.questions) {
    if (q.kind === 'checkbox') checks[q.id] = q.default
    else text[q.id] = ''
  }
  return { text, checks, details: {} }
}

/** The detail input of the currently selected option of a single-choice question, if it has one. */
export function selectedDetail(q: SurveyQuestion, values: SurveyValues): SurveyDetail | null {
  if (q.kind !== 'single_choice') return null
  const picked = values.text[q.id]
  return q.options.find((o) => o.value === picked)?.detail ?? null
}

/** Characters the way the server counts them (code points), not UTF-16 units. */
export function charCount(s: string): number {
  let n = 0
  for (const _ of s) n += 1
  return n
}

export interface FieldProblem {
  /** The answers key (a question id or a detail id), matching the server's `field`. */
  field: string
  message: string
}

/** First problem the server would refuse, in question order; null when the form is sendable. */
export function firstProblem(survey: Survey, values: SurveyValues): FieldProblem | null {
  for (const q of survey.questions) {
    if (q.kind === 'checkbox') continue
    const value = (values.text[q.id] ?? '').trim()
    if (q.required && value === '') {
      return {
        field: q.id,
        message: q.kind === 'single_choice' ? 'Please choose one answer.' : 'Please fill this in.',
      }
    }
    if (q.max_length != null && charCount(value) > q.max_length) {
      return { field: q.id, message: `Please keep this to ${q.max_length} characters or fewer.` }
    }
    const detail = selectedDetail(q, values)
    if (detail) {
      const dv = (values.details[detail.id] ?? '').trim()
      if (charCount(dv) > detail.max_length) {
        return { field: detail.id, message: `Please keep this to ${detail.max_length} characters or fewer.` }
      }
    }
  }
  return null
}

/**
 * The `answers` object for `POST /surveys/{id}`: only keys the survey defines, text trimmed,
 * blank optional answers left out, a detail only for the option that is actually selected
 * (the server refuses a detail for an unselected option and refuses unknown keys).
 */
export function buildAnswers(survey: Survey, values: SurveyValues): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const q of survey.questions) {
    if (q.kind === 'checkbox') {
      out[q.id] = values.checks[q.id] === true
      continue
    }
    const value = (values.text[q.id] ?? '').trim()
    if (value === '') continue
    out[q.id] = value
    const detail = selectedDetail(q, values)
    if (detail) {
      const dv = (values.details[detail.id] ?? '').trim()
      if (dv !== '') out[detail.id] = dv
    }
  }
  return out
}

// ── Transport ───────────────────────────────────────────────────────────────

export interface SurveyDeps {
  fetchImpl?: typeof fetch
  apiUrl?: string
}

export type LoadResult =
  | { kind: 'ok'; survey: Survey }
  /** Unknown id, wrong or missing token, expired: the server says one thing for all of them. */
  | { kind: 'invalid' }
  | { kind: 'unavailable'; rateLimited: boolean }

export type SubmitResult =
  | { kind: 'ok' }
  | { kind: 'already_answered' }
  | { kind: 'invalid' }
  /** 400 `invalid_answers`: nothing was consumed, the same link still works. */
  | { kind: 'refused'; field: string | null; message: string }
  | { kind: 'unavailable'; rateLimited: boolean }

function endpoint(id: string, deps: SurveyDeps): string {
  return `${deps.apiUrl ?? getApiUrl()}/api/v1/surveys/${encodeURIComponent(id)}`
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `GET /api/v1/surveys/{id}?token=...`. Never throws; a missing token is "invalid" without a call. */
export async function loadSurvey(id: string, token: string, deps: SurveyDeps = {}): Promise<LoadResult> {
  if (!id || !token) return { kind: 'invalid' }
  const doFetch = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(`${endpoint(id, deps)}?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'unavailable', rateLimited: false }
  }
  if (res.status === 404) return { kind: 'invalid' }
  if (res.status === 429) return { kind: 'unavailable', rateLimited: true }
  if (!res.ok) return { kind: 'unavailable', rateLimited: false }
  const survey = parseSurvey(await readJson(res))
  return survey ? { kind: 'ok', survey } : { kind: 'unavailable', rateLimited: false }
}

/** `POST /api/v1/surveys/{id}`. Never throws. 204 is stored; the token is spent only then. */
export async function submitSurvey(
  id: string,
  token: string,
  answers: Record<string, string | boolean>,
  deps: SurveyDeps = {},
): Promise<SubmitResult> {
  if (!id || !token) return { kind: 'invalid' }
  const doFetch = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(endpoint(id, deps), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, answers }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'unavailable', rateLimited: false }
  }
  if (res.status === 204 || res.status === 200) return { kind: 'ok' }
  if (res.status === 404) return { kind: 'invalid' }
  if (res.status === 409) return { kind: 'already_answered' }
  if (res.status === 429) return { kind: 'unavailable', rateLimited: true }
  if (res.status === 400) {
    const body = await readJson(res)
    return {
      kind: 'refused',
      field: body && typeof body.field === 'string' ? body.field : null,
      message:
        body && typeof body.message === 'string' && body.message
          ? body.message
          : 'Something in your answer was not accepted. Please check it and try again.',
    }
  }
  if (res.status === 413) {
    return { kind: 'refused', field: null, message: 'That is more text than we can take at once. Please shorten it and try again.' }
  }
  return { kind: 'unavailable', rateLimited: false }
}
