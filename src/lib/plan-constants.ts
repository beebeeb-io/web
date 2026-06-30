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

// Storage add-on rate — €10.99/TB, unchanged across pricing v2. Pro's base is
// 1 TB at €10.99 and each extra TB adds €10.99, so the per-TB rate is flat.
// (Mirrors core's STORAGE_ADDON_CENTS_PER_TB = 1099; the WASM bridge is the
// source of truth for charged amounts — this is the display copy.)
export const STORAGE_ADDON_EUR_PER_TB = 10.99

// Seat add-on rate — €4.99/user beyond the 2 seats Teams includes.
// (Mirrors core's USER_ADDON_CENTS = 499.)
export const USER_ADDON_EUR_PER_SEAT = 4.99

const PLANS: { [K in 'free' | 'starter' | 'basic' | 'pro' | 'business']: PlanMeta } = {
  // Free is REMOVED as a marketed plan (pricing v2). It stays here only as the
  // internal lapsed/zero/fallback state — never surfaced on marketed surfaces
  // (see MARKETED_PLAN_SLUGS). Do not add it back to the pricing grid.
  free: {
    label: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    storageGB: 5,
    tagline: 'Get started with encrypted storage',
    features: ['Encrypted storage', 'Photo library'],
  },
  // Starter (slug `starter`) — NEW entry tier (pricing v2, 2026-06-30). 100 GB
  // at €1.99 incl VAT, annual €19.90, 14-day trial, no add-ons. Numbers mirror
  // core @ f205507 (Plan::Starter => 199 cents, STARTER_QUOTA = 100 GB).
  starter: {
    label: 'Starter',
    priceMonthly: 1.99,
    priceYearly: 19.90,
    storageGB: 100,
    tagline: '100 GB of truly private storage',
    features: ['100 GB encrypted storage', '30-day version history', '14-day free trial'],
  },
  basic: {
    label: 'Basic',
    priceMonthly: 3.99,
    priceYearly: 39.90,
    storageGB: 200,
    tagline: '200 GB of truly private storage',
    features: ['200 GB encrypted storage', '30-day version history', '14-day free trial'],
  },
  pro: {
    label: 'Pro',
    priceMonthly: 10.99,
    priceYearly: 109.90,
    storageGB: 1000,
    tagline: '1 TB base, expandable to 99 TB',
    features: ['Everything in Basic', '1 TB encrypted storage', 'Add storage at €10.99/TB', 'Unlimited version history', 'Advanced sharing controls', '14-day free trial'],
  },
  // Teams (internal slug `business`) is the MARKETED 4th tier, shown as a
  // COMING SOON card (Guus 2026-06-30): visible in the lineup but NOT
  // purchasable yet — the public checkout path rejects `business` (server task
  // 1050) and the UI renders a coming-soon badge + non-checkout CTA instead.
  // €54.95/mo, 5 TB base + 2 seats included, +€10.99/TB, +€4.99/user beyond 2.
  // Slug stays `business` (no migration; no users). Numbers mirror core @ f205507.
  business: {
    label: 'Teams',
    priceMonthly: 54.95,
    priceYearly: 549.50,
    storageGB: 5000,
    tagline: '5 TB with 2 seats — collaborate privately',
    comingSoon: true,
    features: [
      'Everything in Pro',
      '5 TB encrypted storage',
      '2 users included',
      'Add storage at €10.99/TB',
      'Add seats at €4.99/user',
    ],
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
  starter: 0.5,
  basic: 1,
  personal: 1, // legacy alias
  team: 1.5,
  pro: 2,
  business: 3,
  data_hoarder: 3, // legacy alias
}

// ── Canonical plan slugs (non-legacy, in tier order) ─────────────────────────

export const CANONICAL_PLAN_SLUGS = ['free', 'starter', 'basic', 'pro', 'business'] as const
export type CanonicalPlanSlug = (typeof CANONICAL_PLAN_SLUGS)[number]

export const CANONICAL_PAID_PLAN_SLUGS = ['starter', 'basic', 'pro', 'business'] as const

// ── Marketed plan slugs ──────────────────────────────────────────────────────
// Pricing v2: the tiers we advertise, left→right. Free is removed as a marketed
// plan (internal fallback only). Starter (slug `starter`) is the new €1.99 entry
// tier; Teams (slug `business`) is shown as a COMING SOON 4th card — visible but
// not purchasable (see PLANS.business.comingSoon). Every marketed surface
// (pricing page, plan comparison, tier picker) iterates THIS list;
// CANONICAL_PLAN_SLUGS stays full for internal resolution.
export const MARKETED_PLAN_SLUGS = ['starter', 'basic', 'pro', 'business'] as const
export type MarketedPlanSlug = (typeof MARKETED_PLAN_SLUGS)[number]

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
  free: 'starter',
  starter: 'basic',
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
    id: 'starter',
    name: PLANS.starter.label,
    priceMonthly: PLANS.starter.priceMonthly,
    priceYearly: Math.round((PLANS.starter.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: '100 GB · 14-day free trial',
    storage: '100 GB',
    cta: 'Start 14-day trial',
    ctaVariant: 'default',
    features: [
      { label: '100 GB encrypted storage', strong: true },
      { label: 'E2E encryption · zero-knowledge' },
      { label: 'Photo library backup' },
      { label: 'Recovery via trusted contact' },
      { label: 'EU jurisdiction of choice' },
      { label: '30-day version history' },
      { label: 'Email support' },
    ],
  },
  {
    id: 'basic',
    name: PLANS.basic.label,
    priceMonthly: PLANS.basic.priceMonthly,
    priceYearly: Math.round((PLANS.basic.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: '200 GB · 14-day free trial',
    storage: '200 GB',
    cta: 'Start 14-day trial',
    ctaVariant: 'default',
    features: [
      { label: '200 GB encrypted storage', strong: true },
      { label: 'E2E encryption · zero-knowledge' },
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
    // Pro is a 1 TB base; storage is add-on driven at a FLAT €10.99/TB (not
    // base/5 — pricing v2 dropped the 5 TB base). The base TB equals the base
    // price, so per-TB = the add-on rate.
    note: `1 TB base · +€${STORAGE_ADDON_EUR_PER_TB}/TB`,
    storage: '1 TB',
    perTb: `+€${STORAGE_ADDON_EUR_PER_TB}/TB`,
    cta: 'Start 14-day trial',
    ctaVariant: 'amber',
    highlight: true,
    features: [
      { label: 'Everything in Basic' },
      { label: '1 TB encrypted storage', strong: true },
      { label: 'Add storage at €10.99/TB → 99 TB', strong: true },
      { label: 'Unlimited version history', strong: true },
      { label: 'Desktop sync · CLI access' },
      { label: 'Shared folders' },
      { label: 'Priority support · 24h response' },
    ],
  },
  // Teams (slug `business`) — visible 4th tier but COMING SOON: shown with a
  // "Coming soon" badge and a non-checkout "Notify me" CTA. Not purchasable yet
  // (server rejects `business` at checkout — task 1050). 5 TB base, 2 seats
  // included, €54.95/mo. Storage add-on €10.99/TB, seat add-on €4.99/user.
  {
    id: 'business',
    name: PLANS.business.label,
    priceMonthly: PLANS.business.priceMonthly,
    priceYearly: Math.round((PLANS.business.priceYearly / 12) * 100) / 100,
    seat: '/ month',
    note: '5 TB · 2 seats included',
    storage: '5 TB',
    perTb: `+€${STORAGE_ADDON_EUR_PER_TB}/TB`,
    cta: 'Notify me',
    ctaVariant: 'ghost',
    comingSoon: true,
    badge: 'Coming soon',
    features: [
      { label: 'Everything in Pro' },
      { label: '5 TB encrypted storage', strong: true },
      { label: '2 users included', strong: true },
      { label: `Add storage at €${STORAGE_ADDON_EUR_PER_TB}/TB` },
      { label: `Add seats at €${USER_ADDON_EUR_PER_SEAT}/user` },
      { label: 'Shared folders · team management' },
    ],
  },
]
