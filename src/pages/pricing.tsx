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
      { label: 'Web, desktop & mobile apps' },
      { label: 'Community support' },
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
      { label: '30-day version history' },
      { label: 'Priority email support' },
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
      { label: '90-day version history' },
      { label: 'Priority support · 24h response' },
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
      { label: 'Unlimited version history' },
      { label: 'Custom data retention policies' },
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

interface FaqItem {
  q: string
  a: string
}

const faqItems: FaqItem[] = [
  {
    q: 'What does "zero-knowledge" actually mean?',
    a: 'Your files are encrypted on your device before they leave it. We never see your encryption keys, your passwords, or your data. Even if compelled by law, we can only hand over encrypted blobs that are useless without your key.',
  },
  {
    q: 'Can I switch plans or cancel at any time?',
    a: 'Yes. Upgrades take effect immediately with pro-rated billing. Downgrades apply at the end of your current period. Cancel anytime from Settings — no retention calls, no dark patterns. We will issue a refund within 30 days of any new billing cycle, no questions asked.',
  },
  {
    q: 'What happens to my files if I downgrade?',
    a: 'Your files stay encrypted and accessible. If you exceed the storage limit of your new plan, you can still download everything — you just cannot upload new files until you are under the limit.',
  },
  {
    q: 'Where exactly is my data stored?',
    a: 'You choose your region at signup: Frankfurt (Hetzner), Amsterdam (Leaseweb), or Paris (Scaleway). Your data never leaves that region. All operators are EU-incorporated with no US subsidiaries.',
  },
  {
    q: 'Do you support SEPA, cards, and invoicing?',
    a: 'We support SEPA Direct Debit, Visa, Mastercard, and invoice billing for Business plans. All prices are in EUR, billed in EUR — no currency conversion surprises. VAT is handled automatically with reverse charge for EU businesses.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Every paid plan includes a 14-day free trial. No credit card required to start. You will get a reminder before any charge.',
  },
  {
    q: 'What makes Beebeeb different from other encrypted storage?',
    a: 'We are EU-only by design, not by accident. Open-source clients you can audit. No VC-funded growth hacks — we charge a fair price and keep your data private. We are operated by Initlabs B.V. in the Netherlands, registered at the Dutch KvK.',
  },
  {
    q: 'Can I self-host?',
    a: 'Not yet. Our client apps are open-source and auditable, but the server is private. We are considering a self-hosted option for Business plans — if that matters to you, let us know.',
  },
]

function yearlySavings(plan: PlanDef): number {
  if (plan.priceMonthly === 0) return 0
  return plan.priceMonthly * 12 - plan.priceYearly
}

function PlanCard({
  plan,
  cycle,
  onSelect,
}: {
  plan: PlanDef
  cycle: BillingCycle
  onSelect: (id: string) => void
}) {
  const displayPrice =
    cycle === 'yearly' && plan.priceYearly > 0
      ? `€${Math.round(plan.priceYearly / 12)}`
      : `€${plan.priceMonthly}`

  const saved = yearlySavings(plan)

  return (
    <div
      className={`flex flex-col gap-3.5 p-[22px] rounded-lg border relative overflow-visible transition-shadow duration-200 ${
        plan.highlight
          ? 'border-amber bg-gradient-to-b from-amber-bg to-paper shadow-[0_12px_32px_-12px_oklch(0.78_0.17_84_/_0.35)]'
          : 'border-line-2 bg-paper shadow-1 hover:shadow-2'
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
          <span className="text-[32px] font-bold tracking-tight leading-none">
            {displayPrice}
          </span>
          {plan.seat && (
            <span className="font-mono text-[11px] text-ink-3">{plan.seat}</span>
          )}
        </div>
        <div className="text-[11px] text-ink-3 mt-1">{plan.note}</div>
        {cycle === 'yearly' && saved > 0 && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-bg text-amber-deep text-[10px] font-semibold font-mono">
              Save €{saved} / year
            </span>
          </div>
        )}
      </div>

      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-md border ${
          plan.highlight
            ? 'border-line bg-paper'
            : 'border-line bg-paper-2'
        }`}
      >
        <Icon name="cloud" size={13} className="text-amber-deep" />
        <span className="font-mono text-xs font-medium">{plan.storage}</span>
      </div>

      <div className="flex flex-col gap-[7px]">
        {plan.features.map((f, i) => (
          <div key={i} className="flex gap-2 items-start text-[12.5px] text-ink-2">
            <Icon
              name="check"
              size={11}
              className={
                f.strong
                  ? 'text-amber-deep mt-[3px] shrink-0'
                  : 'text-green mt-[3px] shrink-0'
              }
            />
            <span className={f.strong ? 'font-medium' : ''}>{f.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-2">
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

function FaqEntry({
  item,
  open,
  onToggle,
}: {
  item: FaqItem
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 py-4 text-left cursor-pointer group"
      >
        <span className="text-[13.5px] font-semibold text-ink group-hover:text-ink-2 transition-colors">
          {item.q}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={`shrink-0 text-ink-3 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          open ? 'max-h-[300px] pb-4' : 'max-h-0'
        }`}
      >
        <p className="text-[12.5px] text-ink-2 leading-relaxed pr-8">
          {item.a}
        </p>
      </div>
    </div>
  )
}

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
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
      })
      window.location.href = url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Checkout failed',
        description:
          err instanceof Error ? err.message : 'Could not start checkout',
        danger: true,
      })
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-start justify-center py-16 px-lg">
      <div className="w-full max-w-[1180px] flex flex-col gap-8">
        {/* Main pricing card */}
        <div className="border border-line-2 rounded-xl shadow-2 bg-paper overflow-hidden">
          {/* Header */}
          <div className="px-9 pt-9 pb-6 text-center border-b border-line bg-paper">
            <div className="flex items-center gap-2.5 justify-center mb-4">
              <BBChip variant="amber">
                <Icon name="shield" size={10} className="mr-1" />
                Zero-knowledge
              </BBChip>
              <BBChip>Priced in EUR, billed in EUR</BBChip>
            </div>
            <h1 className="text-[28px] sm:text-3xl font-bold tracking-tight mb-2.5">
              Honest storage, priced honestly.
            </h1>
            <p className="text-sm text-ink-3 max-w-[640px] mx-auto leading-relaxed">
              No per-feature upsells, no data mined to subsidise the cheap tier, no EU-wash.
              Every plan is end-to-end encrypted and stored on EU soil.
            </p>

            {/* Cycle toggle */}
            <div className="inline-flex mt-5 p-[3px] bg-paper-2 border border-line rounded-full">
              <button
                onClick={() => setCycle('monthly')}
                className={`px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-all cursor-pointer ${
                  cycle === 'monthly'
                    ? 'bg-paper shadow-1 text-ink'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setCycle('yearly')}
                className={`px-4 py-1.5 rounded-full text-[12.5px] flex items-center gap-1.5 transition-all cursor-pointer ${
                  cycle === 'yearly'
                    ? 'bg-paper shadow-1 text-ink font-semibold'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                Yearly
                <span className="inline-flex items-center px-1.5 py-px rounded-sm bg-amber-bg text-amber-deep text-[10px] font-bold font-mono tracking-wide">
                  -20%
                </span>
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

        {/* FAQ section */}
        <div className="border border-line-2 rounded-xl shadow-1 bg-paper overflow-hidden">
          <div className="px-9 pt-7 pb-2">
            <h2 className="text-lg font-bold tracking-tight mb-1">
              Frequently asked questions
            </h2>
            <p className="text-[12.5px] text-ink-3">
              Can not find your answer? Write to us at{' '}
              <a
                href="mailto:support@beebeeb.io"
                className="text-amber-deep hover:underline font-medium"
              >
                support@beebeeb.io
              </a>
            </p>
          </div>
          <div className="px-9 pb-7 pt-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12">
              <div>
                {faqItems.slice(0, Math.ceil(faqItems.length / 2)).map((item, i) => (
                  <FaqEntry
                    key={i}
                    item={item}
                    open={openFaq === i}
                    onToggle={() => setOpenFaq(openFaq === i ? null : i)}
                  />
                ))}
              </div>
              <div>
                {faqItems.slice(Math.ceil(faqItems.length / 2)).map((item, i) => {
                  const idx = i + Math.ceil(faqItems.length / 2)
                  return (
                    <FaqEntry
                      key={idx}
                      item={item}
                      open={openFaq === idx}
                      onToggle={() => setOpenFaq(openFaq === idx ? null : idx)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center pb-4">
          <p className="text-[11.5px] text-ink-4">
            All plans include a 14-day free trial. No credit card required.
            Operated by Initlabs B.V., Wijchen, Netherlands.
          </p>
        </div>
      </div>
    </div>
  )
}
