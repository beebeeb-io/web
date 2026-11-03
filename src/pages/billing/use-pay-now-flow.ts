/**
 * The billing page's pay-now flow: start an early charge, poll its settlement, and report the
 * return from a hosted checkout.
 *
 * Split out of `useBillingActions` (task W sweep). The state, the refs and the bounded polls are
 * the same; only the file boundary moved.
 *
 * Must not: own subscription data or the cancel/renew handlers.
 */

import { useEffect, useRef, useState } from 'react'
import { getPaymentStatus, getSubscription, payTrialNow, ApiError, type Subscription } from '../../lib/api'
import {
  type PayNowState,
  IDLE_STATE as PAY_NOW_IDLE_STATE,
  stateAfterPayNowError,
  payNowPollDecision,
  stateForPollOutcome,
  PAY_NOW_POLL_INTERVAL_MS,
  PAY_NOW_PAYMENT_STORAGE_KEY,
  shouldClearPayNowMarker,
  PAY_NOW_RETURN_PARAM,
  routePayNowResult,
  payNowReturnKind,
  payNowReturnDecision,
  payNowReturnView,
  type PayNowReturnView,
} from '../../lib/trial-pay-now'
import type { BillingData } from './use-billing-data'

type PayNowDeps = Pick<
  BillingData,
  'searchParams' | 'setSearchParams' | 'showToast' | 'refreshPlanDetails' | 'loadData' | 'setSub' | 'meta'
>

export interface PayNowFlow {
  payNowState: PayNowState
  payNowReturn: PayNowReturnView | null
  setPayNowReturn: React.Dispatch<React.SetStateAction<PayNowReturnView | null>>
  payNowReconcileCancelRef: React.MutableRefObject<(() => void) | null>
  reconcilePayNow: (paymentId: string | null) => void
  onPayNowSettled: () => Promise<void>
  pollPayNow: (paymentId?: string) => Promise<void>
  handlePayNow: () => Promise<void>
}

export function usePayNowFlow(data: PayNowDeps): PayNowFlow {
  const { searchParams, setSearchParams, showToast, refreshPlanDetails, loadData, setSub, meta } = data

  // Task 1605 — "pay now" to end a mandated trial's 25 GB cap early. See
  // ../lib/trial-pay-now.ts for the phase/poll state machine.
  const [payNowState, setPayNowState] = useState<PayNowState>(PAY_NOW_IDLE_STATE)
  const payNowPollStartRef = useRef<number | null>(null)
  const payNowPollCancelledRef = useRef(false)
  // Task 2092: the result of a customer-present pay-now checkout, shown after the
  // redirect back (`?trial_pay_now=returned|canceled`).
  const [payNowReturn, setPayNowReturn] = useState<PayNowReturnView | null>(null)
  useEffect(() => {
    return () => {
      payNowPollCancelledRef.current = true
    }
  }, [])

  /**
   * Task 1605 — "pay now" ends a mandated trial's 25 GB cap early by
   * charging the first period on the existing mandate right away. Double-
   * click safe: refuses to re-enter while `submitting`/`pending`. Two
   * settlement shapes from the server (see ../lib/trial-pay-now.ts):
   *   - synchronous (card) → refresh once, done.
   *   - `pending: true` (SEPA/off-session) → bounded poll of
   *     GET /billing/subscription until `status === 'active'`.
   */
  async function handlePayNow() {
    if (payNowState.phase === 'submitting' || payNowState.phase === 'pending') return
    payNowPollCancelledRef.current = false
    setPayNowState({ phase: 'submitting' })
    try {
      const result = await payTrialNow()
      // Task 2092: a checkout_url means the bank may ask for 3-D Secure — send the
      // person there. An older server (no checkout_url) keeps the inline behaviour.
      const routed = routePayNowResult(result, { allowLocalHttp: import.meta.env.DEV })
      if (routed.kind === 'redirect') {
        try { sessionStorage.setItem(PAY_NOW_PAYMENT_STORAGE_KEY, routed.paymentId) } catch { /* return page falls back to the subscription */ }
        window.location.assign(routed.url)
        return // stay in 'submitting' while the browser navigates
      }
      const next = routed.state
      setPayNowState(next)
      if (next.phase === 'error') {
        // Task 2162: a refused checkout_url is an error, never "settled" + an "unlocked" toast.
        showToast({ icon: 'x', title: 'Could not start the payment', description: next.message, danger: true })
        return
      }
      if (next.phase === 'pending') {
        payNowPollStartRef.current = Date.now()
        void pollPayNow(next.paymentId)
        return
      }
      await onPayNowSettled()
    } catch (err) {
      const e = err instanceof ApiError ? { status: err.status, code: err.code, message: err.message } : { message: err instanceof Error ? err.message : undefined }
      const failed = stateAfterPayNowError(e)
      setPayNowState(failed)
      // Task 2106: a refusal (e.g. 409 trial_not_active) must be seen even when the refetch below
      // removes the card the inline message lives in.
      showToast({ icon: 'x', title: 'Could not start the payment', description: failed.message, danger: true })
      // Task 1605 (PR #128 review, Codex P2): `trial_not_active` means the
      // trial ended/converted/was cancelled between render and submit — the
      // stale capped `sub` in state would otherwise keep showing the 25 GB
      // card with a now-re-enabled "Pay now" button the user could hit
      // again. Refetch so the real current state (no longer trialing, or a
      // fresh trial state) replaces it immediately, same as a settled
      // pay-now already does via onPayNowSettled().
      if (e.code === 'trial_not_active') {
        refreshPlanDetails()
        void loadData()
      }
    }
  }

  // Task 2092: handle the return from the pay-now checkout. Bounded poll of the
  // payment status; honest copy for every outcome; query param cleaned up front.
  // The stored payment marker survives a 'waiting' outcome (the payment may
  // still be open): only a final state clears it. Refresh and a later plain
  // visit to /billing both resume the check from the marker.
  const payNowReconcileCancelRef = useRef<(() => void) | null>(null)
  function reconcilePayNow(paymentId: string | null) {
    payNowReconcileCancelRef.current?.()
    setPayNowReturn(payNowReturnView('checking'))
    let cancelled = false
    payNowReconcileCancelRef.current = () => { cancelled = true }
    const start = Date.now()
    const tick = async () => {
      if (cancelled) return
      let status: string | null = null
      try {
        if (paymentId) {
          status = (await getPaymentStatus(paymentId)).status
        } else {
          status = (await getSubscription()).status === 'active' ? 'paid' : null
        }
      } catch {
        // Transient failure — keep polling until the bound.
      }
      if (cancelled) return
      const decision = payNowReturnDecision(status, Date.now() - start)
      if (decision === 'keep_polling') {
        setTimeout(() => { void tick() }, PAY_NOW_POLL_INTERVAL_MS)
        return
      }
      setPayNowReturn(payNowReturnView(decision))
      if (shouldClearPayNowMarker(decision)) {
        try { sessionStorage.removeItem(PAY_NOW_PAYMENT_STORAGE_KEY) } catch { /* ignore */ }
      }
      if (decision === 'paid') {
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        refreshPlanDetails()
        void loadData()
      }
    }
    void tick()
  }

  useEffect(() => {
    const kind = payNowReturnKind(searchParams.get(PAY_NOW_RETURN_PARAM))
    let paymentId: string | null = null
    try {
      // Read, don't remove yet: a dev-mode double effect run must see it again.
      paymentId = sessionStorage.getItem(PAY_NOW_PAYMENT_STORAGE_KEY)
    } catch { /* no storage: fall back to the subscription */ }
    if (!kind) {
      // Plain visit: resume checking a payment we never saw a final state for.
      if (paymentId) reconcilePayNow(paymentId)
      return () => { payNowReconcileCancelRef.current?.() }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete(PAY_NOW_RETURN_PARAM)
        return p
      },
      { replace: true },
    )
    if (kind === 'canceled') {
      setPayNowReturn(payNowReturnView('canceled'))
      try { sessionStorage.removeItem(PAY_NOW_PAYMENT_STORAGE_KEY) } catch { /* ignore */ }
      return
    }
    reconcilePayNow(paymentId)
    return () => { payNowReconcileCancelRef.current?.() }
    // Runs once per landing: the param is removed above, so re-runs find nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onPayNowSettled() {
    window.dispatchEvent(new Event('beebeeb:plan-changed'))
    refreshPlanDetails()
    await loadData()
    showToast({ icon: 'check', title: `${meta.label} unlocked`, description: 'Your full plan storage is now available.' })
  }

  async function pollPayNow(paymentId?: string) {
    if (payNowPollCancelledRef.current) return
    const start = payNowPollStartRef.current ?? Date.now()
    let status: string | null = null
    try {
      const latest = await getSubscription()
      status = latest.status ?? null
      if (status === 'active') setSub(latest as Subscription)
    } catch {
      // Transient fetch failure — keep polling until the bounded timeout.
    }
    if (payNowPollCancelledRef.current) return
    const elapsed = Date.now() - start
    const outcome = payNowPollDecision(elapsed, status)
    setPayNowState(stateForPollOutcome(outcome, elapsed, paymentId))
    if (outcome === 'keep_polling') {
      setTimeout(() => { void pollPayNow(paymentId) }, PAY_NOW_POLL_INTERVAL_MS)
      return
    }
    if (outcome === 'settled') {
      await onPayNowSettled()
    }
  }

  return {
    payNowState,
    payNowReturn,
    setPayNowReturn,
    payNowReconcileCancelRef,
    reconcilePayNow,
    onPayNowSettled,
    pollPayNow,
    handlePayNow,
  }
}