import { useState } from 'react'
import { ApiError, BBButton, BBInput, Icon } from '@beebeeb/shared'
import { redeemCoupon } from '../../lib/api'
import { claimedCopy, codeFromInput, refusalCopy, type CouponRedeemed, type RefusalCopy } from '../../lib/coupon'

/**
 * "Have a coupon?" in Settings -> Billing (task 1814, slice A). For an account that
 * holds no plan: paste the code or the whole link, claim it, and the plan is live. The
 * server refuses an account that already has a plan, so the billing page only mounts
 * this when there is none.
 */
export function CouponCard() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<RefusalCopy | null>(null)
  const [claimed, setClaimed] = useState<CouponRedeemed | null>(null)
  const code = codeFromInput(input)

  async function claim() {
    if (!code || busy) return
    setBusy(true)
    setRefusal(null)
    try {
      const result = await redeemCoupon(code)
      setClaimed(result)
      // The shared subscription cache re-reads: the plan and the quota update here.
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
    } catch (err) {
      const e = err instanceof ApiError ? err : null
      setRefusal(refusalCopy(e?.code, e?.status))
    } finally {
      setBusy(false)
    }
  }

  if (claimed) {
    const copy = claimedCopy(claimed)
    return (
      <div data-testid="coupon-card-claimed" className="border border-line rounded-xl bg-paper px-5 py-4 flex items-start gap-3">
        <Icon name="check" size={16} className="text-green shrink-0 mt-[2px]" />
        <div>
          <div className="text-[13.5px] font-semibold text-ink">{copy.title}</div>
          <p className="text-[12.5px] text-ink-2 leading-relaxed mt-0.5">{copy.body}</p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="coupon-card" className="border border-line rounded-xl bg-paper overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">Coupon</div>
        <div className="text-sm text-ink-2 mt-1">
          Have a coupon link or code? Paste it here. A coupon gives you a plan for a set time, free. No card is asked for.
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <div className="flex-1">
            <BBInput
              value={input}
              onChange={(e) => {
                setInput(e.currentTarget.value)
                setRefusal(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void claim()
              }}
              placeholder="K7M2-QX9T-4HD3 or the link"
              aria-label="Coupon code or link"
              data-testid="coupon-input"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <BBButton variant="amber" disabled={!code || busy} onClick={() => void claim()} data-testid="coupon-redeem">
            {busy ? 'Claiming…' : 'Redeem'}
          </BBButton>
        </div>
        {refusal && (
          <div data-testid="coupon-card-refusal" className="mt-3 text-[12.5px]">
            <div className="font-semibold text-red">{refusal.title}</div>
            <p className="text-ink-2 leading-relaxed mt-0.5">{refusal.body}</p>
          </div>
        )}
      </div>
    </div>
  )
}
