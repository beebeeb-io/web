/**
 * Free-trial status banner (task 0905, UNIT C — Pattern B: no card during trial).
 *
 * Shown at the top of authenticated pages whenever the user's subscription is in
 * the `trialing` state. It computes "N days left in your free trial" from
 * `trial_ends_at` and offers an "Add payment method" CTA that converts the trial
 * to a paid subscription.
 *
 * Convert flow REUSES the 0865 checkout redirect + poll-confirmed return machine:
 * `convertTrial()` returns the Mollie hosted-checkout `{url}`; we write the
 * `bb_pending_checkout` marker (so billing.tsx's poll can confirm the now-active
 * subscription on return) and `window.location.href = url`. The two typed 409s
 * are surfaced and routed:
 *   - `trial_not_active`         → trial lapsed; send to the normal plan picker.
 *   - `trial_already_subscribed` → already converted; send to billing management.
 *
 * A lapsed trial (status back to free) renders NOTHING here — the normal Free
 * plan + upgrade path takes over, so a lapsed user never sees a stale banner.
 *
 * Brand: amber only on the primary "Add payment method" CTA; the day count is
 * mono (it reads like data); honest copy, no emojis.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import { useDriveData } from '../lib/drive-data-context'
import { useToast } from './toast'
import { convertTrial, ApiError } from '../lib/api'

const PENDING_CHECKOUT_KEY = 'bb_pending_checkout'

/** Whole days remaining until an RFC3339 instant (ceil; never negative). */
function daysLeft(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now()
  return diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0
}

export function TrialBanner() {
  const { planDetails } = useDriveData()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [converting, setConverting] = useState(false)

  const sub = planDetails.subscription

  // Only show for an ACTIVE trial with a future end date. A lapsed trial has
  // status back to a non-trialing value (free/cancelled), so this is also the
  // guard against a stale banner.
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return null
  const remaining = daysLeft(sub.trial_ends_at)
  if (remaining <= 0) return null

  // Honest, urgency-aware copy near expiry.
  const nearExpiry = remaining <= 2
  const planLabel = sub.plan ? sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) : 'your plan'

  async function handleConvert() {
    if (converting) return
    setConverting(true)
    try {
      const { url } = await convertTrial()
      // Mirror the 0865 redirect plumbing: stamp the pending-checkout marker so
      // billing.tsx's poll-confirmed return machine recognises and confirms the
      // now-active subscription, then redirect to Mollie's hosted checkout.
      try {
        localStorage.setItem(
          PENDING_CHECKOUT_KEY,
          JSON.stringify({ plan: sub!.plan, cycle: sub!.billing_cycle, ts: Date.now() }),
        )
      } catch { /* private mode — non-fatal, the poll still falls back to plan-change detection */ }
      window.location.href = url
    } catch (err) {
      // Surface the typed 409s and route the user to the right place.
      if (err instanceof ApiError) {
        if (err.code === 'trial_not_active') {
          showToast({
            icon: 'clock',
            title: 'Your trial has ended',
            description: 'Choose a plan to keep your extra storage.',
          })
          navigate('/billing')
          setConverting(false)
          return
        }
        if (err.code === 'trial_already_subscribed') {
          showToast({
            icon: 'check',
            title: 'You are already subscribed',
            description: 'Manage your plan from billing.',
          })
          navigate('/billing')
          setConverting(false)
          return
        }
        if (err.status === 400) {
          showToast({
            icon: 'x',
            title: 'Payments not available yet',
            description: 'We could not start checkout. Please try again shortly.',
            danger: true,
          })
          setConverting(false)
          return
        }
      }
      showToast({
        icon: 'x',
        title: 'Could not add a payment method',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setConverting(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2.5 bg-amber-bg border-b border-amber/30 text-[12.5px] text-ink"
    >
      <Icon name="shield" size={12} className="text-amber-deep shrink-0" />

      <span className="flex-1 text-ink-2">
        {nearExpiry ? (
          <>
            Your trial ends in{' '}
            <span className="font-mono font-semibold text-ink">
              {remaining} {remaining === 1 ? 'day' : 'days'}
            </span>{' '}
            — add a payment method to keep {planLabel}.
          </>
        ) : (
          <>
            <span className="font-mono font-semibold text-ink">{remaining} days</span>{' '}
            left in your free trial. No card required — cancel anytime, you keep your files.
          </>
        )}
      </span>

      <button
        type="button"
        onClick={handleConvert}
        disabled={converting}
        className="shrink-0 px-2.5 py-1 rounded bg-amber text-ink text-[12px] font-medium disabled:opacity-50 hover:brightness-105 transition-all cursor-pointer"
      >
        {converting ? 'Redirecting…' : 'Add payment method'}
      </button>

      <Link
        to="/billing"
        className="shrink-0 text-[12px] text-ink-3 hover:text-ink underline underline-offset-2 transition-colors"
      >
        Details
      </Link>
    </div>
  )
}
