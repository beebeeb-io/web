/**
 * The billing page's dunning flows: the pay-overdue checkout, its bounded
 * return poll (`?paid_overdue=true`) and the mail-intent handler
 * (`?confirm_payment=...`), which decides between paying the arrears and
 * paying a held trial now.
 *
 * Split out of `useBillingActions` (task W sweep); the effects and the
 * state transitions are unchanged, only the file boundary moved.
 *
 * Must not: own subscription data, the pay-now machine, or render.
 */

import { useEffect, useRef, useState } from 'react'
import { getSubscription, payOverdue } from '../../lib/api'
import {
  confirmIntentAction,
  CONFIRM_PAYMENT_PARAM,
} from '../../lib/confirm-payment'
import {
  PAY_OVERDUE_RETURN_PARAM,
  shouldHandlePayOverdueReturn,
  payOverdueReturnDecision,
  payOverdueReturnView,
  type PayOverdueView,
} from '../../lib/pay-overdue-return'
import { PAY_NOW_POLL_INTERVAL_MS, safeCheckoutUrl } from '../../lib/trial-pay-now'
import type { BillingData } from './use-billing-data'

type PayOverdueDeps = Pick<
  BillingData,
  | 'searchParams'
  | 'setSearchParams'
  | 'showToast'
  | 'refreshPlanDetails'
  | 'loadData'
  | 'setPayOverdueLoading'
  | 'sub'
  | 'loading'
  | 'error'
>

export interface PayOverdueFlow {
  payOverdueReturn: PayOverdueView | null
  setPayOverdueReturn: React.Dispatch<React.SetStateAction<PayOverdueView | null>>
  payOverdueReconcileCancelRef: React.MutableRefObject<(() => void) | null>
  reconcilePayOverdue: () => void
  handlePayOverdue: () => Promise<void>
  confirmIntentRaw: string | null
  confirmIntentHandledRef: React.MutableRefObject<boolean>
  confirmNote: string | null
  setConfirmNote: React.Dispatch<React.SetStateAction<string | null>>
  confirmOverdueIntent: boolean
  setConfirmOverdueIntent: React.Dispatch<React.SetStateAction<boolean>>
}

export function usePayOverdueFlow(data: PayOverdueDeps, handlePayNow: () => Promise<void>): PayOverdueFlow {
  const {
    searchParams,
    setSearchParams,
    showToast,
    refreshPlanDetails,
    loadData,
    setPayOverdueLoading,
    sub,
    loading,
    error,
  } = data
  const [payOverdueReturn, setPayOverdueReturn] = useState<PayOverdueView | null>(null)

  // Task 2162: the return from the pay-overdue checkout (`?paid_overdue=true`). The server gives
  // no payment id, so this polls the subscription (the webhook un-freezes the account), bounded like
  // the pay-now return. The param is stripped up front, so a reload or Back never re-runs it, and
  // nothing here starts a checkout.
  const payOverdueReconcileCancelRef = useRef<(() => void) | null>(null)
  function reconcilePayOverdue() {
    payOverdueReconcileCancelRef.current?.()
    setPayOverdueReturn(payOverdueReturnView('checking'))
    let cancelled = false
    payOverdueReconcileCancelRef.current = () => { cancelled = true }
    const start = Date.now()
    const tick = async () => {
      if (cancelled) return
      let latest: Awaited<ReturnType<typeof getSubscription>> | null = null
      try {
        latest = await getSubscription()
      } catch {
        // Transient failure: keep polling until the bound.
      }
      if (cancelled) return
      const decision = payOverdueReturnDecision(latest, Date.now() - start)
      if (decision === 'keep_polling') {
        setTimeout(() => { void tick() }, PAY_NOW_POLL_INTERVAL_MS)
        return
      }
      setPayOverdueReturn(payOverdueReturnView(decision))
      if (decision === 'paid') {
        setConfirmOverdueIntent(false)
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        refreshPlanDetails()
        void loadData()
      }
    }
    void tick()
  }

  useEffect(() => {
    if (!shouldHandlePayOverdueReturn(searchParams.get(PAY_OVERDUE_RETURN_PARAM))) return
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete(PAY_OVERDUE_RETURN_PARAM)
        return p
      },
      { replace: true },
    )
    reconcilePayOverdue()
    return () => { payOverdueReconcileCancelRef.current?.() }
    // Runs once per landing: the param is removed above, so re-runs find nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Task 1062 (WP-D, decision 5) — settle the dunning arrears in full via a
   * one-off Mollie charge, the "Pay outstanding balance" CTA on the read-only
   * freeze banner below. The server computes the REAL outstanding amount (not
   * an estimate) and returns a hosted checkout; the webhook un-freezes the
   * account on `paid`. We just redirect — the return trip lands back here with
   * the account already un-frozen (or, if the charge failed, still frozen).
   */
  async function handlePayOverdue() {
    setPayOverdueLoading(true)
    try {
      const result = await payOverdue()
      // Same guard as pay-now: https, or the DEV-only loopback rule.
      const url = safeCheckoutUrl(result.checkout_url, { allowLocalHttp: import.meta.env.DEV })
      if (!url) throw new Error('The payment page could not be opened. Please try again.')
      window.location.href = url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not start payment',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setPayOverdueLoading(false)
    }
  }

  // Task 2106 — the mails' buttons land here with `?confirm_payment=1` (renewal / past due:
  // pay-overdue) or `?confirm_payment=trial` (held trial: pay-now). The intent follows the URL (so
  // the shell banner's link works on this very page), waits for the subscription to be loaded,
  // starts a checkout ONLY when the account is in the state the mail described, and always
  // consumes the param so a reload or Back never starts a payment by itself.
  const confirmIntentRaw = searchParams.get(CONFIRM_PAYMENT_PARAM)
  const confirmIntentHandledRef = useRef(false)
  const [confirmNote, setConfirmNote] = useState<string | null>(null)
  const [confirmOverdueIntent, setConfirmOverdueIntent] = useState(false)
  useEffect(() => {
    if (confirmIntentRaw === null) {
      confirmIntentHandledRef.current = false
      return
    }
    if (confirmIntentHandledRef.current) return
    const action = confirmIntentAction(confirmIntentRaw, sub, { loading, loadFailed: error !== null })
    // Not consumed while loading or after a failed load: the param stays, so Retry acts on it.
    if (action.kind === 'wait') return
    confirmIntentHandledRef.current = true
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete(CONFIRM_PAYMENT_PARAM)
        return p
      },
      { replace: true },
    )
    if (action.kind === 'pay-now') void handlePayNow()
    else if (action.kind === 'pay-overdue') {
      setConfirmOverdueIntent(true)
      void handlePayOverdue()
    } else if (action.kind === 'note') setConfirmNote(action.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmIntentRaw, loading, error])

  return {
    payOverdueReturn,
    setPayOverdueReturn,
    payOverdueReconcileCancelRef,
    reconcilePayOverdue,
    handlePayOverdue,
    confirmIntentRaw,
    confirmIntentHandledRef,
    confirmNote,
    setConfirmNote,
    confirmOverdueIntent,
    setConfirmOverdueIntent,
  }
}
