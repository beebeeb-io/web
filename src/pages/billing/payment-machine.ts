/**
 * The billing flow state machine: its typed state, its events, and the one reducer that moves between them.
 *
 * The billing page's UI state machines (task W run 5).
 *
 * Four small, independent slices — they used to be four `useState` calls in
 * the page component. They are modelled together because they are all "which
 * prompt is the page showing right now", and because one reducer keeps the
 * transitions typed (the page dispatches events, never sets a raw union by
 * hand).
 *
 * The slices stay independent on purpose: starting a cancel flow must not
 * reset an open checkout-return banner, and vice versa. That is the behaviour
 * of the four separate `useState` calls this replaces.
 *
 * Must not: call the API, read the router, or hold any server state.
 */

/** The cancel flow: link → "pause instead?" → final confirmation. */
export type CancelFlowState = 'idle' | 'pause' | 'confirm'

/** Which cycle-switch confirmation card is open, if any. */
export type CycleSwitchTarget = 'monthly' | 'yearly'

/** What the post-checkout redirect banner may claim. */
export type CheckoutReturnState = 'finalizing' | 'complete' | 'unconfirmed'

export interface BillingFlowState {
  readonly cancelFlow: CancelFlowState
  readonly trialCancelConfirm: boolean
  readonly cycleSwitch: CycleSwitchTarget | null
  readonly checkoutReturn: CheckoutReturnState
}

export type BillingFlowEvent =
  | { readonly type: 'cancel-flow'; readonly state: CancelFlowState }
  | { readonly type: 'cancel-confirm'; readonly confirming: boolean }
  | { readonly type: 'trial-cancel-confirm'; readonly confirming: boolean }
  | { readonly type: 'cycle-switch'; readonly cycle: CycleSwitchTarget | null }
  | { readonly type: 'checkout-return'; readonly status: CheckoutReturnState }

export const initialBillingFlow: BillingFlowState = {
  cancelFlow: 'idle',
  trialCancelConfirm: false,
  cycleSwitch: null,
  checkoutReturn: 'finalizing',
}

export function billingFlowReducer(state: BillingFlowState, event: BillingFlowEvent): BillingFlowState {
  switch (event.type) {
    case 'cancel-flow':
      return { ...state, cancelFlow: event.state }
    case 'cancel-confirm':
      return { ...state, cancelFlow: event.confirming ? 'confirm' : 'idle' }
    case 'trial-cancel-confirm':
      return { ...state, trialCancelConfirm: event.confirming }
    case 'cycle-switch':
      return { ...state, cycleSwitch: event.cycle }
    case 'checkout-return':
      return { ...state, checkoutReturn: event.status }
  }
}
