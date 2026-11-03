// The signup call-to-action shown to guests viewing a share.
import { useState, useEffect } from 'react'
import { getPlans } from '../../lib/api'
import { formatEur } from '../../lib/trial-checkout'

// ─── Acquisition CTA ─────────────────────────────────────────────────────────

/**
 * Subtle sign-up nudge shown below the share card to unauthenticated visitors.
 * The file is the star — this is a quiet footnote, not a modal.
 *
 * We do NOT take a sharer name: anonymous recipients must never see any
 * identifier of the creator (task 0452).
 */
export function AcquisitionCTA({
  signupUrl,
}: {
  signupUrl: string
}) {
  // Task 1701 — "From €X/month" renders the STORED price (the cheapest
  // purchasable plan from the public /billing/plans), never a hardcoded
  // literal: the owner's stored price is the only honest number here. Until
  // the plans answer (or on error), the price sentence is simply omitted —
  // a missing claim beats a made-up one.
  const [fromPriceEur, setFromPriceEur] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    getPlans()
      .then((plans) => {
        if (cancelled) return
        const purchasable = (plans ?? []).filter(
          (p) => p.purchasable !== false && !p.coming_soon,
        )
        if (purchasable.length === 0) return
        setFromPriceEur(Math.min(...purchasable.map((p) => p.price_eur)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <div className="mt-6 text-center px-4">
      <p className="text-[12.5px] text-ink-4 mb-1">Liked how this worked?</p>
      <p className="text-[13px] text-ink-3 mb-4 leading-relaxed max-w-[320px] mx-auto">
        This file was shared with end-to-end encryption — only you can read it.
        {' '}Get the same for your own files.
      </p>
      <a
        href={signupUrl}
        className="inline-flex items-center gap-2 px-5 py-2 bg-amber text-ink text-[13px] font-semibold rounded-lg hover:brightness-105 transition-all no-underline"
      >
        Start a 14-day free trial
      </a>
      <p className="text-[11px] text-ink-4 mt-2.5">
        {fromPriceEur != null && <>From {formatEur(fromPriceEur)}/month. </>}
        Cancel any time during the trial. No tracking, no ads.
      </p>
    </div>
  )
}
