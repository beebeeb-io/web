import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import { useToast } from '../components/toast'
import { getToken, createCheckoutSession } from '../lib/api'

type BillingCycle = 'monthly' | 'yearly'

interface PlanDef {
  id: string
  name: string
  priceMonthly: number
  priceYearly: number
  seat: string | null
  note: string
  storage: string
  cta: string
  ctaVariant: 'amber' | 'default' | 'ghost'
  highlight?: boolean
  features: { label: string; strong?: boolean }[]
}

const plans: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    seat: null,
    note: 'Forever. No card needed.',
    storage: '20 GB',
    cta: 'Create account',
    ctaVariant: 'default',
    features: [
      { label: 'E2E encryption · zero-knowledge' },
      { label: 'Unlimited devices' },
      { label: 'Link sharing · passphrase · expiry' },
      { label: 'Photos & drive' },
    ],
  },
  {
    id: 'personal',
    name: 'Personal',
    priceMonthly: 5,
    priceYearly: 48,
    seat: '/ month',
    note: '2 TB. One flat price. No upsells.',
    storage: '2 TB',
    cta: 'Start 14-day trial',
    ctaVariant: 'default',
    features: [
      { label: 'Everything in Free' },
      { label: '2 TB encrypted storage', strong: true },
      { label: 'Photo library · EXIF stripped' },
      { label: 'Recovery via trusted contact' },
      { label: 'EU jurisdiction of choice' },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    priceMonthly: 6,
    priceYearly: 58,
    seat: '/ user · month',
    note: '3+ seats. 2 TB each, pooled.',
    storage: '2 TB / seat · pooled',
    cta: 'Try with your team',
    ctaVariant: 'amber',
    highlight: true,
    features: [
      { label: 'Everything in Personal' },
      { label: 'Shared vaults & team keys', strong: true },
      { label: 'Granular permissions + client portals', strong: true },
      { label: 'Audit log & activity export' },
      { label: 'Centralised billing, 1 invoice' },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    priceMonthly: 12,
    priceYearly: 115,
    seat: '/ user · month',
    note: 'Regulated industries & larger teams.',
    storage: '5 TB / seat · pooled',
    cta: 'Talk to sales',
    ctaVariant: 'default',
    features: [
      { label: 'Everything in Team' },
      { label: 'SSO · SAML · SCIM', strong: true },
      { label: 'Compliance dashboard (NIS2, DORA)', strong: true },
      { label: 'Signed DPA + data residency choice' },
      { label: 'Priority support · 4h response' },
    ],
  },
]

const trustPoints: [string, string, string][] = [
  ['shield', 'All plans E2E encrypted', 'AES-256-GCM · keys never leave your device'],
  ['cloud', 'EU-only infrastructure', 'Your choice: FRA · AMS · PAR'],
  ['users', '30-day refund', 'No questions, no retention calls'],
  ['key', 'Open-source client apps', 'Audit the code · GitHub'],
]

function PlanCard({
  plan,
  cycle,
  onSelect,
}: {
  plan: PlanDef
  cycle: BillingCycle
  onSelect: (id: string) => void
}) {
  const price = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly
  const displayPrice = cycle === 'yearly' && plan.priceYearly > 0
    ? `€${Math.round(plan.priceYearly / 12)}`
    : `€${price}`

  return (
    <div
      className={`flex flex-col gap-3.5 p-[22px] rounded-lg border relative overflow-visible ${
        plan.highlight
          ? 'border-amber bg-gradient-to-b from-amber-bg to-paper shadow-3'
          : 'border-line-2 bg-paper shadow-1'
      }`}
    >
      {plan.highlight && (
        <span className="absolute -top-2.5 left-[22px] px-2.5 py-[3px] rounded-full bg-ink text-amber font-mono text-[10px] tracking-wider uppercase font-semibold">
          Most popular
        </span>
      )}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
          {plan.name}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[30px] font-bold tracking-tight">{displayPrice}</span>
          {plan.seat && (
            <span className="font-mono text-[11px] text-ink-3">{plan.seat}</span>
          )}
        </div>
        <div className="text-[11px] text-ink-3 mt-0.5">{plan.note}</div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-line bg-paper-2">
        <Icon name="cloud" size={13} className="text-amber-deep" />
        <span className="font-mono text-xs font-medium">{plan.storage}</span>
      </div>

      <div className="flex flex-col gap-[7px]">
        {plan.features.map((f, i) => (
          <div key={i} className="flex gap-2 items-start text-[12.5px] text-ink-2">
            <Icon
              name="check"
              size={11}
              className={f.strong ? 'text-amber-deep mt-0.5 shrink-0' : 'text-green mt-0.5 shrink-0'}
            />
            <span className={f.strong ? 'font-medium' : ''}>{f.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-1">
        <BBButton
          variant={plan.ctaVariant}
          size="lg"
          className="w-full justify-center"
          onClick={() => onSelect(plan.id)}
        >
          {plan.cta}
        </BBButton>
      </div>
    </div>
  )
}

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const navigate = useNavigate()
  const { showToast } = useToast()
  const isLoggedIn = !!getToken()

  async function handleSelect(planId: string) {
    if (planId === 'free') {
      navigate(isLoggedIn ? '/' : '/signup')
      return
    }
    if (!isLoggedIn) {
      navigate(`/signup?plan=${planId}&cycle=${cycle}`)
      return
    }
    try {
      const { url } = await createCheckoutSession({
        plan: planId,
        billing_cycle: cycle,
        region: 'frankfurt',
      })
      window.location.href = url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Checkout failed',
        description: err instanceof Error ? err.message : 'Could not start checkout',
        danger: true,
      })
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-start justify-center py-16 px-lg">
      <div className="w-full max-w-[1180px] border border-line-2 rounded-xl shadow-2 bg-paper overflow-hidden">
        {/* Header */}
        <div className="px-9 pt-8 pb-5 text-center border-b border-line bg-paper">
          <div className="flex items-center gap-2.5 justify-center mb-3.5">
            <BBChip variant="amber">
              <Icon name="shield" size={10} className="mr-1" />
              Zero-knowledge
            </BBChip>
            <BBChip>Priced in EUR, billed in EUR</BBChip>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Honest storage, priced honestly.
          </h1>
          <p className="text-sm text-ink-3 max-w-[640px] mx-auto">
            No per-feature upsells, no data mined to subsidise the cheap tier, no EU-wash.
            Every plan is end-to-end encrypted and stored on EU soil.
          </p>

          {/* Cycle toggle */}
          <div className="inline-flex mt-[18px] p-[3px] bg-paper-2 border border-line rounded-full">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-all ${
                cycle === 'monthly'
                  ? 'bg-paper shadow-1 text-ink'
                  : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle('yearly')}
              className={`px-3.5 py-1.5 rounded-full text-[12.5px] flex items-center gap-1.5 transition-all ${
                cycle === 'yearly'
                  ? 'bg-paper shadow-1 text-ink font-semibold'
                  : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              Yearly
              <BBChip variant="amber">Save 20%</BBChip>
            </button>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 p-7 bg-paper-2">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} cycle={cycle} onSelect={handleSelect} />
          ))}
        </div>

        {/* Trust strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 px-9 py-[18px] border-t border-line bg-paper">
          {trustPoints.map(([ico, title, sub], i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <div className="w-6 h-6 shrink-0 rounded-md bg-amber-bg text-amber-deep flex items-center justify-center">
                <Icon name={ico as 'shield' | 'cloud' | 'users' | 'key'} size={12} />
              </div>
              <div>
                <div className="text-[12.5px] font-semibold">{title}</div>
                <div className="text-[11px] text-ink-3">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
