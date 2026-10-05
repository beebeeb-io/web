/**
 * Coupon links (task 1814, slice A: free grants). A link `/c/<code>` gives one plan
 * away for a set time, free. This file is the pure part: code handling, the copy,
 * and the held-coupon bridge across signup. No React, so `bun test` pins it.
 *
 * Honest by construction: the copy states what the server enforces (no card, nothing
 * charged, read-only for 60 days afterwards, a reminder at 14, 7 and 1 days) and the
 * typed refusals say what happened without implying more.
 */

/** The held coupon survives the multi-step signup in this tab only. */
export const COUPON_HOLD_KEY = 'bb.coupon'

/** A pasted or typed coupon code: the grouped display form, any case, stray spaces. */
export function normalizeCouponCode(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
  return /^[A-Z0-9_-]{3,64}$/.test(t) ? t : null
}

/** The path of a coupon link, grouped like the link an admin hands out. */
export function couponPath(code: string): string {
  return `/c/${encodeURIComponent(code)}`
}

/** Is `pathname` a coupon link? (Post-login redirects honour exactly this shape.) */
export function isCouponPath(pathname: string): boolean {
  return /^\/c\/[A-Za-z0-9_-]{3,64}$/.test(pathname)
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function store(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function holdCoupon(code: string, s: StorageLike | null = store()): void {
  const n = normalizeCouponCode(code)
  if (!n) return
  try {
    s?.setItem(COUPON_HOLD_KEY, n)
  } catch {
    /* storage blocked: the person can still open the link again after signing up */
  }
}

export function readHeldCoupon(s: StorageLike | null = store()): string | null {
  try {
    return normalizeCouponCode(s?.getItem(COUPON_HOLD_KEY))
  } catch {
    return null
  }
}

export function clearHeldCoupon(s: StorageLike | null = store()): void {
  try {
    s?.removeItem(COUPON_HOLD_KEY)
  } catch {
    /* ignore */
  }
}

// ── What the public lookup and the redeem endpoint return ───────────────────

export interface CouponPitch {
  valid: true
  plan: string
  plan_label: string
  storage_bytes: number
  duration_months: number
  price_cents: number
  currency: string
  expires_at: string | null
  read_only_days: number
}

export interface CouponRedeemed {
  redeemed: true
  already_redeemed: boolean
  status: string
  plan: string
  plan_label: string
  duration_months: number
  price_cents: number
  ends_at: string
  message: string
}

/** The pitch, or null for `{valid:false}` and anything that is not a pitch. */
export function parsePitch(raw: unknown): CouponPitch | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.valid !== true) return null
  if (typeof r.plan !== 'string' || typeof r.plan_label !== 'string') return null
  const months = r.duration_months
  if (typeof months !== 'number' || !Number.isInteger(months) || months < 1) return null
  return {
    valid: true,
    plan: r.plan,
    plan_label: r.plan_label,
    storage_bytes: typeof r.storage_bytes === 'number' ? r.storage_bytes : 0,
    duration_months: months,
    price_cents: typeof r.price_cents === 'number' ? r.price_cents : 0,
    currency: typeof r.currency === 'string' ? r.currency : 'EUR',
    expires_at: typeof r.expires_at === 'string' ? r.expires_at : null,
    read_only_days: typeof r.read_only_days === 'number' ? r.read_only_days : 60,
  }
}

// ── Copy ────────────────────────────────────────────────────────────────────

export function monthsLabel(months: number): string {
  return `${months} month${months === 1 ? '' : 's'}`
}

/** "Pro for 3 months, free". Slice A is free only; a priced coupon is slice B. */
export function pitchHeadline(p: Pick<CouponPitch, 'plan_label' | 'duration_months'>): string {
  return `${p.plan_label} for ${monthsLabel(p.duration_months)}, free`
}

/** Decimal SI, like the rest of the product ("1 TB", "200 GB"). */
export function storageLabel(bytes: number): string {
  if (bytes >= 1_000_000_000_000) {
    const tb = bytes / 1_000_000_000_000
    return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`
  }
  return `${Math.round(bytes / 1_000_000_000)} GB`
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** The terms, one honest line each. The server enforces every one of them. */
export function pitchTerms(p: CouponPitch): { id: string; label: string; text: string }[] {
  const terms = [
    {
      id: 'get',
      label: 'What you get',
      text: p.storage_bytes > 0 ? `${p.plan_label}, ${storageLabel(p.storage_bytes)}, end-to-end encrypted.` : `${p.plan_label}, end-to-end encrypted.`,
    },
    {
      id: 'for',
      label: 'For how long',
      text: `${monthsLabel(p.duration_months)}, counted from the day you claim it.`,
    },
    {
      id: 'cost',
      label: 'What it costs',
      text: 'Nothing. We do not ask for a card, so nothing can be charged.',
    },
    {
      id: 'after',
      label: 'When it ends',
      text:
        `Your vault becomes read-only. You can still open and download everything for ${p.read_only_days} days, ` +
        'and you can subscribe to keep writing. Nothing renews by itself. We email you 14, 7 and 1 days before.',
    },
  ]
  if (p.expires_at) {
    terms.push({ id: 'valid', label: 'This link works until', text: formatDay(p.expires_at) })
  }
  return terms
}

export interface RefusalCopy {
  title: string
  body: string
  /** What the page offers next. */
  action: 'drive' | 'choose_plan' | 'verify_email' | 'retry'
}

/**
 * The refusal for a failed redeem. `code` is the server's typed error. The body never
 * claims more than the code says (an unknown, a revoked and an expired link are one
 * answer on the wire, so they are one answer here).
 */
export function refusalCopy(code: string | undefined, status: number | undefined): RefusalCopy {
  switch (code) {
    case 'coupon_not_applicable':
      return {
        title: 'You already have a plan',
        body: 'A coupon cannot replace a plan you already hold, so nothing was changed.',
        action: 'drive',
      }
    case 'coupon_already_used':
      return {
        title: 'This coupon has already been used',
        body: 'A coupon can be used once per email address, and this address has used it.',
        action: 'choose_plan',
      }
    case 'coupon_unavailable':
      return {
        title: 'This link does not work any more',
        body: 'It may have expired, been used up or been turned off. Ask whoever sent it for a new one.',
        action: 'choose_plan',
      }
    case 'email_unverified':
      return {
        title: 'Verify your email first',
        body: 'Open the link we emailed you, then come back to this page and claim your coupon.',
        action: 'verify_email',
      }
    default:
      if (status === 429) {
        return { title: 'Too many attempts', body: 'Wait a minute, then try again.', action: 'retry' }
      }
      return {
        title: 'We could not claim this coupon',
        body: 'Nothing was changed. Try again in a moment.',
        action: 'retry',
      }
  }
}

/** After a successful claim. */
export function claimedCopy(r: Pick<CouponRedeemed, 'plan_label' | 'duration_months' | 'ends_at' | 'already_redeemed'>): {
  title: string
  body: string
} {
  return {
    title: r.already_redeemed ? `You already have ${r.plan_label}` : `${r.plan_label} is yours`,
    body:
      `Free for ${monthsLabel(r.duration_months)}, until ${formatDay(r.ends_at)}. ` +
      'No card is on file and nothing will be charged. We email you before it ends.',
  }
}

/**
 * Does the account hold a plan a coupon must not replace? Only a paid plan counts: no
 * plan, a lapsed plan, the internal `none` and legacy Free can all redeem (the server
 * decides for real and answers `coupon_not_applicable` otherwise).
 */
export function holdsNoPlan(accountState: string, plan: string | null | undefined): boolean {
  if (accountState === 'needs_plan' || accountState === 'lapsed') return true
  return !plan || plan === 'none' || plan === 'free'
}

/**
 * PlanGate hook: an account that holds a coupon and no plan is taken to the coupon page
 * (which claims it or says why it cannot) instead of the plan chooser or the drive.
 * Returns the path, or null when nothing is held or the account already has a plan.
 */
export function heldCouponRedirect(
  accountState: string,
  plan: string | null | undefined,
  held: string | null,
): string | null {
  if (!held || !holdsNoPlan(accountState, plan)) return null
  return `${couponPath(held)}?from=signup`
}

/**
 * What the Settings field accepts: the bare code, the grouped form, or the whole link
 * pasted from a message. Returns the normalised code, or null when nothing in the
 * input looks like one.
 */
export function codeFromInput(raw: string): string | null {
  const t = raw.trim()
  const fromLink = t.match(/\/c\/([A-Za-z0-9_-]{3,64})(?:[/?#].*)?$/)
  return normalizeCouponCode(fromLink ? fromLink[1] : t)
}
