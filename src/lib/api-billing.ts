// ─── API: Billing profile + VAT ───
// SECTION_MARKER_END
import { API_URL } from './api'
import type { PaymentMethod } from './api'
import { request, ApiError, getToken } from '@beebeeb/shared'

// ─── Billing profile + VAT (task 0919) ───────────────
// D2 billing data collected before the Mollie redirect. The server runs VIES on
// PUT for B2B + cross-border (country != "NL") VAT numbers and returns the verdict
// in the `vat_validated` STRING field. See docs/billing/compliance/00-build-spec.md §7.

export type CustomerType = 'b2c' | 'b2b'

/**
 * Company registration register, REQUIRED for B2B. The server constrains it to
 * this enum (case-insensitive, stored uppercased) and rejects null for a B2B
 * customer with 400 ("company_registration_type is required for a B2B customer").
 * Mirrors `COMPANY_REG_TYPES` in server billing.rs.
 */
export type CompanyRegistrationType =
  | 'KVK'
  | 'HRB'
  | 'SIREN'
  | 'KBO'
  | 'CVR'
  | 'ORGNR'
  | 'OTHER'

/**
 * VIES verdict the server attaches to a saved billing profile (`vat_validated`).
 * It is a STRING — the server always returns 200 (never 400 for a bad number).
 *   valid          → VIES valid → reverse charge / 0% VAT
 *   invalid        → well-formed but not VIES-registered → inline invalid error
 *   invalid_format → fails the per-country format check → inline invalid error
 *   unreachable    → VIES service down → "charged with local VAT" copy
 *   unchecked      → no VIES run (domestic NL B2B, or no VAT number / B2C)
 */
export type VatState =
  | 'valid'
  | 'invalid'
  | 'invalid_format'
  | 'unreachable'
  | 'unchecked'

/** VAT treatment returned by the engine. Mirrors `vat_engine::resolve_vat`. */
export type VatTreatment =
  | 'domestic'
  | 'oss_destination'
  | 'reverse_charge'
  | 'out_of_scope'
  | 'micro_threshold_home'

/** Editable billing-profile fields (PUT body). B2B fields are optional. */
export interface BillingProfilePayload {
  full_name: string
  billing_country: string // ISO-3166-1 alpha-2
  billing_street: string
  billing_postal: string
  billing_city: string
  customer_type: CustomerType
  company_name?: string | null
  vat_number?: string | null
  company_registration_number?: string | null
  company_registration_type?: CompanyRegistrationType | null
}

/** Billing profile as returned on read — payload plus the VIES verdict string. */
export interface BillingProfile extends BillingProfilePayload {
  vat_validated: VatState
}

/** Normalise a raw `vat_validated` value into a known VatState. */
function normalizeVatState(raw: unknown): VatState {
  switch (raw) {
    case 'valid':
    case 'invalid':
    case 'invalid_format':
    case 'unreachable':
      return raw
    default:
      return 'unchecked'
  }
}

/**
 * GET /api/v1/billing/profile — the current user's billing profile, or an empty
 * shell with the same field names when none has been saved yet. We normalise
 * nulls into the shape the form expects.
 */
export async function getBillingProfile(): Promise<BillingProfile> {
  const raw = await request<Partial<BillingProfile>>('/api/v1/billing/profile')
  return {
    full_name: raw.full_name ?? '',
    billing_country: raw.billing_country ?? '',
    billing_street: raw.billing_street ?? '',
    billing_postal: raw.billing_postal ?? '',
    billing_city: raw.billing_city ?? '',
    customer_type: raw.customer_type === 'b2b' ? 'b2b' : 'b2c',
    company_name: raw.company_name ?? null,
    vat_number: raw.vat_number ?? null,
    company_registration_number: raw.company_registration_number ?? null,
    company_registration_type: raw.company_registration_type ?? null,
    vat_validated: normalizeVatState(raw.vat_validated),
  }
}

/**
 * PUT /api/v1/billing/profile — persist the billing profile BEFORE redirecting
 * to Mollie. The server validates the country, runs VIES for cross-border B2B
 * VAT numbers, and returns the stored profile incl. the `vat_validated` STRING
 * verdict so the caller can reflect reverse-charge / invalid / local-VAT status.
 * The server returns 200 even for an invalid number — the verdict is in the body.
 */
export async function saveBillingProfile(
  payload: BillingProfilePayload,
): Promise<BillingProfile> {
  const raw = await request<Partial<BillingProfile>>('/api/v1/billing/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  // The server echoes the stored row; fall back to the payload for any field it
  // does not return so the form stays consistent.
  return {
    full_name: raw.full_name ?? payload.full_name,
    billing_country: raw.billing_country ?? payload.billing_country,
    billing_street: raw.billing_street ?? payload.billing_street,
    billing_postal: raw.billing_postal ?? payload.billing_postal,
    billing_city: raw.billing_city ?? payload.billing_city,
    customer_type: raw.customer_type === 'b2b' ? 'b2b' : payload.customer_type,
    company_name: raw.company_name ?? payload.company_name ?? null,
    vat_number: raw.vat_number ?? payload.vat_number ?? null,
    company_registration_number:
      raw.company_registration_number ?? payload.company_registration_number ?? null,
    company_registration_type:
      raw.company_registration_type ?? payload.company_registration_type ?? null,
    vat_validated: normalizeVatState(raw.vat_validated),
  }
}

/** Live VAT-inclusive price preview. All amounts are integer cents. */
export interface VatPreview {
  net_cents: number
  vat_rate_bps: number
  vat_amount_cents: number
  gross_cents: number
  treatment: VatTreatment
  /** True when the engine resolved reverse charge — the "btw verlegd / Art. 196"
   *  note applies. Carried through from the server's `reverse_charge_note`. */
  reverse_charge_note: boolean
}

/** Raw vat-preview body as the server sends it: the VAT amount key is
 *  `vat_cents` (NOT `vat_amount_cents`). See server billing.rs. */
interface RawVatPreview {
  net_cents: number
  vat_rate_bps: number
  vat_cents: number
  gross_cents: number
  treatment: VatTreatment
  reverse_charge_note?: boolean
}

/**
 * GET /api/v1/billing/vat-preview — the VAT-inclusive price for a plan/cycle as
 * the user picks country + customer type, BEFORE they commit. `country` + `type`
 * are passed explicitly, so this NEVER previews reverse_charge (that only applies
 * after a profile VIES pass); the conservative D5 default shows destination/home
 * VAT.
 *
 * The server returns the VAT amount under `vat_cents`; we normalise it to
 * `vat_amount_cents` so the UI never reads an undefined key (which rendered the
 * VAT line as EUR 0.00).
 */
export async function getVatPreview(params: {
  plan: string
  cycle: 'monthly' | 'yearly'
  country: string
  type: CustomerType
  quantity?: number
}): Promise<VatPreview> {
  const qs = new URLSearchParams({
    plan: params.plan,
    cycle: params.cycle,
    country: params.country,
    type: params.type,
  })
  if (params.quantity != null) qs.set('quantity', String(params.quantity))
  const raw = await request<RawVatPreview>(`/api/v1/billing/vat-preview?${qs.toString()}`)
  return {
    net_cents: raw.net_cents,
    vat_rate_bps: raw.vat_rate_bps,
    vat_amount_cents: raw.vat_cents,
    gross_cents: raw.gross_cents,
    treatment: raw.treatment,
    reverse_charge_note: raw.reverse_charge_note ?? false,
  }
}

/** A row from GET /api/v1/billing/invoices (Mollie/VAT-compliant invoices). */
export interface BillingInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  amount_gross_cents: number
  amount_net_cents: number
  vat_amount_cents: number
  vat_rate_bps: number
  status: string
  vat_treatment: VatTreatment
  pdf_url: string
}

/** Raw invoice row as the server sends it: the invoice number key is `number`
 *  (NOT `invoice_number`). Other keys (id, *_cents, pdf_url, …) already match. */
interface RawBillingInvoice extends Omit<BillingInvoice, 'invoice_number'> {
  number: string
}

/**
 * GET /api/v1/billing/invoices — the VAT-compliant invoice list backed by the
 * local `invoices` table. Each row carries a `pdf_url` pointing at
 * `/api/v1/billing/invoices/{id}/pdf`.
 *
 * The server returns the invoice number under `number`; we normalise it to
 * `invoice_number` so the list cell, the download aria-label, and the saved PDF
 * filename are populated (they previously read an undefined key → blank/"undefined").
 */
export async function getBillingInvoices(): Promise<BillingInvoice[]> {
  const data = await request<{ invoices: RawBillingInvoice[] }>(
    '/api/v1/billing/invoices',
  )
  return (data.invoices ?? []).map(({ number, ...rest }) => ({
    ...rest,
    invoice_number: number,
  }))
}

/** A row from GET /api/v1/billing/credit-notes (task 1899). Amounts are NEGATIVE
 *  cents: the server surfaces the credit-note sign, the table stores them positive. */
export interface BillingCreditNote {
  id: string
  credit_note_number: string
  credit_note_date: string
  original_invoice_number: string
  reason: string
  currency: string
  amount_gross_cents: number
  amount_net_cents: number
  vat_amount_cents: number
  vat_rate_bps: number
  vat_treatment: VatTreatment
  status: string
}

/** Raw credit-note row as the server sends it (`number`, plus a `pdf_url` we do
 *  not use: the download goes through `downloadCreditNotePdf(id)`). */
export interface RawBillingCreditNote extends Omit<BillingCreditNote, 'credit_note_number'> {
  number: string
  pdf_url?: string
}

/** Normalise the server's credit-note rows (`number` -> `credit_note_number`). */
export function mapBillingCreditNotes(
  raw: { credit_notes?: RawBillingCreditNote[] } | null | undefined,
): BillingCreditNote[] {
  return (raw?.credit_notes ?? []).map(({ number, pdf_url: _pdfUrl, ...rest }) => ({
    ...rest,
    credit_note_number: number,
  }))
}

/** GET /api/v1/billing/credit-notes: the caller's credit notes, newest first. */
export async function getBillingCreditNotes(): Promise<BillingCreditNote[]> {
  return mapBillingCreditNotes(
    await request<{ credit_notes: RawBillingCreditNote[] }>('/api/v1/billing/credit-notes'),
  )
}

/** Download a credit-note PDF. Same authenticated blob pattern as the invoice PDF:
 *  bearer header + cookie, never a token in the URL. */
export async function downloadCreditNotePdf(creditNoteId: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(
    `${API_URL}/api/v1/billing/credit-notes/${creditNoteId}/pdf`,
    { headers, credentials: 'include' },
  )
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

/**
 * Download an invoice PDF (GET /api/v1/billing/invoices/{id}/pdf). The endpoint
 * is authenticated, so we fetch with the bearer token + cookie and hand back a
 * Blob the caller saves — a plain `window.open` would 401.
 */
export async function downloadInvoicePdf(invoiceId: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(
    `${API_URL}/api/v1/billing/invoices/${invoiceId}/pdf`,
    { headers, credentials: 'include' },
  )
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  return res.blob()
}

/**
 * A money movement from GET /api/v1/billing/transactions (task 0936) — the
 * payment-history ledger, SEPARATE from the legal `invoices` documents.
 *
 * `kind: 'payment'` is a charge (positive `amount_gross_cents`); `kind: 'refund'`
 * is a credit note (NEGATIVE amount). `method` is the Mollie payment method
 * (`ideal` / `creditcard` / `directdebit` / …) and is `null` for refunds and for
 * pre-0936 payment rows. `invoice_number` / `invoice_pdf_url` link a payment to
 * its invoice when one exists; refunds carry `credit_note_number` +
 * `original_invoice_number` instead.
 */
export interface BillingTransaction {
  id: string
  kind: 'payment' | 'refund'
  date: string
  status: string
  amount_gross_cents: number
  currency: string
  method: string | null
  description?: string | null
  invoice_id?: string | null
  invoice_number?: string | null
  invoice_pdf_url?: string | null
  credit_note_number?: string
  original_invoice_number?: string
  credit_note_pdf_url?: string
  /** Mollie payment id (`tr_…`) for a payment, or refund id for a refund. */
  reference?: string | null
}

/**
 * GET /api/v1/billing/transactions — the caller's payment history (money
 * movements), newest-first. Distinct from `getBillingInvoices` (legal docs):
 * this lists the actual charges + refunds, with method + status + the linked
 * invoice. AuthUser-scoped server-side.
 */
export async function getBillingTransactions(): Promise<BillingTransaction[]> {
  const data = await request<{ transactions: BillingTransaction[] }>(
    '/api/v1/billing/transactions',
  )
  return data.transactions ?? []
}

/**
 * Download the full payment history as a CSV (task 0942). GET
 * /api/v1/billing/transactions/export returns a `text/csv` attachment; the
 * endpoint is authenticated so a plain `window.open` would 401 — we fetch with
 * the bearer token + cookie, then trigger a browser download of the blob using
 * the server-provided filename (Content-Disposition) when present.
 */
export async function exportBillingTransactions(): Promise<void> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_URL}/api/v1/billing/transactions/export`, {
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }
  // Prefer the server's filename from Content-Disposition; fall back to a sane default.
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'beebeeb-payment-history.csv'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * `{trial: true, ...}` response from `POST /api/v1/billing/checkout` when a
 * 100%-off promo code is applied — the checkout becomes an instant extended
 * trial instead of a Mollie redirect (task 8, spec §4). `message` is a
 * ready-to-display sentence, e.g. "3 months free — no payment needed today."
 */
export interface CheckoutTrialResult {
  trial: true
  id: string
  plan: string
  billing_cycle: string
  status: string
  trial_ends_at: string
  plan_version?: number
  promo_code: string
  message: string
}

export type CheckoutResult = CheckoutSuccess | CheckoutTrialResult

/**
 * The redirect-shaped checkout result. Paid plans get the provider hosted
 * checkout (`payment_id` set). A plan priced €0 (task 1702) comes back
 * `activated: true` instead: the server activated the plan directly, with NO
 * payment provider involved (no Mollie checkout, no subscription create, no
 * mandate). `url` still carries the post-success destination per the checkout
 * contract, so a caller that only redirects keeps working; callers that want
 * honest messaging branch on `activated`. There is no `payment_id` — nothing
 * was charged.
 */
export interface ZeroPriceActivation {
  activated: true
  plan: string
  billing_cycle: string
  status: string
  current_period_end: string
  url: string
  payment_id?: undefined
}

export type CheckoutSuccess = { url: string; payment_id?: string; activated?: false } | ZeroPriceActivation

// Overloaded so existing no-promo call sites (upgrade-dialog, upgrade-nudge-modal)
// keep destructuring `{ url }` unchanged — the trial branch is only reachable
// when a promo_code is actually supplied, so their types stay narrow. Only a
// caller that opts into `promo_code` gets the full `CheckoutResult` union and
// must handle the `{trial: true}` shape.
export async function createCheckoutSession(params: {
  plan: string
  billing_cycle: string
  promo_code?: undefined
}): Promise<CheckoutSuccess>
export async function createCheckoutSession(params: {
  plan: string
  billing_cycle: string
  promo_code: string
}): Promise<CheckoutResult>
export async function createCheckoutSession(params: {
  plan: string
  billing_cycle: string
  /** Task 8 — an applied promo code. Omit/undefined for the unchanged no-discount checkout. */
  promo_code?: string
}): Promise<CheckoutResult> {
  // The server derives the amount from plan + billing_cycle (server-authoritative
  // money); the client never sends a price. All plans are single-user, so there is
  // no seats field — the previous `seats: 1` was a no-op the server ignored.
  return request<CheckoutResult>('/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** Payment method that captures the trial mandate (task 1037). */
export type TrialCheckoutMethod = 'creditcard' | 'ideal'

/**
 * `POST /billing/trial/checkout` result. Paid plans get the Mollie hosted
 * checkout (`payment_id` set, redirect to `url`). A plan priced €0 (task
 * 1702) comes back `activated: true` — the server activated the plan
 * directly, no payment provider involved; `url` keeps the post-success
 * destination and there is no `payment_id`.
 */
export type TrialCheckoutResult =
  | { url: string; payment_id: string; activated?: false }
  | ZeroPriceActivation

/**
 * Start a trial WITH a payment mandate (task 1037 — no free signups).
 *
 * `POST /api/v1/billing/trial/checkout` creates the Mollie mandate payment
 * (card: €0 first payment; iDEAL: €0.01, refunded, creating a SEPA mandate)
 * and returns the hosted-checkout `{url, payment_id}`. Nothing is granted
 * until Mollie reports the payment `paid`; the webhook then flips the
 * subscription to `trialing` with a Mollie subscription starting at
 * `trial_ends_at`. Mollie sends the user back to `/choose-plan?returned=1`.
 *
 * On a 409 the thrown ApiError's `.code`:
 *   - `trial_already_used`            → normal paid checkout (`/billing?view=change`).
 *   - `trial_has_active_subscription` → the account already has a plan.
 * A 400 means an invalid plan/cycle/method, or Mollie is not configured.
 */
export async function startTrialCheckout(params: {
  plan: string
  billing_cycle: 'monthly' | 'yearly'
  method: TrialCheckoutMethod
}, endpoint: string = '/api/v1/billing/trial/checkout'): Promise<TrialCheckoutResult> {
  return request<TrialCheckoutResult>(endpoint, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** `201` body of `POST /billing/trial/start` for a no-card trial (server task 1755). */
export interface NoCardTrialStarted {
  id: string
  plan: string
  billing_cycle: string
  region: string
  status: 'trialing'
  trial_ends_at: string
  plan_version: number | null
  trial_kind: 'no_card'
  /** The limit uploads will actually stop at: min(plan quota, the trial cap). */
  cap_bytes: number
}

/**
 * Start the no-card trial (task 1757, server task 1755; spec 4b.3).
 *
 * `POST <start_endpoint>` where `start_endpoint` is the onboarding document's
 * `offers.trial.start_endpoint` (a same-origin `/api/v1/...` path). The server
 * wants a plan and a billing cycle (the plan whose features the trial shows) and
 * NOTHING about payment: no card, no mandate, no billing profile. The document is
 * the authority on whether a start will be accepted; a refusal is a typed 409/403
 * (`trial_temporarily_unavailable`, `trial_already_used`, `trial_previously_subscribed`,
 * `trial_has_active_subscription`, `email_unverified`) or a 429 when too many
 * trials were started from the same network — see `startTrialErrorCopy`.
 */
export async function startNoCardTrial(params: {
  plan: string
  billing_cycle: 'monthly' | 'yearly'
  endpoint?: string
}): Promise<NoCardTrialStarted> {
  const { endpoint, ...body } = params
  return request<NoCardTrialStarted>(endpoint ?? '/api/v1/billing/trial/start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Convert an active trial to a paid subscription (task 0905, UNIT B).
 *
 * `POST /api/v1/billing/trial/convert` (no body) creates the Mollie €0 first
 * payment (mandate capture) and the deferred subscription (`startDate =
 * trial_ends_at`, no double charge) and returns the Mollie hosted-checkout
 * `{url}` — the caller redirects to it exactly like `createCheckoutSession`,
 * REUSING the 0865 poll-confirmed return machine (set the pending-checkout
 * marker before redirecting).
 *
 * On a 409 the thrown ApiError's `.code` tells the caller where to route:
 *   - `trial_not_active`        → the trial lapsed to Free; send the user to the
 *                                 normal plan picker / checkout, NOT convert.
 *   - `trial_already_subscribed`→ already converted; send to billing management.
 * A 400 means Mollie is not configured server-side.
 */
export async function convertTrial(): Promise<
  { url: string; payment_id?: string; activated?: false } | ZeroPriceActivation
> {
  return request<{ url: string; payment_id?: string; activated?: false } | ZeroPriceActivation>(
    '/api/v1/billing/trial/convert',
    {
      method: 'POST',
    },
  )
}

/**
 * Task 1605 (server PR #129, `POST /billing/trial/pay-now`). Ends a mandated
 * trial's 25 GB cap early by charging the first period NOW on the existing
 * mandate, instead of waiting for the automatic charge at `trial_ends_at`.
 *
 * Two settlement shapes, both 200:
 *   - `{payment_id, status: 'paid', amount_cents}` — a card/instant-method
 *     mandate settled synchronously; the caller can refetch the subscription
 *     immediately (quota unlocks, trial badge drops).
 *   - `{pending: true, payment_id}` — a SEPA/off-session mandate that will
 *     settle over the next few days via webhook; the caller shows a waiting
 *     state and polls `getSubscription()` (see `trial-pay-now.ts`'s bounded
 *     poll helpers) rather than assuming it already worked.
 *
 * 409 `trial_not_active` (the server's own code) means the trial already
 * ended/converted/was cancelled between the button rendering and the click —
 * callers should refetch and show the current state, not retry blindly.
 * Idempotent server-side (per-user advisory lock + local-status-only reuse
 * check) — a double-click here is safe to just re-send; the client ALSO
 * disables the button while a request is in flight as a first line of
 * defense against firing two at once.
 */
export interface TrialPayNowResult {
  payment_id: string
  status?: string
  amount_cents?: number
  pending?: boolean
  /** Task 2092: a hosted checkout, set exactly when `status` is `open`. */
  checkout_url?: string | null
  reused?: boolean
}

export async function payTrialNow(): Promise<TrialPayNowResult> {
  return request<TrialPayNowResult>('/api/v1/billing/trial/pay-now', {
    method: 'POST',
  })
}

export async function getPaymentMethod(): Promise<PaymentMethod> {
  return request<PaymentMethod>('/api/v1/billing/payment-method')
}

/**
 * Start a native payment-method update (task 0925). The server's
 * `/payment-method/update` returns a hosted card re-auth checkout URL; the
 * client just redirects the browser to `url`. It answers 400 "billing not
 * configured" only when no payment provider is configured, and 404 when there
 * is no active subscription.
 */
export async function updatePaymentMethod(): Promise<{ url: string }> {
  return request<{ url: string }>('/api/v1/billing/payment-method/update', { method: 'POST' })
}

export async function cancelSubscription(): Promise<{ message: string; cancel_at?: string }> {
  return request<{ message: string; cancel_at?: string }>('/api/v1/billing/cancel', { method: 'POST' })
}

export async function reactivateSubscription(): Promise<{ message?: string; action?: string; url?: string; payment_id?: string }> {
  return request<{ message: string }>('/api/v1/billing/reactivate', { method: 'POST' })
}

/** POST /api/v1/billing/pause — pause billing for 30, 60, or 90 days (task 0544, B3). */
export async function pauseSubscription(
  duration_days: 30 | 60 | 90,
): Promise<{ message: string; duration_days: number; pause_until: string }> {
  return request('/api/v1/billing/pause', {
    method: 'POST',
    body: JSON.stringify({ duration_days }),
  })
}

/** POST /api/v1/billing/resume — clear pause_collection and restart billing now. */
export async function resumeSubscription(): Promise<{ message: string }> {
  return request('/api/v1/billing/resume', { method: 'POST' })
}

export async function switchBillingCycle(
  billing_cycle: 'monthly' | 'yearly',
): Promise<{ billing_cycle: string; annual_billing_start?: string }> {
  return request<{ billing_cycle: string; annual_billing_start?: string }>(
    '/api/v1/billing/switch-cycle',
    {
      method: 'POST',
      body: JSON.stringify({ billing_cycle }),
    },
  )
}

export async function downgradePlan(params: {
  plan: string
}): Promise<{
  effective_date: string
  current_plan: string
  new_plan: string
}> {
  // Task 1061 (WP-C, decision 2): a downgrade below current usage is now
  // rejected outright (422 `downgrade_blocked_over_quota`) rather than
  // scheduled with a `storage_warning` — the DowngradeDialog pre-computes the
  // over-quota state client-side from props it already has, so a 200 response
  // here is always under-quota by construction.
  return request('/api/v1/billing/downgrade', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function cancelDowngrade(): Promise<{ plan: string; message: string }> {
  return request('/api/v1/billing/downgrade/cancel', { method: 'POST' })
}
