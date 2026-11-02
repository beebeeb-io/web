/**
 * The billing page's model: the data hook followed by the actions hook, in the page's original effect order.
 *
 * The billing page model: data + actions, in the order the page used to run
 * them. Views read it through `./model-context.tsx`.
 *
 * Must not: add state or logic of its own.
 */

import { useBillingData } from './use-billing-data'
import { useBillingActions } from './use-billing-actions'

export function useBillingPage() {
  const data = useBillingData()
  const actions = useBillingActions(data)
  return { ...data, ...actions }
}

export type BillingModel = ReturnType<typeof useBillingPage>
