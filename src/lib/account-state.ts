/**
 * Account lifecycle state (task 1037 — no free signups).
 *
 * `GET /billing/subscription` carries an additive `account_state`:
 *   - `ok`         — normal: an entitled account, or grandfathered Free.
 *   - `needs_plan` — a new-model account that never started a trial or plan.
 *                    Every app route sends it to `/choose-plan`.
 *   - `lapsed`     — its trial/plan ended unpaid. Read-only (quota 0); the data
 *                    is deleted at `data_deletion_at` unless the user subscribes.
 *
 * Pure decisions only (no React) so `test/1037-trial-at-signup.test.ts` can pin
 * them; `app.tsx`'s ProtectedRoute, the billing banner and the upload entry
 * points call these.
 */

import type { AccountState, Subscription } from '@beebeeb/shared'
import type { OnboardingDocument } from './onboarding/types'
import { planScreen } from './onboarding/plan'

export type { AccountState }

export const CHOOSE_PLAN_PATH = '/choose-plan'

/** Where the lapsed CTA goes: normal paid checkout (the trial is used up). */
export const PAID_CHECKOUT_PATH = '/billing?view=change'

/**
 * The account state for a (possibly missing) subscription. A field absent on
 * an older server, a subscription that failed to load, or an unknown value all
 * resolve to `ok` — the gate must never lock out an account on missing data.
 */
export function resolveAccountState(
  sub: Pick<Subscription, 'account_state'> | null | undefined,
): AccountState {
  const s = sub?.account_state
  return s === 'needs_plan' || s === 'lapsed' ? s : 'ok'
}

/**
 * Task 1816 (1745 acceptance 2/3) — the account state the ROUTE GATE, the lapsed
 * banner and the upload entry points act on, read from the onboarding document
 * when there is an account-stage one. The legacy `/billing/subscription`
 * `account_state` cannot tell an allowance account from a plan-less one (the
 * contract maps both to `needs_plan`), so reading it sent a verified account
 * with a working allowance to /choose-plan and the drive never opened.
 *
 *   - `needs_plan`              -> needs_plan (no allowance: the chooser)
 *   - `lapsed`, `trial_ended`   -> lapsed (read-only over the allowance)
 *   - everything else, incl. `allowance` and states this build does not know
 *     (the state is only a label, spec 5.8 rule 4)  -> ok; the capabilities and
 *     the server's own refusals (409/413) stay the authority on what is allowed.
 *
 * Null when the document is unavailable or not an account-stage one: the caller
 * then falls back to the legacy field (spec 5.8 rule 6).
 */
export function accountStateFromDocument(
  doc: Pick<OnboardingDocument, 'stage' | 'account'> | null | undefined,
): AccountState | null {
  if (!doc || doc.stage !== 'account' || !doc.account) return null
  switch (doc.account.state) {
    case 'needs_plan':
      return 'needs_plan'
    case 'lapsed':
    case 'trial_ended':
      return 'lapsed'
    default:
      return 'ok'
  }
}

/**
 * Task 1816 round 2 (Codex P1) — an account-stage document can be `blocking`
 * while its state label is `allowance`/`active` (a required unfinished step such
 * as updated terms, or `update_required`). The label alone must never let such an
 * account into the protected routes: classify blocking BEFORE mapping the state.
 * Uses the renderer's own `planScreen`, so the gate blocks exactly when the
 * renderer would draw a step / stop / update screen instead of the account page.
 * `needs_plan` is excluded: the chooser redirect already owns that account.
 */
export function accountDocumentBlocks(
  doc: OnboardingDocument | null | undefined,
): boolean {
  if (!doc || doc.stage !== 'account' || !doc.account) return false
  if (doc.account.state === 'needs_plan') return false
  const kind = planScreen(doc).kind
  return kind !== 'account' && kind !== 'created'
}

/** Where a blocking account document is rendered (the document-driven screen). */
export const ACCOUNT_STATUS_PATH = '/account-status'

/** Routes a blocked account may still open: the step screen itself, sign out, deletion, email verification. */
export const BLOCKING_ALLOWED_PATHS: readonly string[] = [
  ACCOUNT_STATUS_PATH,
  '/logout',
  '/verify-email',
  '/settings/delete-account',
]

/**
 * Task 1816 — where a freshly created account lands. A usable (non-blocking)
 * ALLOWANCE account goes straight to the drive: there is nothing to choose
 * before it can use its allowance. An explicit plan intent (the person picked a
 * plan on the pricing page) or any other / unavailable document keeps the
 * existing chooser destination.
 */
export function postSignupLanding(
  doc: Pick<OnboardingDocument, 'stage' | 'account' | 'blocking' | 'client' | 'steps' | 'fallback' | 'signup'> | null | undefined,
  chooserDestination: string,
  hasPlanIntent: boolean,
): string {
  if (hasPlanIntent || !doc || doc.stage !== 'account' || doc.account?.state !== 'allowance') {
    return chooserDestination
  }
  return accountDocumentBlocks(doc as OnboardingDocument) ? chooserDestination : '/'
}

/** Document state when there is one, else the legacy subscription field. */
export function effectiveAccountState(
  doc: Pick<OnboardingDocument, 'stage' | 'account'> | null | undefined,
  sub: Pick<Subscription, 'account_state'> | null | undefined,
): AccountState {
  return accountStateFromDocument(doc) ?? resolveAccountState(sub)
}

/**
 * Routes a `needs_plan` account may still open: the chooser itself, account
 * settings (`/settings/account` forwards to `/settings/profile`, which holds
 * the account details and the delete-account entry) and deletion, logout,
 * the CLI browser login (`/cli-auth`), the billing page (the paid-checkout fallback
 * for `trial_already_used`, and the normal checkout return), and email
 * verification (the link in the welcome email).
 */
export const NEEDS_PLAN_ALLOWED_PATHS: readonly string[] = [
  CHOOSE_PLAN_PATH,
  '/settings/account',
  '/settings/profile',
  '/settings/delete-account',
  '/settings/billing',
  '/billing',
  '/logout',
  '/verify-email',
  // `bb login --browser` (CLI device auth) — the CLI never creates accounts,
  // but a needs_plan account must still be able to sign the CLI in.
  '/cli-auth',
  // Task 1745: the document-driven account view (route exists only behind
  // FEATURE_ONBOARDING_DOCUMENT); it is where a needs_plan account sees why.
  '/account-status',
]

/**
 * The redirect a protected route must apply, or null to render it. Only
 * `needs_plan` is gated; a `lapsed` account keeps browsing and downloading
 * (read-only) and sees the persistent banner instead.
 */
export function planGateRedirect(
  pathname: string,
  state: AccountState,
  blocking = false,
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (blocking && state !== 'needs_plan') {
    return BLOCKING_ALLOWED_PATHS.includes(path) ? null : ACCOUNT_STATUS_PATH
  }
  if (state !== 'needs_plan') return null
  return NEEDS_PLAN_ALLOWED_PATHS.includes(path) ? null : CHOOSE_PLAN_PATH
}

/** "1 December 2026", or null for a missing/unparseable date. */
export function formatDeletionDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** The non-dismissable banner copy for a `lapsed` account. */
export function lapsedBannerCopy(dataDeletionAt: string | null | undefined): string {
  const date = formatDeletionDate(dataDeletionAt)
  const when = date ? `on ${date}` : 'unless you subscribe'
  return `Your trial has ended and your vault is read-only. Your files will be permanently deleted ${when}. Subscribe to keep them.`
}

export interface UploadBlockedNotice {
  title: string
  description: string
  href: string
}

/**
 * What an upload entry point shows INSTEAD of the generic "Not enough storage"
 * quota toast when the account cannot upload at all (quota 0 by design).
 * Null when uploads are allowed.
 */
export function uploadBlockedNotice(state: AccountState): UploadBlockedNotice | null {
  if (state === 'lapsed') {
    return {
      title: 'Your vault is read-only',
      description:
        'Your trial has ended, so uploads are paused. Your files are still here to browse and download — subscribe to upload again.',
      href: PAID_CHECKOUT_PATH,
    }
  }
  if (state === 'needs_plan') {
    return {
      title: 'Start your trial to upload',
      description: 'Choose a plan and start your free trial to upload files.',
      href: CHOOSE_PLAN_PATH,
    }
  }
  return null
}

/**
 * The account state a failed call reveals. For an account without a plan the
 * server refuses upload init (`/files/upload/init`, `/uploads/init`, legacy
 * multipart `/files/upload`) and share creation with `409 {"error":
 * "plan_required" | "account_lapsed"}` — deliberately NOT `quota_exceeded`,
 * since a quota of 0 would otherwise read as unlimited.
 */
export function accountStateFromError(err: unknown): Exclude<AccountState, 'ok'> | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  if (code === 'plan_required') return 'needs_plan'
  if (code === 'account_lapsed') return 'lapsed'
  return null
}

/**
 * Task 1605 (server PR #129) — two upload refusals that are NOT modeled by
 * `account_state` at all (the account is still `ok`/`cancelling`, not
 * `lapsed`/`needs_plan`):
 *
 *  - `trial_cancelled_read_only` (409, upload/share init) — a never-paid
 *    trial cancelled before its first charge. Distinct from `lapsed`: the
 *    trial hasn't ENDED, it's cancelled early, and resuming it (or paying
 *    now) restores uploads immediately — never "subscribe" as the CTA.
 *  - `quota_exceeded` (413) with the additive `is_trial_cap: true` flag — an
 *    ACTIVE mandated trial hit the 25 GB cap. The server's own `message`
 *    field is already the exact actionable copy; used verbatim when present.
 *
 * Both route to `/billing`, where the trial card's own "pay now"/"resume
 * trial" actions live — no separate CTA wiring needed here.
 */
export function uploadRefusalNotice(err: unknown): UploadBlockedNotice | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  if (code === 'trial_cancelled_read_only') {
    return {
      title: 'Uploads are off',
      description:
        'You cancelled your trial before its first payment, so uploads and new shares are off. Resume your trial or pay now to upload again.',
      href: '/billing',
    }
  }
  if (code === 'quota_exceeded') {
    const details = (err as { details?: Record<string, unknown> }).details
    if (details?.is_trial_cap === true) {
      const rawMessage = (err as { message?: unknown }).message
      const description =
        typeof rawMessage === 'string' && rawMessage.length > 0 && rawMessage.length <= 200
          ? rawMessage
          : "You've reached the 25 GB trial storage cap. Pay now to unlock your full plan storage."
      return { title: '25 GB trial cap reached', description, href: '/billing' }
    }
  }
  return null
}
