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
]

/**
 * The redirect a protected route must apply, or null to render it. Only
 * `needs_plan` is gated; a `lapsed` account keeps browsing and downloading
 * (read-only) and sees the persistent banner instead.
 */
export function planGateRedirect(pathname: string, state: AccountState): string | null {
  if (state !== 'needs_plan') return null
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
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
