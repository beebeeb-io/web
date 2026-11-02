// ─── API: Storage add-ons ───
// SECTION_MARKER_END
import type { AuditEvent, CreateTokenParams, CreateTokenResponse, CreateWebhookResponse, PersonalAccessToken, ReferralEntry, ReferralStats, Webhook } from './api'
import { request, ApiError } from '@beebeeb/shared'

// ─── Storage add-on endpoints ──────────────────────

export interface StorageAddonState {
  plan: string
  extra_storage_tb: number
  max_storage_tb: number
  storage_addon_price_cents: number | null
  base_storage_tb: number
  effective_storage_bytes: number
  /**
   * Set by the POST /addons apply response when the change was charged off-session
   * to a SEPA Direct Debit mandate (task 0941): the grant is DEFERRED until the
   * mandate settles (a few days). Drives the "upgrade pending" UI. Absent/false for
   * synchronous (credit-card) applies, which grant immediately.
   */
  pending?: boolean
}

/**
 * Task 1706 — shared normalization for GET/POST /billing/addons payloads.
 *
 * `effective_storage_bytes` is the server's bonus-inclusive truth
 * (`get_user_quota` — catalog base + add-on TB + admin bonus). When the field
 * is present it is used as-is; when it is absent we return 0 and let callers
 * fall back to their own server-truth sources. The old tb×1e12 synthesis
 * (total/base+extra → bytes) is DELIBERATELY GONE: it multiplied the stale
 * pre-pricing-v2 whole-TB literals (basic advertised as 1 TB) into a fake
 * quota. Add-on quantities/prices stay authoritative from the same payload;
 * only the byte total must come from the server.
 */
export function normalizeStorageAddonState(
  raw: Record<string, unknown>,
  fallbackExtraTB = 0,
): StorageAddonState {
  const baseTB = typeof raw.base_storage_tb === 'number' ? raw.base_storage_tb : 0
  const extraTB = typeof raw.extra_storage_tb === 'number' ? raw.extra_storage_tb : fallbackExtraTB
  const maxTB = typeof raw.max_storage_tb === 'number' ? raw.max_storage_tb : baseTB + extraTB

  const rawEffective = raw.effective_storage_bytes
  const effectiveBytes =
    typeof rawEffective === 'number' && Number.isFinite(rawEffective) && rawEffective >= 0
      ? rawEffective
      : 0

  return {
    plan: typeof raw.plan === 'string' ? raw.plan : 'free',
    extra_storage_tb: extraTB,
    max_storage_tb: maxTB,
    storage_addon_price_cents: typeof raw.storage_addon_price_cents === 'number' ? raw.storage_addon_price_cents : null,
    base_storage_tb: baseTB,
    effective_storage_bytes: effectiveBytes,
    // SEPA deferred-apply marker (task 0941) — pass-through, task 1706 keeps it.
    pending: raw.pending === true,
  }
}

/** GET /api/v1/billing/addons — current add-on state */
export async function getStorageAddons(): Promise<StorageAddonState | null> {
  try {
    const raw = await request<Record<string, unknown>>('/api/v1/billing/addons')
    return normalizeStorageAddonState(raw)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Preview response for storage add-on changes */
export interface StorageAddonPreview {
  immediate_charge_cents: number
  credit_cents: number
  new_monthly_total_cents: number
  base_plan_cents: number
  extra_storage_cents: number
  extra_storage_tb: number
  remaining_days: number
  is_upgrade: boolean
  requires_payment_method?: boolean
}

/** POST /api/v1/billing/addons/preview — preview proration without modifying */
export async function previewStorageAddons(params: {
  extra_storage_tb: number
}): Promise<StorageAddonPreview> {
  return request<StorageAddonPreview>('/api/v1/billing/addons/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** POST /api/v1/billing/addons — update storage add-on */
export async function updateStorageAddons(params: {
  extra_storage_tb: number
}): Promise<StorageAddonState> {
  const raw = await request<Record<string, unknown>>('/api/v1/billing/addons', {
    method: 'POST',
    body: JSON.stringify(params),
  })

  // Task 1706: same normalization as getStorageAddons — explicit
  // effective_storage_bytes when the server sends it, never a tb×1e12
  // synthesis. (The apply response carries the field server-side.)
  return normalizeStorageAddonState(raw, params.extra_storage_tb)
}

/**
 * Instant-pay storage add-on checkout (task 0941, SEPA two-path). For a SEPA
 * Direct Debit subscriber, charging the mandate settles in a few days; this
 * endpoint instead returns a hosted Mollie redirect for an instant one-off
 * payment that grants the extra storage via webhook on `paid` — it creates NO
 * mandate charge. The caller redirects the browser to `checkout_url`.
 *
 * POST /api/v1/billing/storage-addon/checkout
 *   body { extra_storage_tb, extra_users? } → { checkout_url }
 */
export async function createStorageAddonCheckout(params: {
  extra_storage_tb: number
  extra_users?: number
}): Promise<{ checkout_url: string; payment_id?: string }> {
  return request<{ checkout_url: string; payment_id?: string }>('/api/v1/billing/storage-addon/checkout', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/**
 * Task 1062 (WP-D, decision 5) — settle the dunning arrears in full with a
 * one-off Mollie charge. The server computes the REAL outstanding amount from
 * Mollie's truth (not an estimate) and returns a hosted checkout URL; the
 * caller redirects the browser there. On `paid`, the webhook un-freezes the
 * account (`billing_state` -> `'active'`) — the user returns to a normal,
 * writable account.
 *
 * POST /api/v1/billing/pay-overdue → { checkout_url, arrears_cents }
 */
export async function payOverdue(): Promise<{ checkout_url: string; arrears_cents: number }> {
  return request<{ checkout_url: string; arrears_cents: number }>('/api/v1/billing/pay-overdue', {
    method: 'POST',
  })
}

/**
 * Returns the user's referral code + summary stats.
 * Returns null on 404 — caller falls back to client-side code derivation.
 */
export async function getReferralStats(): Promise<ReferralStats | null> {
  try {
    return await request<ReferralStats>('/api/v1/referrals/stats')
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/**
 * List friends who signed up via the current user's referral link.
 * Returns [] on 404.
 */
export async function listReferrals(): Promise<ReferralEntry[]> {
  try {
    const data = await request<{ referrals: ReferralEntry[] }>('/api/v1/referrals')
    return data.referrals
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

/** List all personal access tokens for the current user. Returns [] on 404 (endpoint not yet deployed). */
export async function listTokens(): Promise<PersonalAccessToken[]> {
  try {
    const data = await request<{ tokens: PersonalAccessToken[] }>('/api/v1/tokens')
    return data.tokens
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

/**
 * Create a new personal access token.
 *
 * Task 1536 (server PR #98): `POST /api/v1/tokens` now requires a fresh
 * `X-Confirm-Token` for SESSION-authenticated callers — this app always
 * authenticates via session (never a bare PAT), so a caller must obtain one
 * via the existing step-up flow (`confirmAction`/`confirmPasskey` above, or
 * the `<StepUpAuth>` component) and pass it here. `confirmToken` stays
 * optional: omitting it sends no header at all, which the CURRENT (pre-#98)
 * server simply ignores — harmless, not a silent bypass of anything #98 has
 * not shipped yet.
 */
export async function createToken(
  params: CreateTokenParams,
  confirmToken?: string,
): Promise<CreateTokenResponse> {
  return request<CreateTokenResponse>('/api/v1/tokens', {
    method: 'POST',
    headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
    // Task 1789: scopes are not enforced and server PR #188 answers 400 to a
    // non-empty list, so only the two supported fields are ever sent.
    body: JSON.stringify({ name: params.name, expires_in_days: params.expires_in_days }),
  })
}

/** Revoke a personal access token by ID. */
export async function revokeToken(id: string): Promise<void> {
  await request(`/api/v1/tokens/${id}`, { method: 'DELETE' })
}

/** List all webhooks. Returns [] on 404 (endpoint not yet deployed). */
export async function listWebhooks(): Promise<Webhook[]> {
  try {
    const data = await request<{ webhooks: Webhook[] }>('/api/v1/webhooks')
    return data.webhooks
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

/** Create a webhook. Returns the config including the signing secret (shown once). */
export async function createWebhook(
  url: string,
  events: string[],
): Promise<CreateWebhookResponse> {
  return request<CreateWebhookResponse>('/api/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, events }),
  })
}

/** Delete / revoke a webhook. */
export async function deleteWebhook(id: string): Promise<void> {
  await request(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
}

/** Send a test event to the webhook endpoint. */
export async function testWebhook(
  id: string,
): Promise<{ success: boolean; status_code?: number }> {
  return request<{ success: boolean; status_code?: number }>(
    `/api/v1/webhooks/${id}/test`,
    { method: 'POST' },
  )
}

/** Re-enable a disabled webhook (clears failure count, sets is_active = true). */
export async function enableWebhook(id: string): Promise<Webhook> {
  return request<Webhook>(`/api/v1/webhooks/${id}/enable`, { method: 'POST' })
}

export async function listAuditLog(params?: {
  actor?: string
  event?: string
  limit?: number
  offset?: number
}): Promise<{ events: AuditEvent[]; total: number; page: number }> {
  const qs = new URLSearchParams()
  if (params?.actor) qs.set('actor', params.actor)
  if (params?.event) qs.set('event', params.event)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return request<{ events: AuditEvent[]; total: number; page: number }>(
    `/api/v1/activity${q ? `?${q}` : ''}`,
  )
}
