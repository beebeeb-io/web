import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'
import {
  getSubscription,
  getPlans,
  getInvoices,
  type Subscription,
  type Plan,
  type Invoice,
} from '../../lib/api'

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatStorage(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${bytes} B`
}

export function AdminBilling() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subData, plansData, invData] = await Promise.all([
        getSubscription(),
        getPlans(),
        getInvoices(),
      ])
      setSub(subData)
      setPlans(plansData)
      setInvoices(invData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const activePlan = plans.find(p => p.id === sub?.plan)

  // Revenue stats need a dedicated admin endpoint — show placeholder
  const hasRevenueEndpoint = false

  return (
    <AdminShell activeSection="billing">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="file" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Billing overview</h2>
        {sub && (
          <BBChip variant={sub.status === 'active' ? 'green' : 'default'}>
            {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
          </BBChip>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={load}>Retry</BBButton>
          </div>
        ) : (
          <>
            {/* Plan + Subscription cards */}
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {/* Current subscription */}
              <div className="rounded-xl bg-paper border border-line-2 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                  Current subscription
                </div>
                <div className="flex items-baseline gap-2.5 mb-3">
                  <span className="text-xl font-bold">{activePlan?.name ?? sub?.plan ?? 'Free'}</span>
                  {sub?.billing_cycle && sub.plan !== 'free' && (
                    <BBChip variant={sub.billing_cycle === 'yearly' ? 'amber' : 'default'}>
                      {sub.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly'}
                    </BBChip>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-ink-4">Seats</div>
                    <div className="font-mono text-sm font-semibold">{sub?.seats ?? 1}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-ink-4">Storage</div>
                    <div className="font-mono text-sm font-semibold">
                      {activePlan ? formatStorage(activePlan.storage_bytes) : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-ink-4">Region</div>
                    <div className="font-mono text-sm font-semibold">{sub?.region ?? '-'}</div>
                  </div>
                </div>
                {sub?.current_period_end && (
                  <div className="flex items-center gap-2 mt-3 p-2 bg-paper-2 border border-line rounded-md text-[11px]">
                    <Icon name="clock" size={11} className="text-ink-3" />
                    <span>Renews <strong>{formatDate(sub.current_period_end)}</strong></span>
                  </div>
                )}
              </div>

              {/* Plan price details */}
              <div className="rounded-xl bg-paper border border-line-2 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                  Pricing
                </div>
                {activePlan ? (
                  <>
                    <div className="flex items-baseline gap-1.5 mb-3">
                      <span className="text-2xl font-bold font-mono">
                        EUR {sub?.billing_cycle === 'yearly'
                          ? activePlan.price_yearly_eur.toFixed(2)
                          : activePlan.price_eur.toFixed(2)
                        }
                      </span>
                      <span className="text-xs text-ink-3">
                        / {activePlan.per_seat ? 'seat / ' : ''}{sub?.billing_cycle === 'yearly' ? 'year' : 'month'}
                      </span>
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">
                      Plan features
                    </div>
                    <div className="flex flex-col gap-1">
                      {activePlan.features.map((f, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                          <Icon name="check" size={10} className="text-green shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-ink-3">Free tier -- no charges</div>
                )}
              </div>
            </div>

            {/* Revenue stats placeholder */}
            {!hasRevenueEndpoint && (
              <div className="rounded-xl bg-paper-2 border border-line p-5 text-center">
                <Icon name="file" size={16} className="text-ink-4 mx-auto mb-2" />
                <div className="text-[13px] font-semibold text-ink-2 mb-1">Revenue analytics</div>
                <div className="text-[11px] text-ink-3">
                  MRR, churn, and revenue charts will appear here when the admin analytics endpoint is available.
                </div>
              </div>
            )}

            {/* Available plans */}
            {plans.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                  All plans
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${plans.length}, 1fr)` }}>
                  {plans.map(plan => (
                    <div
                      key={plan.id}
                      className={`rounded-xl border p-3.5 ${
                        plan.id === sub?.plan
                          ? 'bg-amber-bg border-amber-deep'
                          : 'bg-paper border-line-2'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[13px] font-semibold">{plan.name}</span>
                        {plan.id === sub?.plan && (
                          <BBChip variant="amber" className="text-[9px]">Active</BBChip>
                        )}
                      </div>
                      <div className="font-mono text-sm font-bold">
                        {plan.price_eur === 0 ? 'Free' : `EUR ${plan.price_eur.toFixed(2)}/mo`}
                      </div>
                      <div className="text-[10px] text-ink-3 mt-0.5">
                        {plan.storage_label} storage
                        {plan.per_seat && ` · per seat · min ${plan.min_seats}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invoices */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
                Recent invoices
              </div>
              {invoices.length === 0 ? (
                <div className="rounded-xl bg-paper-2 border border-line p-5 text-center text-xs text-ink-3">
                  No invoices yet.
                </div>
              ) : (
                <div className="rounded-xl border border-line-2 overflow-hidden">
                  <div
                    className="grid gap-3.5 px-4 py-2 border-b border-line bg-paper-2 text-[10px] font-mono uppercase tracking-wide text-ink-3"
                    style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px' }}
                  >
                    <span>Number</span>
                    <span>Date</span>
                    <span>Amount</span>
                    <span>Status</span>
                  </div>
                  {invoices.slice(0, 10).map(inv => (
                    <div
                      key={inv.id}
                      className="grid gap-3.5 px-4 py-2.5 border-b border-line items-center last:border-b-0"
                      style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px' }}
                    >
                      <span className="font-mono text-[11px]">{inv.number}</span>
                      <span className="text-[11px] text-ink-2">{formatDate(inv.date)}</span>
                      <span className="font-mono text-[11px] font-medium">EUR {inv.amount_eur.toFixed(2)}</span>
                      <BBChip variant={inv.status === 'paid' ? 'green' : 'default'}>
                        {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                      </BBChip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="shield" size={11} className="text-amber-deep" />
        <span>All invoices are VAT-compliant (EU). Payments via Stripe Payments Europe, Ltd.</span>
      </div>
    </AdminShell>
  )
}
