/**
 * Storage add-on purchases on the billing page: the preview/confirm pair for a
 * SEPA mandate change and the instant card checkout path.
 *
 * Split out of `useBillingActions` (task W sweep), unchanged.
 *
 * Must not: render, or own the add-on slider state.
 */

import {
  updatePaymentMethod,
  previewStorageAddons,
  updateStorageAddons,
  createStorageAddonCheckout,
} from '../../lib/api'
import { handleBillingResetTestMode } from '../../lib/billing-reset'
import { formatStorageSI } from '../../lib/format'
import { setPendingCheckout, clearPendingCheckout, makePreState } from '../../lib/pending-checkout'
import type { BillingData } from './use-billing-data'

type StorageAddonDeps = Pick<
  BillingData,
  | 'sliderTB'
  | 'setAddonPreview'
  | 'setAddonPreviewLoading'
  | 'setAddonSaving'
  | 'setAddonState'
  | 'setAddonPending'
  | 'setAddonAuthorityOverride'
  | 'setAddonInstantPayLoading'
  | 'refreshUsage'
  | 'refreshPlanDetails'
  | 'loadData'
  | 'setPendingCheckoutState'
  | 'showToast'
  | 'effectivePlan'
  | 'sub'
>

export interface StorageAddonFlow {
  handlePreviewStorageAddon: () => Promise<void>
  handleConfirmStorageAddon: () => Promise<void>
  handleStorageAddonInstantPay: () => Promise<void>
}

export function useStorageAddons(data: StorageAddonDeps): StorageAddonFlow {
  const {
    sliderTB,
    setAddonPreview,
    setAddonPreviewLoading,
    setAddonSaving,
    setAddonState,
    setAddonPending,
    setAddonAuthorityOverride,
    setAddonInstantPayLoading,
    refreshUsage,
    refreshPlanDetails,
    loadData,
    setPendingCheckoutState,
    showToast,
    effectivePlan,
    sub,
  } = data

  async function handlePreviewStorageAddon() {
    setAddonPreviewLoading(true)
    try {
      const preview = await previewStorageAddons({ extra_storage_tb: sliderTB })
      if (preview.requires_payment_method) {
        // Redirect to the native payment-method update flow (hosted card
        // checkout) so the user can add a card, then come back.
        try {
          const result = await updatePaymentMethod()
          window.location.href = result.url
          return
        } catch {
          // fall through
        }
        showToast({
          icon: 'x',
          title: 'Payment method required',
          description: 'Add a payment method before upgrading storage.',
          danger: true,
        })
        return
      }
      setAddonPreview(preview)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not preview storage change',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setAddonPreviewLoading(false)
    }
  }

  async function handleConfirmStorageAddon() {
    setAddonSaving(true)
    try {
      const result = await updateStorageAddons({ extra_storage_tb: sliderTB })
      setAddonState(result)
      setAddonPreview(null)
      // SEPA mandate charges settle off-session (a few days) — the apply response
      // carries pending:true and the grant is deferred. Surface an honest pending
      // state instead of claiming the vault already grew. (task 0941)
      if (result.pending) {
        setAddonPending(true)
        showToast({
          icon: 'clock',
          title: 'Storage upgrade pending',
          description: 'Your SEPA mandate is being charged — the extra storage activates in a few days, once the payment settles.',
        })
      } else {
        showToast({
          icon: 'check',
          title: 'Storage updated',
          description: `Your vault is now ${formatStorageSI(result.effective_storage_bytes)}.`,
        })
      }
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      // Task 1706 review #132-A — make the usage refresh awaitable and its
      // outcome observable: on success the drive-context `/files/usage` is
      // fresh and the normal server-truth-first hierarchy renders correctly;
      // on failure the context value is KNOWN-stale, so the transient
      // override keeps the just-applied response's effective_storage_bytes
      // authoritative until the next successful contextUsage refresh clears
      // it (effect keyed on contextUsage identity).
      try {
        const usageFresh = await refreshUsage()
        if (!usageFresh) setAddonAuthorityOverride(true)
      } catch {
        setAddonAuthorityOverride(true)
      }
      refreshPlanDetails()
    } catch (err) {
      const resetMessage = await handleBillingResetTestMode(err, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({ icon: 'info', title: 'Subscription reset', description: resetMessage })
        return
      }
      showToast({
        icon: 'x',
        title: 'Could not update storage',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setAddonSaving(false)
    }
  }

  /**
   * Pay-now-to-activate-instantly path (task 0941, SEPA two-path). Instead of
   * charging the SEPA mandate (which settles in a few days), redirect to a hosted
   * Mollie one-off payment that grants the storage instantly via webhook. Creates
   * NO mandate charge. Mirrors createCheckoutSession's redirect.
   */
  async function handleStorageAddonInstantPay() {
    setAddonInstantPayLoading(true)
    try {
      const { checkout_url, payment_id } = await createStorageAddonCheckout({ extra_storage_tb: sliderTB })
      // F2 (task 0946): persist a pre-checkout intent so the upgraded return can
      // reconcile against the PRE-state (a storage add-on leaves plan/cycle
      // untouched — only extra_storage_tb rises — so without a pre snapshot the
      // confirmation had no baseline and false-failed). kind:'storage' routes the
      // reconcile to the storage-delta path. cycle mirrors the current cycle.
      // `payment_id` (task 0957): the server now returns the provider checkout
      // id for THIS instant-pay charge — this was the one checkout path the
      // spec named explicitly as writing no reconcilable intent at all.
      setPendingCheckout(
        'storage',
        effectivePlan,
        sub?.billing_cycle ?? 'monthly',
        makePreState(sub),
        payment_id,
      )
      window.location.href = checkout_url
    } catch (err) {
      const resetMessage = await handleBillingResetTestMode(err, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({ icon: 'info', title: 'Subscription reset', description: resetMessage })
        setAddonInstantPayLoading(false)
        return
      }
      showToast({
        icon: 'x',
        title: 'Could not start instant payment',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setAddonInstantPayLoading(false)
    }
  }

  return {
    handlePreviewStorageAddon,
    handleConfirmStorageAddon,
    handleStorageAddonInstantPay,
  }
}
