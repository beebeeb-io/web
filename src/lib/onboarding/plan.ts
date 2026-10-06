/**
 * The pure step planner (task 1745, spec 5.5 and 5.8).
 *
 * `planScreen(doc, completed)` answers one question: what does the person see
 * now? It owns every forward-compatibility rule so the React layer never has to
 * re-derive them:
 *
 *   - `client.status = update_required` blocks everything (rule 7).
 *   - Unknown OPTIONAL step id: skipped silently. Unknown REQUIRED step id:
 *     stop there and show the step's `fallback`, else the document's, else the
 *     hard-coded web fallback (rule 3).
 *   - Unknown step status is `blocked` (rule 4, already applied by the parser):
 *     a blocked optional step is skipped, a blocked required step stops.
 *   - `create_account` runs only after every other required pre-account step is
 *     done, whatever order the server listed them in (spec 5.5 invariant).
 *   - Unknown `account.state` is only a label; the summary reads capabilities.
 *
 * `completed` is the set of step ids the CLIENT finished this session. Before an
 * account exists the server cannot know (every pre-account step arrives `todo`),
 * so progress is local; once the account exists the document is refetched and
 * the server's `status` is the truth.
 *
 * No React, no I/O, no crypto: the password and phrase steps are carried out by
 * the core WASM ceremony in the components, never here.
 */

import type { Fallback, OnboardingDocument, OnboardingStep, Stage } from './types'

/** Where a document-less or fallback-less failure sends the person. Hard-coded on purpose (rule 5). */
export const HARD_CODED_WEB_FALLBACK: Fallback = { kind: 'use_web', url: 'https://beebeeb.io/signup' }

export const PRE_ACCOUNT_STEP_IDS = [
  'enter_email',
  'verify_email_code',
  'pilot_key',
  'accept_terms',
  'set_password',
  'save_recovery_phrase',
  'create_account',
] as const

export const ACCOUNT_STEP_IDS = [
  'verify_email',
  'accept_terms',
  'billing_profile',
  'choose_plan',
  'start_trial',
  'subscribe',
] as const

export type PreAccountStepId = (typeof PRE_ACCOUNT_STEP_IDS)[number]
export type AccountStepId = (typeof ACCOUNT_STEP_IDS)[number]
export type KnownStepId = PreAccountStepId | AccountStepId

/**
 * Account-stage steps this build draws a screen for, and so may stop the
 * account on. Every other account-stage step, unknown to this build or known
 * but undrawable here (`billing_profile`, `choose_plan`, ...), is NEVER allowed
 * to hold the account out of its files: task 1822 (P0, 2026-10-06) — a server
 * `accept_terms` step this build could not draw locked every existing account
 * out of the web drive behind a "We cannot do this step here yet" card whose
 * only exit, "Continue on the web", led back to the page the person was on.
 * Spec 5.8 rule 3 (an unknown REQUIRED step stops the client) still holds for
 * the pre-account stage, where the person has no account to be locked out of.
 */
export const DRAWABLE_ACCOUNT_STEP_IDS = ['verify_email', 'accept_terms'] as const

/** `done` is a known terminal marker in both stages; it renders nothing. */
const TERMINAL_STEP_ID = 'done'

/**
 * Steps a server may mark `required` that a client may still not be able to do
 * in its own stage. A step id known to the OTHER stage is unknown here.
 */
export function isKnownStep(stage: Stage, id: string): id is KnownStepId {
  if (id === TERMINAL_STEP_ID) return false
  const list: readonly string[] = stage === 'pre_account' ? PRE_ACCOUNT_STEP_IDS : ACCOUNT_STEP_IDS
  return list.includes(id)
}

export type StepDisplayState = 'done' | 'current' | 'upcoming' | 'blocked'

export interface PlannedStep {
  step: OnboardingStep
  known: boolean
  state: StepDisplayState
}

export interface UpdateRequiredScreen {
  kind: 'update_required'
  fallback: Fallback
  minVersion: string | null
}

export interface UnsupportedSchemaScreen {
  kind: 'unsupported_schema'
  fallback: Fallback
}

export interface SignupUnavailableScreen {
  kind: 'signup_unavailable'
  mode: 'native' | 'web_handoff' | 'web_only'
  reason: string | null
  webUrl: string | null
}

/** A required step this build cannot perform: the server-declared way out. */
export interface FallbackScreen {
  kind: 'fallback'
  stepId: string
  fallback: Fallback
}

/** A required step the server reports as blocked (or with a status we do not know). */
export interface BlockedScreen {
  kind: 'blocked'
  stepId: string
  fallback: Fallback | null
}

export interface StepScreen {
  kind: 'step'
  stage: Stage
  stepId: KnownStepId
  step: OnboardingStep
  /** Every step worth showing in a progress rail, in server order. */
  steps: PlannedStep[]
  /** 1-based position among `steps`, and the count. */
  position: number
  total: number
}

export interface AccountScreen {
  kind: 'account'
  /** Known, not-done steps offered as actions (choose_plan, start_trial, ...). */
  actions: PlannedStep[]
  /**
   * Ids of required, not-done account steps this build cannot do (unknown, or
   * known but without a screen). They never block (task 1822): the account view
   * and the drive tell the person once, dismissibly, and carry on.
   */
  unsupported: string[]
}

/** Every pre-account step is done: refetch the document with the new session. */
export interface CreatedScreen {
  kind: 'created'
}

export type Screen =
  | UpdateRequiredScreen
  | UnsupportedSchemaScreen
  | SignupUnavailableScreen
  | FallbackScreen
  | BlockedScreen
  | StepScreen
  | AccountScreen
  | CreatedScreen

export function unsupportedSchemaScreen(): UnsupportedSchemaScreen {
  return { kind: 'unsupported_schema', fallback: HARD_CODED_WEB_FALLBACK }
}

function isDone(step: OnboardingStep, completed: ReadonlySet<string>): boolean {
  return step.status === 'done' || completed.has(step.id)
}

function pickFallback(step: OnboardingStep, doc: OnboardingDocument): Fallback {
  // The schema guarantees one of the two for an unknown required step; the
  // hard-coded fallback only covers a server that broke that promise.
  return step.fallback ?? doc.fallback ?? HARD_CODED_WEB_FALLBACK
}

/** Steps shown in the rail: everything this build can draw, plus a required stop. */
function railSteps(doc: OnboardingDocument, completed: ReadonlySet<string>, currentId: string | null): PlannedStep[] {
  const out: PlannedStep[] = []
  for (const step of doc.steps) {
    const known = isKnownStep(doc.stage, step.id)
    // Unknown optional: invisible. Unknown required: a stop in the pre-account
    // stage only; at the account stage it never blocks, so it is not a rail step (task 1822).
    if (!known && (!step.required || doc.stage === 'account')) continue
    if (step.id === TERMINAL_STEP_ID) continue
    let state: StepDisplayState
    if (isDone(step, completed)) state = 'done'
    else if (step.id === currentId) state = 'current'
    else if (step.status === 'blocked') state = 'blocked'
    else state = 'upcoming'
    out.push({ step, known, state })
  }
  return out
}

/**
 * Walk the steps in document order and find the first one that needs the
 * person. Returns a terminal screen (fallback / blocked) when a required step
 * cannot be done here, the step to render otherwise, or null when none is left.
 */
function firstActionable(
  doc: OnboardingDocument,
  completed: ReadonlySet<string>,
): FallbackScreen | BlockedScreen | { step: OnboardingStep } | null {
  let deferredCreate: OnboardingStep | null = null

  for (const step of doc.steps) {
    if (step.id === TERMINAL_STEP_ID || isDone(step, completed)) continue
    const known = isKnownStep(doc.stage, step.id)

    if (!known) {
      if (!step.required) continue // rule 3: skip silently
      return { kind: 'fallback', stepId: step.id, fallback: pickFallback(step, doc) }
    }
    if (step.status === 'blocked') {
      if (!step.required) continue
      return { kind: 'blocked', stepId: step.id, fallback: step.fallback ?? doc.fallback }
    }
    if (step.id === 'create_account') {
      deferredCreate = step // runs last, after every other required step
      continue
    }
    return { step }
  }

  return deferredCreate ? { step: deferredCreate } : null
}

/**
 * Account stage: a known required step the server reports `blocked` (or with a
 * status we do not know) stops the account on a "not available right now"
 * screen. An unknown or undrawable required step does NOT (task 1822): it is
 * reported through `unsupportedSteps` and the account carries on.
 */
function requiredStop(doc: OnboardingDocument, completed: ReadonlySet<string>): BlockedScreen | null {
  for (const step of doc.steps) {
    if (step.id === TERMINAL_STEP_ID || isDone(step, completed) || !step.required) continue
    if (isDrawableAccountStep(step) && step.status === 'blocked') {
      return { kind: 'blocked', stepId: step.id, fallback: step.fallback ?? doc.fallback }
    }
  }
  return null
}

/**
 * Drawable = this build has a screen AND the step carries what that screen needs.
 * An `accept_terms` without a non-empty `params.version` has nothing to accept, so
 * it is undrawable: it never blocks and is reported as unsupported (task 1822, P1).
 */
function isDrawableAccountStep(step: OnboardingStep): boolean {
  if (!(DRAWABLE_ACCOUNT_STEP_IDS as readonly string[]).includes(step.id)) return false
  if (step.id === 'accept_terms') {
    const v = step.params?.version
    return typeof v === 'string' && v.length > 0
  }
  return true
}

/** Required, not-done account-stage steps this build cannot draw (task 1822). */
export function unsupportedAccountSteps(doc: OnboardingDocument, completed: ReadonlySet<string> = new Set()): string[] {
  if (doc.stage !== 'account') return []
  const out: string[] = []
  for (const step of doc.steps) {
    if (step.id === TERMINAL_STEP_ID || isDone(step, completed) || !step.required) continue
    if (!isDrawableAccountStep(step) && !out.includes(step.id)) out.push(step.id)
  }
  return out
}

export function planScreen(doc: OnboardingDocument, completed: ReadonlySet<string> = new Set()): Screen {
  // Rule 7: update_required blocks everything except Sign out and the update.
  if (doc.client.status === 'update_required') {
    return {
      kind: 'update_required',
      fallback: doc.fallback ?? HARD_CODED_WEB_FALLBACK,
      minVersion: doc.client.minVersion,
    }
  }

  if (doc.stage === 'pre_account') {
    const signup = doc.signup
    if (!signup || !signup.allowed || signup.mode !== 'native') {
      return {
        kind: 'signup_unavailable',
        mode: signup?.mode ?? 'web_only',
        reason: signup?.reason ?? null,
        webUrl: signup?.webUrl ?? doc.fallback?.url ?? HARD_CODED_WEB_FALLBACK.url,
      }
    }
    const next = firstActionable(doc, completed)
    if (next === null) return { kind: 'created' }
    if ('kind' in next) return next
    return stepScreen(doc, completed, next.step)
  }

  // stage = account
  const stop = requiredStop(doc, completed)
  if (stop) return stop // a required step this build cannot do
  // A blocking document stops the account only on a step this build can draw.
  // An unknown required step listed ahead of it must not hide it (task 1822).
  if (doc.blocking) {
    const current = doc.steps.find(
      (st) => st.required && !isDone(st, completed) && isDrawableAccountStep(st) && st.status !== 'blocked',
    )
    if (current) return stepScreen(doc, completed, current)
  }

  // `done` has nothing left to do; `blocked` is the server saying "not available
  // to this account right now", so an optional blocked action draws no
  // affordance at all (a required blocked one already stopped above).
  const actions = railSteps(doc, completed, null).filter((p) => p.known && p.state !== 'done' && p.state !== 'blocked' && !(p.step.required && !isDrawableAccountStep(p.step)))
  return { kind: 'account', actions, unsupported: unsupportedAccountSteps(doc, completed) }
}

function stepScreen(doc: OnboardingDocument, completed: ReadonlySet<string>, step: OnboardingStep): StepScreen {
  const steps = railSteps(doc, completed, step.id)
  const index = steps.findIndex((p) => p.step.id === step.id)
  return {
    kind: 'step',
    stage: doc.stage,
    stepId: step.id as KnownStepId,
    step,
    steps,
    position: index === -1 ? 1 : index + 1,
    total: Math.max(steps.length, 1),
  }
}
