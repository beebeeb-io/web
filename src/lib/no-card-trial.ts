/**
 * The no-card trial, as the web client shows it (task 1757, server task 1755,
 * spec 2026-10-04-backend-driven-onboarding.md 4b.3 / 4b.4 / 4b.7 / 4b.8).
 *
 * Everything here is pure (no React, no fetch) and pinned by
 * `test/1757-no-card-trial.test.ts`. The rules it encodes:
 *
 *  - The SERVER decides whether a trial can start: `offers.trial` in the
 *    onboarding document. The client never guesses from `has_used_trial`
 *    (the 1517 guess) when a document is available.
 *  - Numbers and dates come from the document (cap, allowance, end date,
 *    deletion date). The client writes only framing. Server copy
 *    (`copy.trial_end_over_allowance`, `copy.trial_ended_over_allowance`) wins
 *    over client wording, because it is written where the numbers are.
 *  - Honest voice. A trial has no card, so nothing is ever "charged" or
 *    "authorized"; when it ends the allowance stays, and over it the files above
 *    the allowance are read-only and then deleted, which we say.
 *  - Task 1837: there may be NO allowance (prod switched it off on 2026-10-06: a free
 *    account was never wanted). Then nothing "stays": the end of an unpaid trial is
 *    read-only, then deleted {@link NEVER_PAID_RETENTION_DAYS} days later, and every
 *    sentence here says exactly that. `allowanceBytes` of null or 0 means no allowance.
 */

import { ApiError, type LastTrial } from '@beebeeb/shared'
import type { OnboardingDocument } from './onboarding/types'
import { formatDay, formatSize } from './onboarding/account-summary'
import { PAID_CHECKOUT_PATH } from './account-state'

const MS_PER_DAY = 86_400_000

/**
 * Days a never-paid account stays read-only before its files are deleted
 * (server `signup_plan::LAPSE_RETENTION_DAYS_NEVER_PAID`, D15). The document carries the
 * actual date once the trial has ended; BEFORE it starts, this is the number the person
 * is told, so it must match the server constant.
 */
export const NEVER_PAID_RETENTION_DAYS = 14

/** True when the document carries an entry allowance worth naming (null / 0 = none). */
export function hasAllowance(allowanceBytes: number | null | undefined): allowanceBytes is number {
  return typeof allowanceBytes === 'number' && allowanceBytes > 0
}

// ── The offer ────────────────────────────────────────────────────────────────

export type TrialUnavailableReason =
  | 'already_used'
  | 'email_unverified'
  | 'temporarily_unavailable'
  | 'not_offered_here'

export type TrialOfferView =
  | {
      kind: 'available'
      lengthDays: number
      capBytes: number
      startEndpoint: string
      allowanceBytes: number | null
    }
  | { kind: 'unavailable'; reason: string; message: string }

/**
 * "Your 2 GB stays." with an allowance, the empty string without one: with no allowance
 * nothing stays, and a sentence that says otherwise is a promise we cannot keep.
 */
function staysLine(allowanceBytes: number | null | undefined): string {
  return hasAllowance(allowanceBytes) ? `Your ${formatSize(allowanceBytes)} stays.` : ''
}

/** Join sentences with single spaces, dropping empty ones. */
function sentences(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(' ')
}

/** Why no trial can start, in the voice of the product. `reason` is the document's `unavailable_reason`. */
export function trialUnavailableCopy(reason: string | null | undefined, allowanceBytes?: number | null): string {
  switch (reason) {
    case 'already_used':
      return 'You have already had your trial. A plan is how you get more storage.'
    case 'email_unverified':
      return 'Confirm your email address first. A trial can start once it is confirmed.'
    case 'temporarily_unavailable':
      return sentences('We are not starting new trials right now.', staysLine(allowanceBytes) || 'You can still subscribe to a plan.')
    case 'not_offered_here':
      return 'Trials are not offered here.'
    default:
      return 'The trial is not available right now.'
  }
}

/**
 * What the account page, the plan chooser and the billing page say about starting a
 * trial. Null when there is nothing to say: no document, no offer (the platform does
 * not offer one, or the account already runs a trial), or the document forbids a
 * purchase call to action (money fails closed).
 */
export function trialOfferView(doc: OnboardingDocument | null | undefined): TrialOfferView | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  const offer = doc.trialOffer
  if (!offer || doc.purchase?.ctaAllowed !== true) return null
  const allowanceBytes = doc.account.storage?.allowanceBytes ?? null
  if (offer.available) {
    return {
      kind: 'available',
      lengthDays: offer.lengthDays,
      capBytes: offer.capBytes,
      startEndpoint: offer.startEndpoint,
      allowanceBytes,
    }
  }
  return {
    kind: 'unavailable',
    reason: offer.unavailableReason ?? 'unknown',
    message: trialUnavailableCopy(offer.unavailableReason, allowanceBytes),
  }
}

// ── The card / iDEAL trial, beside the no-card one (task 1837) ───────────────

export interface CardTrialView {
  lengthDays: number
  /** Mandate methods the server accepts, in the server's order. */
  methods: Array<'creditcard' | 'ideal'>
}

/**
 * The card / iDEAL trial the server advertises on the `choose_plan` step
 * (`params.card_trial`), present only while it is open beside the no-card trial. Null
 * when it is absent or malformed, and always null without a purchase call to action
 * (money fails closed). A client with NO trial offer in the document keeps showing the
 * card flow as before; this is only how the server tells it that BOTH are open.
 */
export function cardTrialView(doc: OnboardingDocument | null | undefined): CardTrialView | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  if (doc.purchase?.ctaAllowed !== true) return null
  const raw = doc.steps.find((st) => st.id === 'choose_plan')?.params?.card_trial
  if (!raw || typeof raw !== 'object') return null
  const { length_days: lengthDays, methods } = raw as { length_days?: unknown; methods?: unknown }
  if (typeof lengthDays !== 'number' || !Number.isFinite(lengthDays) || lengthDays < 1) return null
  const known = Array.isArray(methods)
    ? methods.filter((m): m is 'creditcard' | 'ideal' => m === 'creditcard' || m === 'ideal')
    : []
  if (known.length === 0) return null
  return { lengthDays, methods: known }
}

// ── Starting a trial: what can go wrong ─────────────────────────────────────

/**
 * The words for a failed `POST /billing/trial/start`. Every typed refusal the
 * server (task 1755/1756) can give has its own honest sentence; none says
 * "something went wrong" when the server told us what did.
 */
export function startTrialErrorCopy(err: unknown, allowanceBytes?: number | null): string {
  // An ApiError from the shared client, or an ActionError from the onboarding ports
  // (same `code`; its 429 arrives as the code `rate_limited`).
  const e = err as { code?: unknown; status?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : undefined
  const status = typeof e?.status === 'number' ? e.status : undefined
  switch (code) {
    case 'trial_temporarily_unavailable':
    case 'trial_requires_payment_method':
      return sentences('We are not starting new trials right now.', staysLine(allowanceBytes) || 'You can still subscribe to a plan.')
    case 'trial_already_used':
      return 'You have already had your trial on this account.'
    case 'trial_previously_subscribed':
      return 'A trial is for accounts that have never subscribed. Choose a plan to continue.'
    case 'trial_has_active_subscription':
      return 'You already have a plan, so you do not need a trial.'
    case 'email_unverified':
      return 'Confirm your email address first, then start the trial.'
    case 'trial_checkout_retired':
      return 'Trials no longer need a card. Start the trial without one.'
  }
  if (status === 429 || code === 'rate_limited' || code === 'rate_limit_exceeded' || code === 'trial_rate_limited') {
    // `request()` turns a 429 into a plain rate-limit error (the typed body is
    // dropped), so the code is gone; the status is enough to be honest.
    const message = typeof e?.message === 'string' ? e.message : ''
    const wait = /try again in (.+)$/i.exec(message)?.[1]?.trim()
    return sentences(
      'Too many trials were started from your network today.',
      staysLine(allowanceBytes),
      `Try again ${wait ? `in ${wait}` : 'later'}.`,
    )
  }
  if (status === 400) return 'That plan cannot be tried. Pick another one.'
  return 'We could not start the trial. Nothing was charged and your files are unchanged.'
}

// ── A trial that is running ─────────────────────────────────────────────────

export interface NoCardTrialStatus {
  /** "18 Oct 2026", or null when the document carried no end date. */
  endsOn: string | null
  /** Whole days left (ceil), 0 when it has ended or the date is unknown. */
  daysLeft: number
  /** "12 days left" / "1 day left" / "Ends today" */
  daysLeftLabel: string
  capBytes: number
  usedBytes: number
  /** used / cap clamped to 0..1. */
  fraction: number
  atCap: boolean
  allowanceBytes: number | null
  overAllowance: boolean
  /** One sentence: what happens when the trial ends. */
  consequence: string
  /** What the trial allows for sharing, in a sentence, or null when nothing needs saying. */
  sharingNote: string | null
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Ends today'
  return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
}

/** The sentence for sharing during a no-card trial (D17), from the document's share capability. */
export function trialSharingNote(doc: OnboardingDocument): string | null {
  const share = doc.account?.capabilities.share
  if (!share) return null
  if (share.allowed) {
    return share.activeLinksLimit !== null
      ? `You can keep up to ${share.activeLinksLimit} share links active during the trial.`
      : null
  }
  return 'Sharing starts with a plan. Your trial keeps your files private.'
}

/**
 * Null unless the document says the account runs a no-card trial right now.
 *
 * `liveUsedBytes` is the drive's own usage figure, which moves with every upload and
 * delete while the document is only as fresh as its last fetch: a cap meter that did not
 * move after an upload would be a lie. The over-the-allowance sentence follows the live
 * figure too; the server's own sentence is used only while it still describes the account
 * (the document and the live figure agree on whether it is over).
 */
export function noCardTrialStatus(
  doc: OnboardingDocument | null | undefined,
  now: number = Date.now(),
  timeZone?: string,
  liveUsedBytes?: number | null,
): NoCardTrialStatus | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  if (doc.account.state !== 'trialing_no_card') return null
  const trial = doc.account.trial
  const storage = doc.account.storage
  const capBytes = trial?.capBytes ?? storage?.quotaBytes ?? 0
  const usedBytes = typeof liveUsedBytes === 'number' && liveUsedBytes >= 0 ? liveUsedBytes : (storage?.usedBytes ?? 0)
  const endsMs = trial?.endsAt ? new Date(trial.endsAt).getTime() : NaN
  const daysLeft = Number.isNaN(endsMs) ? 0 : Math.max(0, Math.ceil((endsMs - now) / MS_PER_DAY))
  const rawAllowance = storage?.allowanceBytes ?? null
  const allowanceBytes = hasAllowance(rawAllowance) ? rawAllowance : null
  const docOver = storage?.overAllowance === true
  const overAllowance = allowanceBytes !== null ? usedBytes > allowanceBytes : docOver
  const serverSentence =
    allowanceBytes === null
      ? doc.copy.trial_end_no_allowance
      : overAllowance === docOver
        ? doc.copy.trial_end_over_allowance
        : undefined

  let consequence: string
  if (serverSentence) {
    consequence = serverSentence
  } else if (allowanceBytes === null) {
    consequence = `When it ends, your files become read-only and are deleted ${NEVER_PAID_RETENTION_DAYS} days later unless you choose a plan. Nothing is charged.`
  } else if (overAllowance) {
    consequence = `When it ends, files above ${formatSize(allowanceBytes)} become read-only. Nothing is charged.`
  } else {
    consequence = `When it ends, your ${formatSize(allowanceBytes)} stays. Nothing is charged.`
  }

  return {
    endsOn: formatDay(trial?.endsAt, timeZone),
    daysLeft,
    daysLeftLabel: daysLeftLabel(daysLeft),
    capBytes,
    usedBytes,
    fraction: capBytes > 0 ? Math.min(1, Math.max(0, usedBytes / capBytes)) : 0,
    atCap: capBytes > 0 && usedBytes >= capBytes,
    allowanceBytes,
    overAllowance,
    consequence,
    sharingNote: trialSharingNote(doc),
  }
}

// ── A trial that has ended ──────────────────────────────────────────────────

export interface TrialEndedStatus {
  headline: string
  /** The server's sentence when it sent one, else a plain one built from the same numbers. */
  body: string
  /** Trim guidance: what to delete, and that the trash counts. */
  trimGuidance: string
  /** "1 Nov 2026" or null. */
  deletionDay: string | null
  allowanceBytes: number | null
  usedBytes: number
  /** Bytes to free to be back within the allowance, or null when unknown. */
  overByBytes: number | null
  /** Subscribe is only a call to action where the platform allows a purchase. */
  canSubscribe: boolean
}

/** Null unless the document's state is `trial_ended` (over the allowance, deadline pending). */
export function trialEndedStatus(
  doc: OnboardingDocument | null | undefined,
  timeZone?: string,
): TrialEndedStatus | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  if (doc.account.state !== 'trial_ended') return null
  const storage = doc.account.storage
  const rawAllowance = storage?.allowanceBytes ?? null
  const allowanceBytes = hasAllowance(rawAllowance) ? rawAllowance : null
  const usedBytes = storage?.usedBytes ?? 0
  const deletionDay = formatDay(doc.account.lifecycle?.dataDeletionAt, timeZone)
  const canSubscribe = doc.purchase?.ctaAllowed === true
  if (allowanceBytes === null) {
    // Task 1837: no allowance, so everything is read-only and then deleted, not trimmed.
    const plan = canSubscribe ? ' unless you choose a plan' : ''
    return {
      headline: 'Your trial has ended',
      body:
        doc.copy.trial_ended_no_allowance ??
        (deletionDay
          ? `Your trial ended. Your files are read-only and will be deleted on ${deletionDay}${plan}.`
          : `Your trial ended. Your files are read-only.`),
      trimGuidance: 'Download and delete still work. Download what you want to keep before the date above.',
      deletionDay,
      allowanceBytes: null,
      usedBytes,
      overByBytes: null,
      canSubscribe,
    }
  }
  const allowance = formatSize(allowanceBytes)
  const overByBytes = Math.max(0, usedBytes - allowanceBytes)
  const body =
    doc.copy.trial_ended_over_allowance ??
    (deletionDay
      ? `Your trial ended. Files above ${allowance} are read-only and will be deleted on ${deletionDay} unless you free up space.`
      : `Your trial ended. Files above ${allowance} are read-only.`)
  const free = overByBytes > 0 ? `Free up ${formatSize(overByBytes)}` : 'Free up space'
  return {
    headline: 'Your trial has ended',
    body,
    trimGuidance: `${free} to keep everything. Deleted files wait in Trash and still count until you empty it. Download and delete still work.`,
    deletionDay,
    allowanceBytes,
    usedBytes,
    overByBytes,
    canSubscribe,
  }
}

/** How long after it ended the "your allowance stays" notice may still appear. */
export const TRIAL_ENDED_NOTICE_DAYS = 30

/**
 * A trial that ended with the files within the allowance leaves an ordinary
 * allowance account, and the document says nothing about the trial any more. This is
 * the one-time "your allowance stays" notice. It says "Nothing was charged", a
 * financial statement, so it needs evidence about THIS trial and not the lifetime
 * `has_used_trial` flag: the server's `last_trial` must be a no-card trial, uncharged,
 * that ended within the last {@link TRIAL_ENDED_NOTICE_DAYS} days, on an account that
 * now holds an allowance with no trial running. A converted mandated trial, a promo
 * trial and an old trial never qualify.
 */
export function trialEndedAllowanceNotice(
  doc: OnboardingDocument | null | undefined,
  lastTrial: LastTrial | null | undefined,
  now: Date = new Date(),
): { title: string; body: string; endedAt: string } | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  if (doc.account.state !== 'allowance') return null
  if (!lastTrial || lastTrial.kind !== 'no_card' || lastTrial.charged !== false) return null
  const ended = Date.parse(lastTrial.ended_at)
  if (!Number.isFinite(ended)) return null
  const ageMs = now.getTime() - ended
  if (ageMs < -5 * 60_000 || ageMs > TRIAL_ENDED_NOTICE_DAYS * 86_400_000) return null
  const allowanceBytes = doc.account.storage?.allowanceBytes ?? null
  if (!hasAllowance(allowanceBytes)) return null
  return {
    title: 'Your trial has ended',
    body: `${staysLine(allowanceBytes)} Nothing was charged and nothing is lost. A plan adds storage and sharing.`,
    endedAt: lastTrial.ended_at,
  }
}

// ── Refusals while uploading and sharing ────────────────────────────────────

/** Typed 409s the server gives for sharing during an allowance or a no-card trial. */
export const SHARE_REFUSAL_CODES = [
  'trial_sharing_unavailable',
  'trial_share_limit_reached',
  'plan_required',
  'account_lapsed',
  'trial_ended',
  'trial_cancelled_read_only',
] as const

/**
 * True for a 409 that is a typed, final answer. A share-creation retry exists for
 * ONE case, a token collision; a typed refusal must be shown, not retried.
 */
export function isTypedRefusal(err: unknown): boolean {
  return err instanceof ApiError && typeof err.code === 'string' && (SHARE_REFUSAL_CODES as readonly string[]).includes(err.code)
}

/** The words for the share-related refusals; null for anything else. */
export function shareRefusalCopy(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  switch (err.code) {
    case 'trial_sharing_unavailable':
      return 'Sharing starts with a plan. Your trial keeps your files private.'
    case 'trial_share_limit_reached':
      return 'A trial can hold 5 active share links. Revoke one, or choose a plan for more.'
    default:
      return null
  }
}

/** The words for the refusals of the billing actions that do not apply to a trial without a card. */
export function trialBillingRefusalCopy(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  switch (err.code) {
    case 'no_subscription_to_cancel':
      return 'Your trial has no card and no subscription, so there is nothing to cancel and nothing will be charged. It ends by itself on its end date.'
    case 'trial_convert_unavailable':
      return 'A trial without a card converts by subscribing: choose a plan and pay at checkout.'
    case 'trial_checkout_retired':
      return 'Trials no longer need a card. Start the trial without one.'
    default:
      return null
  }
}

// ── The client-side pre-flight at the cap ───────────────────────────────────

/**
 * The toast an upload shows when it would not fit in the trial's cap, decided on the
 * client before any byte leaves (the server's 413 says the same thing in its own words).
 * Null when no no-card trial runs, so the caller keeps its ordinary "Not enough storage".
 */
export function trialCapShortfallNotice(
  status: NoCardTrialStatus | null,
  needed: number,
  remaining: number,
  subject: 'upload' | 'folder' = 'upload',
): { title: string; description: string; href: string } | null {
  if (!status) return null
  return {
    title: `${formatSize(status.capBytes)} trial cap reached`,
    description: `This ${subject} needs ${formatSize(needed)} but your trial has ${formatSize(Math.max(0, remaining))} left of its ${formatSize(
      status.capBytes,
    )} cap. Subscribe to unlock your plan's storage.`,
    href: PAID_CHECKOUT_PATH,
  }
}
