/**
 * The billing model context: one provider and the hook each view uses to read the page model.
 *
 * Shares the billing page model with its views.
 *
 * The page computes everything once (`useBillingPage`) and provides the typed
 * object here; each view destructures only what it draws. One model, one
 * provider, no prop drilling through the shell.
 *
 * Must not: create the model or change it.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { BillingModel } from './use-billing-page'

const BillingModelContext = createContext<BillingModel | null>(null)

export function BillingModelProvider({ model, children }: { model: BillingModel; children: ReactNode }) {
  return <BillingModelContext.Provider value={model}>{children}</BillingModelContext.Provider>
}

export function useBillingModel(): BillingModel {
  const model = useContext(BillingModelContext)
  if (!model) throw new Error('useBillingModel must be used inside <BillingModelProvider>')
  return model
}
