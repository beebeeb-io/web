/**
 * Task 1707 — same-plan re-purchase guard helpers (web side).
 *
 * The server's `POST /billing/checkout` (Mollie path) now refuses a checkout
 * for the EXACT plan+cycle the user's newest entitled subscription row already
 * carries as `status='active'` with a real Mollie subscription — typed 409
 * `already_subscribed` ("You already have an active basic (yearly)
 * subscription — manage it at /billing"). This module is the ONE place the web
 * recognises that error and decides the "is this the user's current plan?"
 * CTA state, so every checkout entry point (pricing page, UpgradeDialog,
 * upgrade nudge) maps it identically instead of re-deriving it.
 *
 * The client-side "current plan" checks are best-effort by construction: the
 * web's `Subscription` snapshot has no Mollie-subscription-id or
 * billing-environment field, so an admin-granted entitlement or a
 * test-environment row also reads as "current" here. That mismatch is
 * fail-safe in the honest direction — the CTA says Current plan and no
 * checkout is started, which is the behaviour the server guard would
 * otherwise enforce after a wasted round trip.
 */
import { ApiError } from './api'
import type { Subscription } from '@beebeeb/shared'

/** The server's machine-readable code for the same-plan guard (task 1707). */
export const SAME_PLAN_ACTIVE_CODE = 'already_subscribed'

/** True when `err` is the same-plan re-purchase 409. */
export function isSamePlanActiveError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.code === SAME_PLAN_ACTIVE_CODE
}

/**
 * Grounded copy for the same-plan 409. The server's own message already names
 * the exact plan + cycle and where to manage it — that IS the friendly copy,
 * so pass it through; the fallback only covers a body-less synthetic error.
 */
export function samePlanConflictMessage(err: ApiError): string {
  return err.message || 'You already have an active subscription on this plan. Manage it in Billing.'
}

/**
 * True when the user's subscription snapshot IS this plan on this cycle and
 * `status='active'` — i.e. the checkout this CTA would start is the exact
 * purchase the server guard refuses. Strict slug equality both sides (the
 * legacy `personal` alias never matches a `basic` card, mirroring the
 * server's raw-slug comparison). Only `active` matches: a trialing or
 * cancelled row must keep its checkout CTA (the server passes those through).
 */
export function isCurrentPlanCycle(
  subscription: Pick<Subscription, 'plan' | 'billing_cycle' | 'status'> | null | undefined,
  planId: string,
  cycle: string,
): boolean {
  return (
    subscription?.status === 'active' &&
    subscription.plan === planId &&
    subscription.billing_cycle === cycle
  )
}
