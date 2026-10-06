/**
 * userFriendlyError() — turns any thrown value into a short, actionable
 * message a real user can understand. Replaces the generic
 * `err instanceof Error ? err.message : 'Something went wrong'` pattern
 * that leaked raw HTTP/JSON fragments into the UI.
 *
 * Match order: ApiError status code → network/offline heuristic → existing
 * short message → generic fallback. Keep strings ≤ 8 words where possible.
 */

import { ApiError } from './api'
import { consumeAccountDeletedNotice, type NoticeStorage } from './account-deleted-notice'
import { UploadRestartFailedError } from './upload-session-reinit'
import { shareRefusalCopy, startTrialErrorCopy, trialBillingRefusalCopy } from './no-card-trial'

/** Maximum length below which we trust the existing message as user-facing. */
const SHORT_MESSAGE_MAX = 80

/**
 * Task 1404 — exact brand-voice copy for the `account_deleted` 403 (task
 * 1403): say what happened, say it can't be undone. Both dates are
 * date-only (no time) in the viewer's locale. Pure formatter, called from
 * app.tsx's central `registerAccountDeletedHandler` (the ONE place that
 * receives the raw `{deleted_at, shred_after}` body — see
 * `packages/shared/src/api/request.ts`'s `fireAccountDeleted`) right before
 * it stashes the result via `stashAccountDeletedNotice`.
 */
export function formatAccountDeletedMessage(
  deletedAt: unknown,
  shredAfter: unknown,
): string | null {
  const deleted = formatDateOnly(deletedAt)
  const shredded = formatDateOnly(shredAfter)
  if (!deleted || !shredded) return null
  return `This account was deleted on ${deleted}. Its encrypted data will be shredded on ${shredded}. We can't recover it.`
}

/** RFC3339 → date-only, locale-formatted ("September 13, 2026"). Null on anything unparseable. */
function formatDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * `accountDeletedMessage(err)` — usable directly in a catch block before
 * falling back to `userFriendlyError()`'s generic handling. `request()`
 * (shared) fires the central `account_deleted` handler (app.tsx), which
 * formats + stashes the exact copy via `stashAccountDeletedNotice`,
 * SYNCHRONOUSLY, before the `ApiError` it also throws is ever observed by an
 * awaiting caller — so by the time any catch block here runs, the notice is
 * already there to consume. Falls back to a generic-but-honest line only if
 * the notice is somehow missing (e.g. already consumed by a race, or the
 * handler wasn't registered yet) rather than showing nothing.
 *
 * `storage` is test-only — an explicit override so unit tests don't need a
 * real `window.sessionStorage` (absent under `bun test`'s non-DOM runtime).
 * Production call sites omit it and get the real browser storage.
 */
export function accountDeletedMessage(err: unknown, storage?: NoticeStorage): string | null {
  if (!(err instanceof ApiError) || err.code !== 'account_deleted') return null
  return consumeAccountDeletedNotice(storage) ?? "This account has been deleted. We can't recover it."
}

/**
 * Look at the error's status (if any) and decide whether the underlying
 * message is opaque server output (a JSON fragment, a "404", a stack frame)
 * that we should swap for a friendlier one. We accept short, plain-prose
 * messages straight through.
 */
function looksUserFriendly(message: string): boolean {
  if (!message) return false
  if (message.length > SHORT_MESSAGE_MAX) return false
  // Raw JSON / object fragments
  if (message.startsWith('{') || message.includes('": "')) return false
  // Bare numeric or "404: ..." status leaks
  if (/^\d{3}\b/.test(message)) return false
  // Anything still looking like an HTTP status name
  if (/^(Not Found|Forbidden|Unauthorized|Bad Request|Internal Server Error)$/i.test(message)) {
    return false
  }
  return true
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (err instanceof ApiError && err.status === 0) return true
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true
  if (err instanceof Error && /network|fetch failed|failed to fetch/i.test(err.message)) {
    return true
  }
  return false
}

/**
 * Upgrade rate-limit (task 1057). Upgrades (strictly-higher tier) are capped at
 * N per D days to stop cycling; downgrades are NEVER capped. The UI pre-computes
 * eligibility and disables the upgrade CTAs at the limit, so this should rarely
 * fire — but a race (another tab/device used the last slot between fetch and
 * submit) can still surface the raw server 400 "upgrade limit reached: at most N
 * upgrades are allowed per D days. Your next upgrade is available on DATE.".
 * Map it to a calm line, preserving the next-available date when present.
 */
function upgradeLimitMessage(message: string): string | null {
  if (!/upgrade limit reached/i.test(message)) return null
  const date = message.match(/next upgrade is available on ([^.]+)\./i)
  if (date) {
    return `You've reached the upgrade limit for now. Your next upgrade is available on ${date[1].trim()}.`
  }
  const m = message.match(/at most (\d+) upgrades? are allowed per (\d+) days?/i)
  if (m) {
    return `You've reached the limit of ${m[1]} upgrades per ${m[2]} days. You can upgrade again later.`
  }
  return "You've reached the upgrade limit for now. You can upgrade again later."
}

export function userFriendlyError(err: unknown): string {
  // Task 1589 — a swept upload session whose fresh re-init also failed. Its
  // message is written for users and says what to do (upload again).
  if (err instanceof UploadRestartFailedError) return err.message

  // Network / offline takes priority — a 5xx during a flaky connection is
  // really "you have no connection", not "the server is down".
  if (isNetworkError(err)) {
    return 'Check your connection and try again.'
  }

  // Task 1404 — defense in depth: the login page calls accountDeletedMessage()
  // directly (it needs the exact copy inline, not this generic mapper), but
  // route it here too in case it ever surfaces through some other generic
  // catch-all that already calls userFriendlyError().
  const accountDeleted = accountDeletedMessage(err)
  if (accountDeleted) return accountDeleted

  if (err instanceof ApiError) {
    // Upgrade rate-limit (task 1057) — a 400 whose message we want to soften,
    // matched on the stable message fragment before generic status handling
    // swallows it.
    const upgradeLimit = upgradeLimitMessage(err.message)
    if (upgradeLimit) return upgradeLimit

    const status = err.status
    // Typed quota errors come back with a machine-readable `code` so we don't
    // pattern-match the human message. Branch on these BEFORE the generic
    // status handling, otherwise the 403/413 fall-throughs swallow them with
    // "You don't have permission to do that." (server task 0670).
    if (err.code === 'object_budget_exceeded') {
      // Object-COUNT cap, distinct from the byte/storage quota below.
      return "File limit reached. This account has hit its maximum number of files — delete some files or contact support to raise the limit."
    }
    // Task 1037 — an account without a plan: upload init and share creation
    // are refused with 409 plan_required / account_lapsed (never
    // quota_exceeded — a 0 quota would read as unlimited). Branch before the
    // generic 409 handling so they never surface as a vague conflict.
    // Task 1037 — signup is web-only; mobile/CLI get this 403. The web IS the
    // signup surface so it should never see it, but never let it fall
    // through to the generic 403 "permission" line.
    if (err.code === 'signup_web_only') {
      return 'Accounts can only be created at app.beebeeb.io/signup. Open that page in your browser to continue.'
    }
    if (err.code === 'plan_required') {
      return 'Choose a plan and start your free trial to upload or share files.'
    }
    if (err.code === 'account_lapsed') {
      return 'Your trial has ended and your vault is read-only. Subscribe to upload or share again.'
    }
    // Task 1757 (server task 1755) — the typed refusals of the no-card trial. Each has its
    // own sentence; none may fall through to a vague conflict.
    if (err.code === 'trial_ended') {
      return 'Your trial has ended and your account holds more than its included storage, so it is read-only. Subscribe, or free up space (the trash counts), to upload again.'
    }
    const sharing = shareRefusalCopy(err)
    if (sharing) return sharing
    const billing = trialBillingRefusalCopy(err)
    if (billing) return billing
    if (
      err.code === 'trial_temporarily_unavailable' ||
      err.code === 'trial_already_used' ||
      err.code === 'trial_previously_subscribed' ||
      err.code === 'trial_has_active_subscription' ||
      err.code === 'trial_requires_payment_method'
    ) {
      return startTrialErrorCopy(err)
    }
    // Task 1605 (server PR #129) — a never-paid trial cancelled before its
    // first charge: uploads + new shares are refused immediately, even
    // though the account is still `cancelling` (view/download keep working
    // until access_until). Distinct copy from `account_lapsed` (the trial
    // hasn't lapsed yet — it's cancelled, and resuming restores uploads).
    if (err.code === 'trial_cancelled_read_only') {
      return 'Uploads are off — you cancelled your trial before its first payment. Resume your trial or pay now to upload again.'
    }
    if (err.code === 'quota_exceeded') {
      // Task 1605 — the 25 GB TRIAL cap (not the account's real plan quota)
      // carries its own actionable server message ("...Pay now to unlock
      // your full plan storage.") via the additive `is_trial_cap` flag. An
      // ordinary plan-quota hit keeps the existing generic copy.
      // The no-card trial's sentence ("You've reached the 6 MB trial storage cap. Subscribe to
      // unlock your full plan storage.", task 1755) is longer than the 80-character cutoff
      // `looksUserFriendly` applies to unknown messages, but it is the server's own sentence for
      // exactly this case, so it is trusted up to a sane bound.
      if (err.details?.is_trial_cap === true && err.message.length > 0 && err.message.length <= 200) {
        return err.message
      }
      return 'Storage full. Free up space or upgrade your plan to keep uploading.'
    }
    if (err.code === 'downgrade_blocked_over_quota') {
      // Task 1061 (WP-C): the DowngradeDialog already shows the precise
      // "free up X" blocking state before the user can even submit, so this
      // is the fallback for the rare race (freed space in another tab,
      // re-filled it here) — the server's own message already names the
      // exact amount and target tier.
      return looksUserFriendly(err.message) ? err.message : 'Free up storage before switching to this plan.'
    }
    if (err.code === 'billing_reset_test_mode') {
      // Task 1518 (server PR #94) — a subscription created while Mollie was
      // in test mode gets reset server-side; the account falls back to the
      // free plan and has to subscribe again. The server's own message is
      // already the exact right copy, it's just 86 chars — over
      // SHORT_MESSAGE_MAX (80) — so it needs its own branch here instead of
      // falling through `looksUserFriendly` into the generic fallback.
      return err.message
    }
    if (err.code === 'already_subscribed') {
      // Task 1707 — the same-plan re-purchase guard: the server refused a
      // checkout for the exact plan+cycle the user already has active. The
      // server's message names the exact plan + cycle and points at /billing;
      // keep it verbatim regardless of the 80-char cutoff so the plan/cycle
      // specifics never degrade into a generic conflict line.
      return err.message || 'You already have an active subscription on this plan. Manage it in Billing.'
    }
    if (status === 401) return 'Your session expired. Sign in again.'
    if (status === 403) return "You don't have permission to do that."
    if (status === 404) return 'Not found.'
    if (status === 429) return 'Too many requests. Try again in a moment.'
    if (status >= 500 && status <= 599) {
      return 'Beebeeb is having trouble. Try again in a moment.'
    }
    if (looksUserFriendly(err.message)) return err.message
    return 'Something went wrong. Try again.'
  }

  if (err instanceof Error) {
    const upgradeLimit = upgradeLimitMessage(err.message)
    if (upgradeLimit) return upgradeLimit
    if (looksUserFriendly(err.message)) return err.message
  }

  return 'Something went wrong. Try again.'
}

/**
 * True for errors where retrying the same action might succeed without user
 * intervention — network blips, transient 5xx, rate limits. 4xx other than
 * 429 means the request itself was wrong, so no retry button.
 */
export function errorRetryable(err: unknown): boolean {
  if (isNetworkError(err)) return true
  if (err instanceof ApiError) {
    if (err.status === 429) return true
    if (err.status >= 500 && err.status <= 599) return true
    if (err.status === 0) return true
  }
  return false
}
