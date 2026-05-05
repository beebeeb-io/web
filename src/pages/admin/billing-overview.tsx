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
  syncBillingPlans,
  type Subscription,
  type Plan,
  type Invoice,
  type AdminStats,
  type AdminBillingStats,
  type BillingSyncResult,
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
  id: string
  label: string
  count: number
  pct: number
  className: string
}

function buildSegments(totalUsers: number, dist: {
  personal: number; pro: number; data_hoarder: number
}): PlanSegment[] {
  const paid = (dist.personal ?? 0) + (dist.pro ?? 0) + (dist.data_hoarder ?? 0)
  const free = Math.max(0, totalUsers - paid)
  const safe = totalUsers > 0 ? totalUsers : 1
  return [
    { id: 'free',         label: 'Free',         count: free,                   pct: (free                   / safe) * 100, className: 'bg-ink-3'    },
    { id: 'personal',     label: 'Personal',     count: dist.personal ?? 0,     pct: ((dist.personal ?? 0)   / safe) * 100, className: 'bg-amber'    },
    { id: 'pro',          label: 'Pro',           count: dist.pro ?? 0,          pct: ((dist.pro ?? 0)        / safe) * 100, className: 'bg-green'    },
    { id: 'data_hoarder', label: 'Data Hoarder',  count: dist.data_hoarder ?? 0, pct: ((dist.data_hoarder ?? 0) / safe) * 100, className: 'bg-amber-deep' },
  ]
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function AdminBilling() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [billingStats, setBillingStats] = useState<AdminBillingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<BillingSyncResult | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)

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

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await syncBillingPlans()
      setSyncResult(result)
      // Refresh plan list after sync
      const plansData = await getPlans()
      setPlans(plansData.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)))
    } catch {
      setSyncResult(null)
    } finally {
      setSyncing(false)
    }
  }

  const totalUsers = stats?.users.total ?? 0

  // Use real billing stats when available, fall back to zeroes when the
  // endpoint isn't deployed yet (getAdminBillingStats returns null on 404).
  // Guard every field with ?? 0 — production may return a partial object
  // if the stripe_plans table is empty or the sync hasn't run yet.
  const dist = {
    personal:     billingStats?.plan_distribution?.personal     ?? 0,
    pro:          billingStats?.plan_distribution?.pro          ?? 0,
    data_hoarder: billingStats?.plan_distribution?.data_hoarder ?? 0,
  }

  const totalSubscribers = billingStats?.total_subscribers
    ?? (dist.personal + dist.pro + dist.data_hoarder)
  const freeUsers = billingStats?.plan_distribution?.free
    ?? Math.max(0, totalUsers - totalSubscribers)
  const mrrEur = billingStats ? (billingStats.mrr_cents ?? 0) / 100 : null
  const conversionRate = billingStats
    ? `${((billingStats.conversion_rate ?? 0) * 100).toFixed(1)}%`
    : totalUsers > 0
      ? `${((totalSubscribers / totalUsers) * 100).toFixed(1)}%`
      : '0%'
  const segments = buildSegments(totalUsers, dist)

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
        <div className="ml-auto flex items-center gap-3">
          {syncResult && (
            <span className="text-[11px] text-ink-3 font-mono">
              {syncResult.already_up_to_date
                ? `Already up to date · last synced ${formatTimeAgo(syncResult.synced_at)}`
                : `Synced ${syncResult.plans_synced} plans (${syncResult.created} created, ${syncResult.updated} updated) · ${formatTimeAgo(syncResult.synced_at)}`
              }
            </span>
          )}
          <BBButton
            size="sm"
            variant="amber"
            onClick={() => void handleSync()}
            disabled={syncing}
          >
            <Icon name="upload" size={11} className="mr-1.5" />
            {syncing ? 'Syncing…' : 'Sync from Stripe'}
          </BBButton>
        </div>
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
            {/* No billing data banner */}
            {!billingStats && (
              <div className="px-4 py-3 rounded-lg border border-amber/30 bg-amber-bg text-[13px] text-ink-2 flex items-center gap-2">
                <Icon name="upload" size={13} className="text-amber-deep shrink-0" />
                <span>No billing data yet — click <strong>Sync from Stripe</strong> to pull plan and subscription data.</span>
              </div>
            )}

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
                sub={`of ${(totalUsers ?? 0).toLocaleString()} total`}
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
                  {(totalUsers ?? 0).toLocaleString()} users
                </div>
              </div>
              <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-paper-3">
                {segments.map(seg => (
                  seg.pct > 0 && (
                    <div
                      key={seg.id}
                      className={seg.className}
                      style={{ width: `${seg.pct}%` }}
                      title={`${seg.label}: ${seg.count} (${(seg.pct ?? 0).toFixed(1)}%)`}
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
                        {(seg.count ?? 0).toLocaleString()} · {(seg.pct ?? 0).toFixed(1)}%
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

            {/* Plan cards */}
            {plans.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                    Plans — Stripe source of truth
                  </div>
                  <span className="text-[10px] text-ink-4">Click a plan to inspect details</span>
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 4)}, 1fr)` }}>
                  {plans
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
                    .map(plan => {
                      const isSelected = selectedPlan?.id === plan.id
                      return (
                        <button
                          key={plan.id}
                          onClick={() => setSelectedPlan(isSelected ? null : plan)}
                          className={`rounded-xl border p-3.5 text-left cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-amber-bg border-amber ring-1 ring-amber/40'
                              : plan.id === sub?.plan
                                ? 'bg-amber-bg/50 border-amber-deep/40 hover:border-amber-deep'
                                : 'bg-paper border-line-2 hover:border-line hover:bg-paper-2'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                            <span className="text-[13px] font-semibold">{plan.name}</span>
                            {plan.is_active !== false
                              ? <BBChip variant="green" className="text-[9px]">Active</BBChip>
                              : <BBChip className="text-[9px]">Inactive</BBChip>
                            }
                            {plan.id === sub?.plan && (
                              <BBChip variant="amber" className="text-[9px]">Your plan</BBChip>
                            )}
                          </div>
                          <div className="font-mono text-[13px] font-bold text-ink">
                            {plan.price_eur === 0 ? 'Free' : `€${plan.price_eur.toFixed(2)}/mo`}
                          </div>
                          {plan.price_yearly_eur > 0 && (
                            <div className="font-mono text-[10px] text-ink-3">
                              €{plan.price_yearly_eur.toFixed(2)}/yr
                            </div>
                          )}
                          <div className="text-[11px] text-ink-2 mt-1.5 font-medium">
                            {plan.storage_label}
                          </div>
                          {plan.stripe_product_id && (
                            <div className="font-mono text-[9px] text-ink-4 mt-1 truncate">
                              {plan.stripe_product_id}
                            </div>
                          )}
                        </button>
                      )
                    })}
                </div>

                {/* Plan detail panel */}
                {selectedPlan && (
                  <div className="mt-3 rounded-xl border border-line-2 bg-paper p-4 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-[13px] font-semibold text-ink">{selectedPlan.name}</div>
                        <div className="text-[11px] text-ink-3 mt-0.5">{selectedPlan.storage_label} storage</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedPlan.stripe_product_id && (
                          <a
                            href={`https://dashboard.stripe.com/products/${selectedPlan.stripe_product_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-amber-deep hover:underline font-medium"
                          >
                            Edit in Stripe
                            <Icon name="chevron-right" size={10} />
                          </a>
                        )}
                        <button
                          onClick={() => setSelectedPlan(null)}
                          className="text-ink-4 hover:text-ink transition-colors"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-paper-2 border border-line">
                        <div className="text-[10px] text-ink-4 mb-0.5">Monthly</div>
                        <div className="font-mono text-[13px] font-semibold">
                          {selectedPlan.price_eur === 0 ? '—' : `€${selectedPlan.price_eur.toFixed(2)}`}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-paper-2 border border-line">
                        <div className="text-[10px] text-ink-4 mb-0.5">Annual</div>
                        <div className="font-mono text-[13px] font-semibold">
                          {selectedPlan.price_yearly_eur === 0 ? '—' : `€${selectedPlan.price_yearly_eur.toFixed(2)}`}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-paper-2 border border-line">
                        <div className="text-[10px] text-ink-4 mb-0.5">Storage</div>
                        <div className="font-mono text-[13px] font-semibold">
                          {selectedPlan.storage_label}
                        </div>
                      </div>
                    </div>

                    {selectedPlan.stripe_product_id && (
                      <div className="mb-3 p-2.5 rounded-lg bg-paper-2 border border-line">
                        <div className="text-[10px] text-ink-4 mb-0.5">Stripe product ID</div>
                        <div className="font-mono text-[11px] text-ink-2">{selectedPlan.stripe_product_id}</div>
                      </div>
                    )}

                    {selectedPlan.features.length > 0 && (
                      <div>
                        <div className="text-[10px] text-ink-4 mb-1.5">Features</div>
                        <ul className="space-y-1">
                          {selectedPlan.features.map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-[12px] text-ink-2">
                              <Icon name="check" size={10} className="text-green mt-0.5 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-[11px] text-ink-4">
                      <span>After editing in Stripe, click <strong className="text-ink-3">Sync from Stripe</strong> to pull changes.</span>
                      {selectedPlan.is_active !== false
                        ? <span className="text-green font-medium">Active</span>
                        : <span className="text-ink-3">Inactive</span>
                      }
                    </div>
                  </div>
                )}
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
