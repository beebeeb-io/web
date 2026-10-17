import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BBButton, Icon } from '@beebeeb/shared'
import { AuthShell } from '../components/auth-shell'
import {
  SURVEY_SUPPORT_EMAIL,
  buildAnswers,
  charCount,
  firstProblem,
  initialValues,
  loadSurvey,
  selectedDetail,
  submitSurvey,
  type FieldProblem,
  type Survey,
  type SurveyQuestion,
  type SurveyValues,
} from '../lib/survey'

/**
 * `/surveys/:id?token=...` (task 1920): the "why didn't you continue?" survey that the
 * trial-ended follow-up email links to.
 *
 * Public on purpose. The invitation is the credential, so this page needs no session and it
 * deliberately imports nothing from the vault, key or crypto modules (`../lib/survey` talks
 * to the API with a plain `fetch`, no cookies). The questions, the intro, the privacy note and
 * the thank-you all come from the server's answer, never from this file.
 *
 * The token is read once into component state and then removed from the address bar
 * (`navigate(..., { replace: true })`, i.e. `history.replaceState`), so it does not linger in
 * the history list, a screenshot or a shared tab. A reload therefore needs the email link again.
 *
 * Every refusal of the link itself (unknown, mistyped, expired, wrong token) is ONE screen:
 * the server answers all of them the same way, and so does this page, so it never reveals
 * whether an address or an account exists.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'unavailable'; rateLimited: boolean }
  | { kind: 'form'; survey: Survey }
  | { kind: 'answered'; survey: Survey | null }
  | { kind: 'thanks'; survey: Survey }

const fieldId = (key: string) => `survey-field-${key}`

const inputClass =
  'w-full rounded-md border bg-paper px-3 py-2.5 text-base sm:text-sm text-ink placeholder:text-ink-4 outline-none ' +
  'focus:ring-2 focus:ring-amber/30 focus:border-amber-deep'

function Support() {
  return (
    <a href={`mailto:${SURVEY_SUPPORT_EMAIL}`} className="text-amber-deep font-medium hover:underline">
      {SURVEY_SUPPORT_EMAIL}
    </a>
  )
}

function Spinner() {
  return <div aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-amber" />
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <p id={id} data-testid="survey-field-error" className="mt-1.5 text-[13px] leading-snug text-red">
      {message}
    </p>
  )
}

function Hint({ q, count }: { q: SurveyQuestion; count: number }) {
  const showCount = q.max_length != null && count >= q.max_length * 0.8
  if (!q.help && !showCount) return null
  return (
    <div className="mt-1 flex items-baseline justify-between gap-3 text-[12px] leading-snug text-ink-3">
      <span>{q.help}</span>
      {showCount && (
        <span className="font-mono shrink-0 tabular-nums">
          {count} / {q.max_length}
        </span>
      )}
    </div>
  )
}

function ChoiceQuestion({
  q,
  values,
  problem,
  onPick,
  onDetail,
}: {
  q: SurveyQuestion
  values: SurveyValues
  problem: FieldProblem | null
  onPick: (value: string) => void
  onDetail: (id: string, value: string) => void
}) {
  const picked = values.text[q.id]
  const mine = problem && (problem.field === q.id ? problem : null)
  const errId = `${fieldId(q.id)}-error`
  return (
    <fieldset
      aria-describedby={mine ? errId : undefined}
      aria-required={q.required || undefined}
      className="min-w-0 border-0 p-0 m-0"
      data-testid={`survey-q-${q.id}`}
    >
      <legend className="mb-2 text-[14px] font-semibold text-ink leading-snug">
        {q.label}
        {q.required && <span className="ml-2 text-[12px] font-normal text-ink-3">Required</span>}
      </legend>
      <div className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const selected = picked === opt.value
          const detail = selected ? selectedDetail(q, values) : null
          const detailProblem = detail && problem?.field === detail.id ? problem : null
          const detailValue = detail ? (values.details[detail.id] ?? '') : ''
          return (
            <div
              key={opt.value}
              className={`rounded-md border transition-colors ${
                selected ? 'border-ink bg-paper-2' : 'border-line bg-paper hover:bg-paper-2'
              }`}
            >
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="radio"
                  id={i === 0 ? fieldId(q.id) : undefined}
                  name={q.id}
                  value={opt.value}
                  checked={selected}
                  onChange={() => onPick(opt.value)}
                  aria-invalid={mine ? true : undefined}
                  className="h-4 w-4 shrink-0 accent-ink"
                />
                <span className="text-[14px] leading-snug text-ink">{opt.label}</span>
              </label>
              {detail && (
                <div className="px-3 pb-3 pl-10">
                  <label htmlFor={fieldId(detail.id)} className="mb-1.5 block text-xs font-medium text-ink-2">
                    {detail.label}
                  </label>
                  <input
                    type="text"
                    id={fieldId(detail.id)}
                    value={detailValue}
                    maxLength={detail.max_length}
                    onChange={(e) => onDetail(detail.id, e.target.value)}
                    autoComplete="off"
                    aria-invalid={detailProblem ? true : undefined}
                    aria-describedby={detailProblem ? `${fieldId(detail.id)}-error` : undefined}
                    className={`${inputClass} ${detailProblem ? 'border-red' : 'border-line'}`}
                  />
                  <FieldError id={`${fieldId(detail.id)}-error`} message={detailProblem?.message ?? null} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <FieldError id={errId} message={mine?.message ?? null} />
    </fieldset>
  )
}

function TextQuestion({
  q,
  values,
  problem,
  onText,
}: {
  q: SurveyQuestion
  values: SurveyValues
  problem: FieldProblem | null
  onText: (id: string, value: string) => void
}) {
  const value = values.text[q.id] ?? ''
  const mine = problem?.field === q.id ? problem : null
  const errId = `${fieldId(q.id)}-error`
  const cls = `${inputClass} ${mine ? 'border-red' : 'border-line'}`
  return (
    <div data-testid={`survey-q-${q.id}`}>
      <label htmlFor={fieldId(q.id)} className="mb-2 block text-[14px] font-semibold text-ink leading-snug">
        {q.label}
        {q.required && <span className="ml-2 text-[12px] font-normal text-ink-3">Required</span>}
      </label>
      {q.kind === 'long_text' ? (
        <textarea
          id={fieldId(q.id)}
          rows={4}
          value={value}
          maxLength={q.max_length ?? undefined}
          onChange={(e) => onText(q.id, e.target.value)}
          aria-invalid={mine ? true : undefined}
          aria-describedby={mine ? errId : undefined}
          aria-required={q.required || undefined}
          className={`${cls} resize-y leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          id={fieldId(q.id)}
          value={value}
          maxLength={q.max_length ?? undefined}
          onChange={(e) => onText(q.id, e.target.value)}
          autoComplete="off"
          aria-invalid={mine ? true : undefined}
          aria-describedby={mine ? errId : undefined}
          aria-required={q.required || undefined}
          className={cls}
        />
      )}
      <Hint q={q} count={charCount(value)} />
      <FieldError id={errId} message={mine?.message ?? null} />
    </div>
  )
}

function SurveyForm({
  survey,
  onSent,
  onAlreadyAnswered,
  onInvalid,
  id,
  token,
}: {
  survey: Survey
  id: string
  token: string
  onSent: () => void
  onAlreadyAnswered: () => void
  onInvalid: () => void
}) {
  const [values, setValues] = useState<SurveyValues>(() => initialValues(survey))
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Move focus to the field that needs attention once it has rendered its error.
  useEffect(() => {
    if (!problem) return
    const el = document.getElementById(fieldId(problem.field))
    el?.focus()
    el?.scrollIntoView?.({ block: 'center' })
  }, [problem])

  const clearProblem = () => {
    if (problem) setProblem(null)
    if (banner) setBanner(null)
  }

  const setText = (key: string, value: string) => {
    clearProblem()
    setValues((v) => ({ ...v, text: { ...v.text, [key]: value } }))
  }
  const setDetail = (key: string, value: string) => {
    clearProblem()
    setValues((v) => ({ ...v, details: { ...v.details, [key]: value } }))
  }
  const setCheck = (key: string, value: boolean) =>
    setValues((v) => ({ ...v, checks: { ...v.checks, [key]: value } }))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (sending) return
    const found = firstProblem(survey, values)
    if (found) {
      setBanner(null)
      setProblem(found)
      return
    }
    setProblem(null)
    setBanner(null)
    setSending(true)
    const result = await submitSurvey(id, token, buildAnswers(survey, values))
    setSending(false)
    switch (result.kind) {
      case 'ok':
        onSent()
        return
      case 'already_answered':
        onAlreadyAnswered()
        return
      case 'invalid':
        onInvalid()
        return
      case 'refused':
        if (result.field && document.getElementById(fieldId(result.field))) {
          setProblem({ field: result.field, message: result.message })
        } else {
          setBanner(result.message)
        }
        return
      case 'unavailable':
        setBanner(
          result.rateLimited
            ? 'Too many tries from this network just now. Your answers are still here. Please wait a minute and send again.'
            : 'We could not send this. Your answers are still here. Please check your connection and try again.',
        )
    }
  }

  // The privacy note belongs right above the box it talks about ("the box below").
  const firstCheckbox = survey.questions.find((q) => q.kind === 'checkbox')?.id ?? null
  const note = survey.privacy_note ? (
    <p data-testid="survey-privacy-note" className="text-[13px] leading-relaxed text-ink-3">
      {survey.privacy_note}
    </p>
  ) : null

  return (
    <form onSubmit={onSubmit} noValidate data-testid="survey-form" className="flex flex-col gap-5">
      {survey.questions.map((q) => {
        if (q.kind === 'single_choice') {
          return (
            <ChoiceQuestion
              key={q.id}
              q={q}
              values={values}
              problem={problem}
              onPick={(v) => setText(q.id, v)}
              onDetail={setDetail}
            />
          )
        }
        if (q.kind === 'checkbox') {
          const cid = fieldId(q.id)
          return (
            <div key={q.id} className="flex flex-col gap-3" data-testid={`survey-q-${q.id}`}>
              {q.id === firstCheckbox && note}
              <label htmlFor={cid} className="flex cursor-pointer items-start gap-3 min-h-[44px]">
                <input
                  type="checkbox"
                  id={cid}
                  checked={values.checks[q.id] === true}
                  onChange={(e) => setCheck(q.id, e.target.checked)}
                  aria-describedby={q.help ? `${cid}-help` : undefined}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14px] leading-snug text-ink">{q.label}</span>
                  {q.help && (
                    <span id={`${cid}-help`} className="text-[12px] leading-snug text-ink-3">
                      {q.help}
                    </span>
                  )}
                </span>
              </label>
            </div>
          )
        }
        return <TextQuestion key={q.id} q={q} values={values} problem={problem} onText={setText} />
      })}
      {firstCheckbox === null && note}

      <div aria-live="assertive" className={banner ? '' : 'sr-only'}>
        {banner && (
          <p
            role="alert"
            data-testid="survey-banner"
            className="rounded-md border border-red-border bg-red-bg px-3 py-2.5 text-[13px] leading-snug text-ink"
          >
            {banner}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <BBButton type="submit" variant="amber" size="lg" disabled={sending} className="w-full" data-testid="survey-submit">
          {sending ? 'Sending...' : 'Send my answer'}
        </BBButton>
        <p className="text-[12px] leading-relaxed text-ink-3">
          You can also just close this page. Nothing happens if you do.
        </p>
      </div>
    </form>
  )
}

export function SurveyPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // Read once. After the strip below the address bar no longer carries it; this is the only copy.
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '')
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const previous = document.title
    document.title = 'A question from Beebeeb'
    return () => {
      document.title = previous
    }
  }, [])

  // Take the token out of the address bar and the history entry the moment it has been read.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (!params.has('token')) return
    params.delete('token')
    const rest = params.toString()
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '', hash: location.hash }, { replace: true })
  }, [location.pathname, location.search, location.hash, navigate])

  useEffect(() => {
    let cancelled = false
    setView({ kind: 'loading' })
    loadSurvey(id, token).then((result) => {
      if (cancelled) return
      if (result.kind === 'ok') {
        setView(result.survey.answered ? { kind: 'answered', survey: result.survey } : { kind: 'form', survey: result.survey })
      } else if (result.kind === 'invalid') {
        setView({ kind: 'invalid' })
      } else {
        setView({ kind: 'unavailable', rateLimited: result.rateLimited })
      }
    })
    return () => {
      cancelled = true
    }
  }, [id, token, attempt])

  const toTop = () => {
    if (typeof window !== 'undefined') window.scrollTo?.(0, 0)
  }

  switch (view.kind) {
    case 'loading':
      return (
        <AuthShell title="One question" hideTrust>
          <div role="status" data-testid="survey-loading" className="flex items-center gap-2.5 text-[13px] text-ink-3">
            <Spinner />
            <span>Loading</span>
          </div>
        </AuthShell>
      )

    case 'invalid':
      return (
        <AuthShell title="This link does not work" hideTrust>
          <div data-testid="survey-invalid" className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-2">
            <p>This survey link is not valid or has expired.</p>
            <p>
              If you came from our email, try the link in that email again. You can also write to <Support />.
            </p>
          </div>
        </AuthShell>
      )

    case 'unavailable':
      return (
        <AuthShell title="We could not load this" hideTrust>
          <div data-testid="survey-unavailable" className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink-2">
            <p>
              {view.rateLimited
                ? 'There have been too many tries from this network just now. Please wait a minute and try again.'
                : 'Something on our side or on the way here did not work. Nothing you did caused it.'}
            </p>
            <div>
              <BBButton variant="default" size="md" onClick={() => setAttempt((n) => n + 1)} data-testid="survey-retry">
                Try again
              </BBButton>
            </div>
          </div>
        </AuthShell>
      )

    case 'answered':
      return (
        <AuthShell title="You already answered this" hideTrust>
          <div role="status" data-testid="survey-already-answered" className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-2">
            <p>This link has been used, so there is nothing more to send.</p>
            {view.survey && <p>{view.survey.thanks.body}</p>}
            <Link to="/" className="self-start font-medium text-amber-deep hover:underline">
              Go to Beebeeb
            </Link>
          </div>
        </AuthShell>
      )

    case 'thanks':
      return (
        <AuthShell title={view.survey.thanks.title} hideTrust>
          <div role="status" data-testid="survey-thanks" className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-2">
            <div
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full border border-green-border bg-green-bg text-green"
            >
              <Icon name="check" size={18} />
            </div>
            <p className="text-[14px] text-ink">{view.survey.thanks.body}</p>
            <Link to="/" className="self-start font-medium text-amber-deep hover:underline">
              Go to Beebeeb
            </Link>
          </div>
        </AuthShell>
      )

    case 'form':
      return (
        <AuthShell title={view.survey.title} subtitle={view.survey.intro} hideTrust>
          <SurveyForm
            survey={view.survey}
            id={id}
            token={token}
            onSent={() => {
              setView({ kind: 'thanks', survey: view.survey })
              toTop()
            }}
            onAlreadyAnswered={() => {
              setView({ kind: 'answered', survey: view.survey })
              toTop()
            }}
            onInvalid={() => {
              setView({ kind: 'invalid' })
              toTop()
            }}
          />
        </AuthShell>
      )
  }
}
