import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { KpiCard } from '../../components/admin/kpi-card'
import { AdminShell } from './admin-shell'
import {
  getSubscription,
  getPlans,
  getInvoices,
  getAdminStats,
  getAdminBillingStats,
  type Subscription,
  type Plan,
  type Invoice,
  type AdminStats,
  type AdminBillingStats,
} from '../../lib/api'

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface PlanSegment {
  id: 'free' | 'personal' | 'team' | 'business'
  label: string
  count: number
  pct: number
  className: string
}

function buildSegments(totalUsers: number, subscribers: { personal: number; team: number; business: number }): PlanSegment[] {
  const free = Math.max(0, totalUsers - subscribers.personal - subscribers.team - subscribers.business)
  const safe = totalUsers > 0 ? totalUsers : 1
  return [
    { id: 'free', label: 'Free', count: free, pct: (free / safe) * 100, className: 'bg-ink-3' },
    { id: 'personal', label: 'Personal', count: subscribers.personal, pct: (subscribers.personal / safe) * 100, className: 'bg-amber' },
    { id: 'team', label: 'Team', count: subscribers.team, pct: (subscribers.team / safe) * 100, className: 'bg-green' },
    { id: 'business', label: 'Business', count: subscribers.business, pct: (subscribers.business / safe) * 100, className: 'bg-amber-deep' },
  ]
}

export function AdminBilling() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [billingStats, setBillingStats] = useState<AdminBillingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subData, plansData, invData, statsData, billingData] = await Promise.all([
        getSubscription(),
        getPlans(),
        getInvoices(),
        getAdminStats(),
        getAdminBillingStats(),
      ])
      setSub(subData)
      setPlans(plansData)
      setInvoices(invData)
      setStats(statsData)
      setBillingStats(billingData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totalUsers = stats?.users.total ?? 0

  // Use real billing stats when available, fall back to zeroes when the
  // endpoint isn't deployed yet (getAdminBillingStats returns null on 404).
  const subscribers = billingStats
    ? {
        personal: billingStats.plan_distribution.personal,
        team: billingStats.plan_distribution.team,
        business: billingStats.plan_distribution.business,
      }
    : { personal: 0, team: 0, business: 0 }

  const totalSubscribers = billingStats?.total_subscribers
    ?? (subscribers.personal + subscribers.team + subscribers.business)
  const freeUsers = billingStats?.plan_distribution.free
    ?? Math.max(0, totalUsers - totalSubscribers)
  const mrrEur = billingStats ? billingStats.mrr_cents / 100 : null
  const conversionRate = billingStats
    ? `${(billingStats.conversion_rate * 100).toFixed(1)}%`
    : totalUsers > 0
      ? `${((totalSubscribers / totalUsers) * 100).toFixed(1)}%`
      : '0%'
  const segments = buildSegments(totalUsers, subscribers)

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
            {/* KPI row */}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <KpiCard
                label="MRR"
                value={mrrEur ?? 0}
                format="currency"
                sub={
                  billingStats === null
                    ? 'Stripe not connected'
                    : totalSubscribers > 0
                      ? `${totalSubscribers} paying`
                      : 'No paying customers yet'
                }
              />
              <KpiCard
                label="Subscribers"
                value={totalSubscribers}
                sub={`of ${totalUsers.toLocaleString()} total`}
              />
              <KpiCard
                label="Free users"
                value={freeUsers}
                sub={totalUsers > 0
                  ? `${((freeUsers / totalUsers) * 100).toFixed(0)}% of total`
                  : 'No users yet'}
              />
              <KpiCard
                label="Conversion"
                value={conversionRate}
                sub="Free → paid"
              />
            </div>

            {/* Plan distribution */}
            <div className="rounded-xl bg-paper border border-line-2 p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Plan distribution
                </div>
                <div className="font-mono text-[10px] text-ink-4">
                  {totalUsers.toLocaleString()} users
                </div>
              </div>
              <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-paper-3">
                {segments.map(seg => (
                  seg.pct > 0 && (
                    <div
                      key={seg.id}
                      className={seg.className}
                      style={{ width: `${seg.pct}%` }}
                      title={`${seg.label}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
                    />
                  )
                ))}
              </div>
              <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {segments.map(seg => (
                  <div key={seg.id} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-sm ${seg.className} shrink-0`} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] text-ink-2 truncate">{seg.label}</span>
                      <span className="font-mono text-[10px] text-ink-4">
                        {seg.count.toLocaleString()} · {seg.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue placeholder */}
            <div className="rounded-xl bg-paper border border-line-2 p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Revenue
                </div>
                <span className="font-mono text-[10px] text-ink-4">Last 30 days</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-2 h-40 rounded-lg border border-dashed border-line-2 bg-paper-2">
                <Icon name="lock" size={16} className="text-ink-3" />
                <div className="text-xs text-ink-2 font-medium">Connect Stripe to see revenue data</div>
                <div className="text-[11px] text-ink-3">
                  MRR, churn, and lifetime value will appear here once Stripe is wired up.
                </div>
              </div>
            </div>

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
