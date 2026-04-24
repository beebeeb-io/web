import { useState, useCallback } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { subscribe } from '../lib/api'

type BillingCycle = 'monthly' | 'yearly'
type Region = 'frankfurt' | 'amsterdam' | 'paris'

interface UpgradeDialogProps {
  planId: string
  planName: string
  pricePerSeat: number
  priceYearlySeat: number
  minSeats: number
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

const regions: { id: Region; city: string; country: string; operator: string }[] = [
  { id: 'frankfurt', city: 'Frankfurt', country: 'DE', operator: 'Hetzner' },
  { id: 'amsterdam', city: 'Amsterdam', country: 'NL', operator: 'Leaseweb' },
  { id: 'paris', city: 'Paris', country: 'FR', operator: 'Scaleway' },
]

export function UpgradeDialog({
  planId,
  planName,
  pricePerSeat,
  priceYearlySeat,
  minSeats,
  open,
  onClose,
  onSuccess,
}: UpgradeDialogProps) {
  const [seats, setSeats] = useState(Math.max(minSeats, 3))
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [region, setRegion] = useState<Region>('frankfurt')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const monthlyTotal = seats * pricePerSeat
  const yearlyTotal = seats * priceYearlySeat
  const yearlySavings = (monthlyTotal * 12) - yearlyTotal
  const monthlyEquiv = yearlyTotal / 12
  const storagePerSeat = planId === 'business' ? 5 : 2
  const totalStorage = seats * storagePerSeat

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await subscribe({
        plan: planId,
        billing_cycle: cycle,
        seats,
        region,
      })
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [planId, cycle, seats, region, onClose, onSuccess])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-[600px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-[22px] py-3.5 border-b border-line">
          <h3 className="text-base font-bold">Upgrade to {planName}</h3>
          <BBChip variant="amber" className="ml-auto">14-day free trial</BBChip>
          <button onClick={onClose} className="ml-2 text-ink-3 hover:text-ink transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-[22px]">
          {/* Seats */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Seats
          </div>
          <div className="flex items-center gap-3 p-3.5 bg-paper-2 border border-line rounded-md mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSeats(Math.max(minSeats, seats - 1))}
                className="w-7 h-7 rounded-md border border-line-2 bg-paper flex items-center justify-center hover:bg-paper-2 transition-colors"
              >
                <span className="text-ink-3 text-sm font-medium">-</span>
              </button>
              <span className="font-mono text-lg font-semibold min-w-[40px] text-center">
                {seats}
              </span>
              <button
                onClick={() => setSeats(seats + 1)}
                className="w-7 h-7 rounded-md border border-line-2 bg-paper flex items-center justify-center hover:bg-paper-2 transition-colors"
              >
                <Icon name="plus" size={11} className="text-ink-2" />
              </button>
            </div>
            <div className="flex-1">
              <div className="text-[12.5px] text-ink-2">
                {seats} x EUR {pricePerSeat} ={' '}
                <span className="font-mono font-semibold">
                  EUR {monthlyTotal.toFixed(2)}
                </span>{' '}
                / mo
              </div>
              <div className="text-[11px] text-ink-3">
                {totalStorage} TB shared pool · add or remove any time
              </div>
            </div>
          </div>

          {/* Billing cycle */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Billing cycle
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-[18px]">
            <button
              onClick={() => setCycle('monthly')}
              className={`p-3 rounded-md text-left transition-all ${
                cycle === 'monthly'
                  ? 'bg-paper border-[1.5px] border-ink'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${
                    cycle === 'monthly' ? 'border-ink' : 'border-line-2'
                  }`}
                >
                  {cycle === 'monthly' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-ink" />
                  )}
                </span>
                <span className="text-[13px] font-medium">Monthly</span>
              </div>
              <div className="font-mono text-[11px] text-ink-3 pl-[22px]">
                EUR {monthlyTotal.toFixed(2)} / mo
              </div>
            </button>
            <button
              onClick={() => setCycle('yearly')}
              className={`p-3 rounded-md text-left transition-all ${
                cycle === 'yearly'
                  ? 'bg-amber-bg border-[1.5px] border-amber-deep'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${
                    cycle === 'yearly' ? 'border-amber-deep bg-amber' : 'border-line-2'
                  }`}
                >
                  {cycle === 'yearly' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-ink" />
                  )}
                </span>
                <span className={`text-[13px] ${cycle === 'yearly' ? 'font-semibold' : 'font-medium'}`}>
                  Yearly
                </span>
                <BBChip variant="amber" className="ml-auto">
                  Save EUR {yearlySavings.toFixed(2)}
                </BBChip>
              </div>
              <div className="font-mono text-[11px] text-ink-3 pl-[22px]">
                EUR {yearlyTotal.toFixed(2)} / yr · EUR {monthlyEquiv.toFixed(2)} / mo equiv.
              </div>
            </button>
          </div>

          {/* Data residency */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Data residency
          </div>
          <div className="grid grid-cols-3 gap-2 mb-[18px]">
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`p-2.5 rounded-md text-left transition-all ${
                  region === r.id
                    ? 'bg-paper border-[1.5px] border-ink'
                    : 'bg-paper-2 border border-line hover:border-line-2'
                }`}
              >
                <div className="text-[12.5px] font-semibold">
                  {r.city} · {r.country}
                </div>
                <div className="font-mono text-[11px] text-ink-3">{r.operator}</div>
              </button>
            ))}
          </div>

          {/* Summary */}
          <div className="p-3.5 bg-ink text-paper rounded-md mb-3">
            <div className="flex items-baseline mb-0.5">
              <span className="text-[13px] opacity-70">Today</span>
              <span className="font-mono text-base font-semibold text-amber ml-auto">
                EUR 0.00
              </span>
            </div>
            <div className="text-[11px] opacity-60">
              14 days free · then EUR{' '}
              {cycle === 'yearly' ? yearlyTotal.toFixed(2) : monthlyTotal.toFixed(2)}{' '}
              / {cycle === 'yearly' ? 'year' : 'month'} · cancel anytime
            </div>
          </div>

          {error && (
            <div className="text-sm text-red mb-3 text-center">{error}</div>
          )}

          <BBButton
            variant="amber"
            size="lg"
            className="w-full justify-center"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Start free trial'}
            {!loading && <Icon name="chevron-right" size={13} className="ml-1" />}
          </BBButton>

          <div className="text-[11px] text-ink-4 text-center mt-2">
            SEPA · card · invoice · PayPal · Bitcoin
          </div>
        </div>
      </div>
    </div>
  )
}
