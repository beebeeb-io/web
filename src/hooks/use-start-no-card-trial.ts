/**
 * Start the no-card trial from a page that has the onboarding document's offer in hand
 * (task 1757). One place for what follows a successful start, so the chooser and the
 * billing page cannot drift: put the new subscription into the shared cache, refresh the
 * document (the gate and the banners read it), say what began, and go to the drive.
 * A refusal is rethrown for the form to word (`startTrialErrorCopy`).
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/toast'
import { getSubscription, startNoCardTrial } from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { formatSize } from '../lib/onboarding/account-summary'
import type { TrialOfferView } from '../lib/no-card-trial'
import { clearPlanIntent, type BillingCycle } from '../lib/plan-intent'

type AvailableOffer = Extract<TrialOfferView, { kind: 'available' }>

export function useStartNoCardTrial() {
  const { applySubscription, refreshPlanDetails } = useDriveData()
  const { showToast } = useToast()
  const navigate = useNavigate()

  return useCallback(
    async (offer: AvailableOffer, choice: { plan: string; cycle: BillingCycle }): Promise<void> => {
      const started = await startNoCardTrial({
        endpoint: offer.startEndpoint,
        plan: choice.plan,
        billing_cycle: choice.cycle,
      })
      clearPlanIntent()
      try {
        // The gate reads the shared cache: put the trialing subscription in it BEFORE
        // navigating. A failed read is harmless; the refresh below catches up.
        applySubscription(await getSubscription())
      } catch {
        refreshPlanDetails()
      }
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      showToast({
        icon: 'check',
        title: `Your ${offer.lengthDays}-day trial has started`,
        description: `Up to ${formatSize(started.cap_bytes)} while it runs. No card is on file, so nothing will be charged.`,
      })
      navigate('/', { replace: true })
    },
    [applySubscription, refreshPlanDetails, showToast, navigate],
  )
}
