/**
 * The subscription status badge: one pill for the subscription's state.
 *
 * The plan-state pill (Trial / Cancelling / Past due / Paused / Active).
 *
 * Extracted from the page's local `statusBadge()` helper (task W run 5) so the
 * summary card and the current-plan card share one renderer.
 *
 * Must not: own state or call the API.
 */

import type { Subscription } from '../../lib/api'

export function SubscriptionStatusBadge({ sub, effectivePlan }: { sub: Subscription | null; effectivePlan: string }) {
  if (effectivePlan === 'free') return null
  const cfg =
    sub?.status === 'trialing'   ? { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Trial' }      :
    sub?.status === 'cancelling' ? { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Cancelling' } :
    sub?.status === 'past_due'   ? { bg: 'bg-red/10',   text: 'text-red',        dot: 'bg-red',        label: 'Past due' }   :
    sub?.status === 'paused'     ? { bg: 'bg-paper-3',  text: 'text-ink-2',      dot: 'bg-ink-3',      label: 'Paused' }     :
                                   // Active plan-state pill is AMBER (task 0942 — the encryption/primary accent),
                                   // distinct from the transaction status chips (Paid/Issued) which stay green.
                                   { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Active' }
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${cfg.bg} ${cfg.text} text-[11px] font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  )
}
