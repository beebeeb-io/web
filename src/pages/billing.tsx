import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import { UpgradeDialog } from '../components/upgrade-dialog'
import { useToast } from '../components/toast'
import {
  getSubscription,
  getInvoices,
  createPortalSession,
  type Subscription,
  type Invoice,
} from '../lib/api'

const planMeta: Record<string, { label: string; pricePerSeat: number; priceYearlySeat: number; storagePerSeat: number; minSeats: number }> = {
  free: { label: 'Free', pricePerSeat: 0, priceYearlySeat: 0, storagePerSeat: 20, minSeats: 1 },
  personal: { label: 'Personal', pricePerSeat: 5, priceYearlySeat: 48, storagePerSeat: 2000, minSeats: 1 },
  team: { label: 'Team', pricePerSeat: 6, priceYearlySeat: 58, storagePerSeat: 2000, minSeats: 3 },
  business: { label: 'Business', pricePerSeat: 12, priceYearlySeat: 115, storagePerSeat: 5000, minSeats: 3 },
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatStorage(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(0)} TB`
  return `${gb} GB`
}

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('team')
  const [portalLoading, setPortalLoading] = useState(false)
  const showSuccess = searchParams.get('success') === 'true'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subData, invData] = await Promise.all([
        getSubscription(),
        getInvoices(),
      ])
      setSub(subData)
      setInvoices(invData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const meta = planMeta[sub?.plan ?? 'free'] ?? planMeta.free
  const totalStorage = meta.storagePerSeat * (sub?.seats ?? 1)

  function openUpgrade(plan: string) {
    setUpgradePlan(plan)
    setUpgradeOpen(true)
  }

  function dismissSuccess() {
    setSearchParams({}, { replace: true })
  }

  async function handleManageBilling() {
    setPortalLoading(true)
    try {
      const { url } = await createPortalSession()
      window.location.href = url
    } catch (err) {
      showToast({ icon: 'x', title: 'Billing portal unavailable', description: err instanceof Error ? err.message : 'Could not open billing portal', danger: true })
      setPortalLoading(false)
    }
  }

  if (loading) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" subtitle="Loading..." />
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </SettingsShell>
    )
  }

  if (error) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" />
        <div className="py-16 text-center">
          <div className="text-sm text-red mb-2">{error}</div>
          <BBButton size="sm" variant="ghost" onClick={() => void loadData()}>Retry</BBButton>
        </div>
      </SettingsShell>
    )
  }

  return (
    <SettingsShell activeSection="billing">
      <SettingsHeader
        title="Plan & billing"
        subtitle={`${meta.label} plan · ${sub?.seats ?? 1} ${(sub?.seats ?? 1) > 1 ? 'seats' : 'seat'}`}
      />

      <div className="p-7 space-y-5">
        {/* Success banner after Stripe checkout */}
        {showSuccess && (
          <div className="flex items-center gap-3 p-3.5 bg-green/10 border border-green/30 rounded-lg text-sm">
            <Icon name="check" size={14} className="text-green shrink-0" />
            <span className="flex-1">Your subscription is now active. Welcome aboard.</span>
            <button
              onClick={dismissSuccess}
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* Plan summary + Payment methods — side by side */}
        <div className="grid gap-3.5" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
          {/* Current plan */}
          <div className="border border-line rounded-lg p-[18px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">
              Current plan
            </div>
            <div className="flex items-baseline gap-2.5 mb-2.5">
              <span className="text-2xl font-bold">{meta.label}</span>
              {sub?.billing_cycle === 'yearly' && sub.plan !== 'free' && (
                <BBChip variant="amber">Yearly · -20%</BBChip>
              )}
              {sub?.billing_cycle === 'monthly' && sub.plan !== 'free' && (
                <BBChip>Monthly</BBChip>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3.5">
              <div>
                <div className="text-[11px] text-ink-4">Seats</div>
                <div className="font-mono text-[15px] font-semibold">
                  {sub?.seats ?? 1}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-ink-4">Storage</div>
                <div className="font-mono text-[15px] font-semibold">
                  {formatStorage(totalStorage)}
                </div>
              </div>
            </div>

            {sub?.current_period_end && (
              <div className="flex items-center gap-2.5 p-2.5 bg-paper-2 border border-line rounded-md text-xs">
                <Icon name="clock" size={12} className="text-ink-3" />
                <span className="flex-1">
                  Renews <strong>{formatDate(sub.current_period_end)}</strong>
                </span>
              </div>
            )}

            {sub?.plan === 'free' && (
              <div className="mt-3 flex gap-2">
                <BBButton
                  variant="amber"
                  size="sm"
                  onClick={() => openUpgrade('personal')}
                >
                  Upgrade to Personal
                </BBButton>
                <BBButton
                  size="sm"
                  onClick={() => openUpgrade('team')}
                >
                  Upgrade to Team
                </BBButton>
              </div>
            )}

            {sub?.plan !== 'free' && (
              <div className="mt-3 flex gap-2">
                <BBButton
                  size="sm"
                  onClick={() => openUpgrade(
                    sub?.plan === 'personal' ? 'team' :
                    sub?.plan === 'team' ? 'business' : 'business'
                  )}
                >
                  <Icon name="settings" size={12} className="mr-1.5" />
                  Change plan
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleManageBilling()}
                  disabled={portalLoading}
                >
                  {portalLoading ? 'Redirecting...' : 'Manage billing'}
                </BBButton>
              </div>
            )}
          </div>

          {/* Payment methods */}
          <div className="border border-line rounded-lg p-[18px]">
            <div className="flex items-center mb-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Payment method
              </div>
              <BBButton size="sm" variant="ghost" className="ml-auto">
                <Icon name="plus" size={11} className="mr-1" />
                Add
              </BBButton>
            </div>

            {sub?.plan === 'free' ? (
              <div className="text-sm text-ink-3 py-4 text-center">
                No payment method needed on the Free plan.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2.5 rounded-md border border-line bg-paper-2">
                  <div className="w-[34px] h-[22px] rounded bg-gradient-to-br from-blue-500 to-blue-400 text-white text-[9px] font-bold flex items-center justify-center tracking-wider">
                    SEPA
                  </div>
                  <div className="flex-1">
                    <div className="font-mono text-xs font-medium">
                      NL** **** **** 4721
                    </div>
                    <div className="text-[11px] text-ink-3">Direct debit</div>
                  </div>
                  <BBChip variant="green">Default</BBChip>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Invoices */}
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Invoices
            </span>
            {invoices.length > 0 && (
              <BBButton size="sm" variant="ghost" className="ml-auto">
                <Icon name="download" size={11} className="mr-1" />
                Download all
              </BBButton>
            )}
          </div>

          {invoices.length === 0 ? (
            <div className="text-sm text-ink-3 py-6 text-center border border-line rounded-lg bg-paper-2">
              No invoices yet.
            </div>
          ) : (
            <div className="border border-line rounded-lg overflow-hidden">
              {/* Table header */}
              <div
                className="grid gap-3.5 px-4 py-2 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"
                style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px 40px' }}
              >
                <span>Number</span>
                <span>Date</span>
                <span>Amount</span>
                <span>Status</span>
                <span />
              </div>

              {/* Rows */}
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="grid gap-3.5 px-4 py-2.5 border-b border-line items-center last:border-b-0"
                  style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px 40px' }}
                >
                  <span className="font-mono text-xs">{inv.number}</span>
                  <span className="text-[12.5px] text-ink-2">{formatDate(inv.date)}</span>
                  <span className="font-mono text-xs font-medium">
                    EUR {inv.amount_eur.toFixed(2)}
                  </span>
                  <span>
                    <BBChip variant={inv.status === 'paid' ? 'green' : 'default'}>
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </BBChip>
                  </span>
                  <div className="flex justify-end">
                    <BBButton size="sm" variant="ghost">
                      <Icon name="download" size={12} />
                    </BBButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3.5 px-4 py-3 bg-paper-2 border border-line rounded-lg text-[11.5px] text-ink-3">
          <Icon name="shield" size={12} className="text-amber-deep" />
          <span>All invoices are VAT-compliant (EU · reverse charge). Signed DPA on file.</span>
          <BBButton size="sm" variant="ghost" className="ml-auto">
            Download DPA
          </BBButton>
        </div>
      </div>

      {/* Upgrade dialog */}
      <UpgradeDialog
        planId={upgradePlan}
        planName={planMeta[upgradePlan]?.label ?? 'Team'}
        pricePerSeat={planMeta[upgradePlan]?.pricePerSeat ?? 6}
        priceYearlySeat={planMeta[upgradePlan]?.priceYearlySeat ?? 58}
        minSeats={planMeta[upgradePlan]?.minSeats ?? 3}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onSuccess={() => void loadData()}
      />
    </SettingsShell>
  )
}
