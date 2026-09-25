/**
 * Shared handling for the `billing_reset_test_mode` 409 (task 1518, server
 * PR #94): a subscription created while Mollie was in test mode gets reset
 * server-side, the account falls back to the free plan, and any pending
 * checkout for it is moot.
 *
 * Before this module existed, only `billing.tsx`'s `handleResumeCheckout`
 * special-cased the code — every OTHER checkout entry point (UpgradeDialog's
 * `proceedToPayment`, pricing.tsx's `handleSelect`, upgrade-nudge-modal's
 * `handleUpgrade`, billing.tsx's storage-addon and switch-cycle handlers)
 * fell through to their generic error toast and kept showing the stale paid
 * plan. `handleBillingResetTestMode` is now the ONE place every one of those
 * callers routes a caught checkout error through, so "clear the stale
 * intent, reload subscription state, surface the real message" happens
 * identically everywhere instead of being reimplemented (or missed) per
 * caller.
 */
import { ApiError } from './api'
import { userFriendlyError } from './user-friendly-error'

/** The server's machine-readable code for this reset (see module doc). */
export const BILLING_RESET_TEST_MODE_CODE = 'billing_reset_test_mode'

export function isBillingResetTestModeError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === BILLING_RESET_TEST_MODE_CODE
}

export interface BillingResetHandlerOptions {
  /** `useDriveData().refreshPlanDetails` — refreshes the shared plan/quota
   * context so DriveLayout's sidebar (plan, quota, QuotaWarning) reflects
   * Free immediately, not just on the next `beebeeb:plan-changed` listener
   * tick. Required: every caller of this handler renders under
   * `DriveDataProvider` and has this available. */
  refreshPlanDetails: () => void
  /** Re-fetch page-LOCAL subscription state, e.g. billing.tsx's `loadData`
   * or UpgradeDialog's `onSuccess`. Optional — a caller with no page-local
   * subscription state to refresh (the nudge modal, pricing.tsx) omits it. */
  reloadLocal?: () => void | Promise<void>
  /** Drop any stale pending-checkout marker for the now-reset subscription —
   * offering to "resume" it would just reproduce this same 409. */
  clearPendingCheckout?: () => void
  /** Injectable so the handler is unit-testable without a `window` global
   * (`bun test` has no DOM). Production callers omit it and get the real
   * `window.dispatchEvent`. */
  dispatchPlanChanged?: () => void
}

function realDispatchPlanChanged(): void {
  // `window` doesn't exist under `bun test` (no DOM) — every test in
  // test/1518-billing-reset-shared-handler.test.ts injects `dispatchPlanChanged`
  // so this branch is never reached there, but guard it anyway (matches the
  // try/catch-around-browser-globals convention elsewhere, e.g.
  // upgrade-nudge-modal.tsx's `dismiss()` around `sessionStorage`) rather than
  // relying solely on every future caller remembering to inject it.
  try {
    window.dispatchEvent(new Event('beebeeb:plan-changed'))
  } catch { /* non-browser environment */ }
}

/**
 * Checks whether `err` is the `billing_reset_test_mode` 409. When it is:
 * clears any stale pending-checkout marker, dispatches `beebeeb:plan-changed`
 * (the app-wide "billing state moved" signal — see drive-data-context.tsx's
 * listener) AND calls `refreshPlanDetails()` directly (belt-and-suspenders,
 * matching every other billing mutation in billing.tsx), reloads the
 * caller's page-local state if it has any, and returns the user-facing
 * message for the caller to show. Returns `null` when `err` is a different
 * error, so the caller falls through to its own generic handling.
 */
export async function handleBillingResetTestMode(
  err: unknown,
  options: BillingResetHandlerOptions,
): Promise<string | null> {
  if (!isBillingResetTestModeError(err)) return null
  options.clearPendingCheckout?.()
  ;(options.dispatchPlanChanged ?? realDispatchPlanChanged)()
  options.refreshPlanDetails()
  await options.reloadLocal?.()
  return userFriendlyError(err)
}

/**
 * Shape carried via React Router `navigate(to, { state })` when a checkout
 * entry point that immediately navigates away (upgrade-nudge-modal's
 * "Upgrade now" → /billing) hits this reset: the explanation would
 * otherwise be discarded with the component-local error state that held it
 * (task 1518 part C, Codex PR #69 thread). The receiving page (billing.tsx)
 * reads this once on mount and shows it as a toast.
 */
export interface BillingResetNavigationState {
  billingResetMessage: string
}

export function billingResetNavigationState(message: string): BillingResetNavigationState {
  return { billingResetMessage: message }
}
