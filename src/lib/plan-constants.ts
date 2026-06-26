/**
 * Plan constants — single source of truth for plan metadata, pricing, and ordering.
 *
 * Every file that needs plan labels, prices, storage amounts, or tier ordering
 * should import from here instead of defining its own copies.
 */

// ── Core plan metadata ───────────────────────────────────────────────────────

export interface PlanMeta {
  label: string
  priceMonthly: number
  priceYearly: number
  /** Base storage in GB */
  storageGB: number
  tagline: string
  features: string[]
  comingSoon?: boolean
}

const PLANS: { [K in 'free' | 'basic' | 'pro' | 'business']: PlanMeta } = {
  free: {
    label: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    storageGB: 5,
    tagline: 'Get started with encrypted storage',
    features: ['Encrypted storage', 'Photo library'],
  },
  basic: {
    label: 'Basic',
    priceMonthly: 10.99,
    priceYearly: 109.90,
    storageGB: 1000,
    tagline: '1 TB of truly private storage',
    features: ['Everything in Free', '30-day version history'],
  },
  pro: {
    label: 'Pro',
    priceMonthly: 54.95,
    priceYearly: 549.50,
    storageGB: 5000,
    tagline: '5 TB for power users and creators',
    features: ['Everything in Basic', '5 TB encrypted storage', 'Unlimited version history', 'Advanced sharing controls'],
  },
  business: {
    label: 'Business',
    priceMonthly: 109.90,
    priceYearly: 1099.00,
    storageGB: 10000,
    tagline: '10 TB for teams and heavy storage',
    features: ['Everything in Pro', '10 TB encrypted storage'],
    comingSoon: true,
  },
}

// ── Legacy aliases ───────────────────────────────────────────────────────────
// Old plan slugs that map to current plans.

const LEGACY_ALIASES: Record<string, PlanMeta> = {
  personal: { ...PLANS.basic },
  data_hoarder: { ...PLANS.business },
  team: {
    label: 'Team',
    priceMonthly: 6,
    priceYearly: 58,
    storageGB: 2000,
    tagline: 'Legacy team plan',
    features: ['Legacy team storage'],
  },
}

/**
 * Full plan metadata lookup including legacy aliases.
 * Use this when you need to resolve an arbitrary plan slug to its metadata.
 */
export const PLAN_META: Record<string, PlanMeta> = {
  ...PLANS,
  ...LEGACY_ALIASES,
}

// ── Plan rank ordering ───────────────────────────────────────────────────────
// Numeric rank for comparing plan tiers. Higher = more premium.

export const PLAN_RANK: Record<string, number> = {
  free: 0,
  basic: 1,
  personal: 1, // legacy alias
  team: 1.5,
  pro: 2,
  business: 3,
  data_hoarder: 3, // legacy alias
}

// ── Canonical plan slugs (non-legacy, in tier order) ─────────────────────────

export const CANONICAL_PLAN_SLUGS = ['free', 'basic', 'pro', 'business'] as const
export type CanonicalPlanSlug = (typeof CANONICAL_PLAN_SLUGS)[number]

export const CANONICAL_PAID_PLAN_SLUGS = ['basic', 'pro', 'business'] as const

export function isDowngrade(from: string, to: string): boolean {
  const fromRank = PLAN_RANK[from] ?? 0
  const toRank = PLAN_RANK[to] ?? 0
  return toRank < fromRank && toRank > 0
}

export function getDowngradeOptions(currentPlan: string): string[] {
  const currentRank = PLAN_RANK[currentPlan] ?? 0
  return CANONICAL_PAID_PLAN_SLUGS.filter(
    (slug) => (PLAN_RANK[slug] ?? 0) < currentRank && (PLAN_RANK[slug] ?? 0) > 0
  )
}

// ── Upgrade chain ────────────────────────────────────────────────────────────
// Maps a plan slug to the next tier up. Absent = no upgrade available.

export const UPGRADE_CHAIN: Record<string, string> = {
  free: 'basic',
  basic: 'pro',
  personal: 'pro', // legacy alias
}

// ── Plan labels and formatted prices (for simple display) ────────────────────

export const PLAN_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PLAN_META).map(([slug, meta]) => [slug, meta.label]),
)

/**
 * Pre-formatted monthly price strings for display (e.g. "EUR 10.99").
 * Business shows "Coming soon" instead of a price.
 */
export const PLAN_PRICE_LABELS: Record<string, string> = Object.fromEntries(
  CANONICAL_PLAN_SLUGS.map((slug) => {
    const meta = PLANS[slug]
    if (meta.comingSoon) return [slug, 'Coming soon']
    if (meta.priceMonthly === 0) return [slug, 'EUR 0']
    return [slug, `EUR ${meta.priceMonthly % 1 === 0 ? meta.priceMonthly.toFixed(0) : meta.priceMonthly.toFixed(2)}`]
  }),
)

// ── Pricing page plan definitions ────────────────────────────────────────────
// Extended plan shape used by the pricing page with display-specific fields.

export interface PricingPlanDef {
  id: string
  name: string
  priceMonthly: number
  /** Monthly equivalent price when billed yearly (annual total / 12) */
  priceYearly: number
  seat: string | null
  note: string
  storage: string
  perTb?: string
  cta: string
  ctaVariant: 'amber' | 'default' | 'ghost'
  highlight?: boolean
  badge?: string
  comingSoon?: boolean
  features: { label: string; strong?: boolean }[]
}

/**
 * Pricing page plan cards with display-specific metadata.
 * Core prices and storage derive from PLAN_META; display fields (cta, features
 * with strong markers, highlight, badge) are pricing-page-specific.
 */
export const PRICING_PAGE_PLANS: PricingPlanDef[] = [
  {
    id: 'free',
    name: PLANS.free.label,
    priceMonthly: PLANS.free.priceMonthly,
    priceYearly: PLANS.free.priceYearly,
    seat: null,
    note: 'Forever. No card needed.',
    storage: '5 GB',
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
    id: 'basic',
    name: PLANS.basic.label,
    priceMonthly: PLANS.basic.priceMonthly,
    priceYearly: Math.round((PLANS.basic.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: `1 TB · €${PLANS.basic.priceMonthly}/TB`,
    storage: '1 TB',
    perTb: `€${PLANS.basic.priceMonthly}/TB`,
    cta: 'Subscribe',
    ctaVariant: 'default',
    features: [
      { label: 'Everything in Free' },
      { label: '1 TB encrypted storage', strong: true },
      { label: 'Photo library backup' },
      { label: 'Recovery via trusted contact' },
      { label: 'EU jurisdiction of choice' },
      { label: '30-day version history' },
      { label: 'Priority email support' },
    ],
  },
  {
    id: 'pro',
    name: PLANS.pro.label,
    priceMonthly: PLANS.pro.priceMonthly,
    priceYearly: Math.round((PLANS.pro.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: `5 TB · €${PLANS.pro.priceMonthly / 5}/TB`,
    storage: '5 TB',
    perTb: `€${PLANS.pro.priceMonthly / 5}/TB`,
    cta: 'Subscribe',
    ctaVariant: 'amber',
    highlight: true,
    features: [
      { label: 'Everything in Basic' },
      { label: '5 TB encrypted storage', strong: true },
      { label: 'Unlimited version history', strong: true },
      { label: 'Desktop sync · CLI access' },
      { label: 'Shared folders' },
      { label: 'Priority support · 24h response' },
    ],
  },
  {
    id: 'business',
    name: PLANS.business.label,
    priceMonthly: PLANS.business.priceMonthly,
    priceYearly: Math.round((PLANS.business.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: '10 TB · coming soon',
    storage: '10 TB',
    perTb: `€${PLANS.business.priceMonthly / 10}/TB`,
    cta: 'Coming soon',
    ctaVariant: 'ghost',
    badge: 'Coming soon',
    comingSoon: true,
    features: [
      { label: 'Everything in Pro' },
      { label: '10 TB encrypted storage', strong: true },
      { label: 'Team management', strong: true },
      { label: 'Dedicated support channel' },
      { label: 'Custom data retention policies' },
      { label: 'Priority egress bandwidth' },
    ],
  },
]
