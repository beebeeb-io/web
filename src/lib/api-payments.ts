import { request } from '@beebeeb/shared'
import type { Invoice, Subscription } from '@beebeeb/shared'
import { parsePitch } from './coupon'
import type { CouponPitch, CouponRedeemed } from './coupon'

// ── Promo codes (task 11, spec §4) ───────────────────────────────────────────

/** A usable promo code quoted against a specific plan + billing cycle. */
export interface PromoQuote {
  valid: true
  discount_type: string
  value: number
  duration: string
  duration_cycles: number | null
  first_charge_cents: number
  recurring_cents_during_discount: number
  recurring_cents_after: number
  /** Ready-to-display sentence, e.g. "€4.50/month for 3 months, then €9.00/month". */
  description_schedule: string
}

export type PromoValidation = PromoQuote | { valid: false }

/**
 * `POST /api/v1/billing/promo/validate` — public, unauthenticated, IP rate-limited.
 * ALWAYS returns 200. `{valid: false}` covers every failure reason (unknown,
 * expired, exhausted, wrong plan, disabled) by design — no enumeration oracle
 * beyond bare validity, so the caller must not try to distinguish reasons.
 */
export async function validatePromo(params: {
  code: string
  plan: string
  billing_cycle: string
}): Promise<PromoValidation> {
  return request<PromoValidation>('/api/v1/billing/promo/validate', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

// ── Coupon links (task 1814, slice A: free grants) ──────────────────────────

/**
 * `GET /api/v1/coupons/{code}` — public, per-IP limited. A usable coupon returns the
 * pitch; EVERY other case (unknown, revoked, expired, used up, garbage) is
 * `200 {valid: false}`, so the caller cannot and must not tell them apart.
 */
export async function getCoupon(code: string): Promise<CouponPitch | null> {
  return parsePitch(await request<unknown>(`/api/v1/coupons/${encodeURIComponent(code)}`))
}

/**
 * `POST /api/v1/billing/coupon/redeem` — signed in. Typed refusals arrive as
 * `ApiError.code`: `coupon_not_applicable` (409), `coupon_already_used` (409),
 * `coupon_unavailable` (410), `email_unverified` (403). A replay by the same account
 * is a 200 with `already_redeemed: true`.
 */
export async function redeemCoupon(code: string): Promise<CouponRedeemed> {
  return request<CouponRedeemed>('/api/v1/billing/coupon/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// ── WP-0: payment-method availability engine ────────────────────────────────

/** A payment method offered to the user for a given charge. */
export interface OfferedMethod {
  /** Mollie method id, e.g. "directdebit", "ideal", "paypal". */
  method_id: string
  /** Human-readable display name. */
  display_name: string
  /** Maximum amount this method can collect in cents, or null = unlimited. */
  max_amount_cents: number | null
  /** Whether this method supports recurring charges. */
  recurring: boolean
}

/**
 * Fetch which payment methods are available for a given charge amount.
 *
 * @param amountCents - Gross charge amount in cents.
 * @param sequenceType - "first" (default), "recurring", or "oneoff".
 */
export async function getAvailableMethods(
  amountCents: number,
  sequenceType: 'first' | 'recurring' | 'oneoff' = 'first',
): Promise<OfferedMethod[]> {
  const params = new URLSearchParams({
    amount_cents: String(amountCents),
    sequence_type: sequenceType,
  })
  const data = await request<{ methods: OfferedMethod[] }>(
    `/api/v1/billing/available-methods?${params}`,
  )
  return data.methods
}

export async function getSubscription(): Promise<Subscription> {
  return request<Subscription>('/api/v1/billing/subscription')
}

/**
 * `GET /api/v1/billing/payment/{id}/status` (task 0957, spec §3.3 Component
 * C item 2) — the reconcile-on-load "ask the server for the truth of a
 * checkout" call. `paymentId` is the provider checkout id persisted in the
 * pending-checkout intent (`../lib/pending-checkout.ts`). A synchronous
 * server-side Mollie check (3s timeout, cached 60s per payment) that
 * converges any drift BEFORE the caller re-fetches `getSubscription()` — this
 * is what confirms a payment whose webhook was missed/delayed within the
 * page's own poll window, instead of waiting on the async background
 * reconciler. Callers should treat a failure (older server without this
 * route → 404, or any other error) as "couldn't check right now" and degrade
 * silently to the existing subscription-poll/WS path — never block or fail
 * the page on it.
 */
export interface PaymentStatusResult {
  payment_id: string
  status: 'open' | 'pending' | 'authorized' | 'paid' | 'failed' | 'canceled' | 'expired' | 'unknown'
  converged: boolean
  cached: boolean
  checked: boolean
  timed_out?: boolean
}

export async function getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
  return request<PaymentStatusResult>(`/api/v1/billing/payment/${encodeURIComponent(paymentId)}/status`)
}

export async function subscribe(params: {
  plan: string
  billing_cycle: string
  seats?: number
}): Promise<Subscription> {
  return request<Subscription>('/api/v1/billing/subscribe', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function getInvoices(): Promise<Invoice[]> {
  interface RawInvoice {
    id: string
    number: string
    amount_paid: number
    created: number
    period_start: number
    period_end: number
    status: string
    hosted_invoice_url?: string
    invoice_pdf?: string
  }
  const data = await request<{ invoices: RawInvoice[] }>('/api/v1/billing/invoices')
  return data.invoices.map((raw) => ({
    id: raw.id,
    number: raw.number,
    amount_eur: raw.amount_paid / 100,
    date: new Date(raw.created * 1000).toISOString(),
    period: `${new Date(raw.period_start * 1000).toLocaleDateString()} – ${new Date(raw.period_end * 1000).toLocaleDateString()}`,
    status: raw.status,
    url: raw.hosted_invoice_url,
    pdf_url: raw.invoice_pdf,
  }))
}
