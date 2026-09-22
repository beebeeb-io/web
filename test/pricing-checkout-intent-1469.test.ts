import { describe, expect, test, beforeEach } from 'bun:test'
import type { Subscription } from '@beebeeb/shared'

/**
 * Task 1469 — pricing.tsx's plan-purchase button started a checkout redirect
 * without persisting a pre-checkout intent (spec §3.3 item 1 gap, flagged by
 * lane eng-0957 while landing 0957). `startPlanCheckout` (extracted from
 * `handleSelect` so it's testable without rendering the page) must call
 * `setPendingCheckout` with a COMPLETE pre-state — via the real
 * `makePreState(subscription)` — before returning the redirect URL to the
 * caller, which does `window.location.href = result.url` as its very next
 * statement.
 *
 * Deliberately does NOT `mock.module('../src/lib/api', ...)` — that mock is
 * process-global and collides with every OTHER suite that mocks the same
 * module (test/helpers/upload-share-mocks.ts's doc comment spells out the
 * exact hazard: "last-registered wins, can't relink"; this file's earlier
 * draft actually broke folder-share-crypto/encrypted-upload-v2-contract/
 * account-deleted-copy/core-vectors-kat with `Export named 'X' not found`
 * when run in the same `bun test` process). `startPlanCheckout` instead
 * takes an injectable `checkout` fn (default: the real
 * `createCheckoutSession`) — this test passes a stub directly, no module
 * mocking at all.
 */

// Minimal in-memory localStorage stub — pending-checkout.ts wraps every
// access in try/catch, so a real browser localStorage isn't needed (mirrors
// test/pending-checkout-0957.test.ts's stub exactly).
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

const { startPlanCheckout } = await import('../src/pages/pricing')
const { getPendingCheckout, clearPendingCheckout, makePreState } = await import('../src/lib/pending-checkout')

beforeEach(() => {
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
  clearPendingCheckout()
})

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'basic',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'falkenstein',
    status: 'active',
    created_at: null,
    current_period_end: '2026-10-01T00:00:00Z',
    extra_storage_tb: 1,
    storage_tb_quantity: 1,
    mandate_method: 'creditcard',
    ...overrides,
  } as Subscription
}

describe('pricing.tsx plan-purchase button persists a pre-checkout intent (task 1469)', () => {
  test('startPlanCheckout persists a COMPLETE pre-state via setPendingCheckout BEFORE returning the redirect URL', async () => {
    const s = sub()
    const result = await startPlanCheckout(
      'pro',
      'yearly',
      null,
      s,
      async () => ({ url: 'https://checkout.mollie.test/1469-pricing', payment_id: 'tr_1469_pricing' }),
    )

    // The function must have already written the intent by the time it
    // resolves — the caller's next line is the actual redirect.
    const persisted = getPendingCheckout()
    expect(persisted).not.toBeNull()
    expect(persisted!.kind).toBe('plan')
    expect(persisted!.plan).toBe('pro')
    expect(persisted!.cycle).toBe('yearly')
    expect(persisted!.paymentId).toBe('tr_1469_pricing')
    // Complete pre-state — every field makePreState reads, not a partial/
    // legacy shape (which would make the reconcile fall back to weaker
    // heuristics — see pending-checkout.ts's module doc).
    expect(persisted!.pre).toEqual(makePreState(s))
    expect(persisted!.pre).toEqual({
      plan: 'basic',
      cycle: 'monthly',
      status: 'active',
      periodEnd: '2026-10-01T00:00:00Z',
      extraStorageTb: 1,
      storageTbQuantity: 1,
      mandateMethod: 'creditcard',
    })

    // Sanity: the caller still gets the redirect URL back.
    expect('url' in result && result.url).toBe('https://checkout.mollie.test/1469-pricing')
  })

  test('a promo-code checkout still persists the intent with the promo_code forwarded', async () => {
    const s = sub({
      plan: 'free', billing_cycle: undefined, status: undefined,
      current_period_end: undefined, extra_storage_tb: 0, storage_tb_quantity: 0,
      mandate_method: undefined,
    })
    let lastParams: unknown = null
    await startPlanCheckout('basic', 'monthly', 'WELCOME10', s, async (params) => {
      lastParams = params
      return { url: 'https://checkout.mollie.test/1469-pricing-promo', payment_id: 'tr_1469_promo' }
    })

    expect(lastParams).toEqual({ plan: 'basic', billing_cycle: 'monthly', promo_code: 'WELCOME10' })
    const persisted = getPendingCheckout()
    expect(persisted!.pre).toEqual(makePreState(s))
  })

  test('a {trial:true} result (no redirect at all) does NOT persist a checkout intent', async () => {
    await startPlanCheckout(
      'starter',
      'yearly',
      null,
      sub(),
      async () => ({ trial: true, message: 'Your free trial has started' }),
    )

    expect(getPendingCheckout()).toBeNull()
  })

  test('a null subscription (fetch failed / not loaded yet) still persists an intent, falling back to the Free default pre-state', async () => {
    await startPlanCheckout(
      'pro',
      'yearly',
      null,
      null,
      async () => ({ url: 'https://checkout.mollie.test/1469-pricing-null-sub', payment_id: 'tr_1469_null' }),
    )

    const persisted = getPendingCheckout()
    expect(persisted).not.toBeNull()
    expect(persisted!.pre).toEqual(makePreState(null))
  })
})
