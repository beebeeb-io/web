import { describe, expect, test, beforeEach } from 'bun:test'
import type { Subscription } from '@beebeeb/shared'

/**
 * Task 1469 — upgrade-nudge-modal.tsx's "Upgrade now" button started a
 * checkout redirect without persisting a pre-checkout intent (spec §3.3
 * item 1 gap, flagged by lane eng-0957 while landing 0957).
 * `startUpgradeCheckout` (extracted from `handleUpgrade` so it's testable
 * without rendering the modal) must call `setPendingCheckout` with a
 * COMPLETE pre-state — via the real `makePreState(subscription)` — before
 * returning the redirect URL to the caller, which does
 * `window.location.href = url` as its very next statement.
 *
 * Deliberately does NOT `mock.module('../src/lib/api', ...)` — see
 * test/pricing-checkout-intent-1469.test.ts's header comment for the exact
 * process-global collision hazard (test/helpers/upload-share-mocks.ts).
 * `startUpgradeCheckout` instead takes an injectable `checkout` fn (default:
 * the real `createCheckoutSession`) — this test passes a stub directly.
 */

// Minimal in-memory localStorage stub — mirrors
// test/pending-checkout-0957.test.ts's stub exactly.
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

const { startUpgradeCheckout } = await import('../src/components/upgrade-nudge-modal')
const { getPendingCheckout, clearPendingCheckout, makePreState } = await import('../src/lib/pending-checkout')

beforeEach(() => {
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
  clearPendingCheckout()
})

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'free',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'falkenstein',
    status: 'active',
    created_at: null,
    current_period_end: null,
    extra_storage_tb: 0,
    storage_tb_quantity: 0,
    mandate_method: null,
    ...overrides,
  } as Subscription
}

describe('upgrade-nudge-modal.tsx "Upgrade now" persists a pre-checkout intent (task 1469)', () => {
  test('startUpgradeCheckout persists a COMPLETE pre-state via setPendingCheckout BEFORE returning the redirect URL', async () => {
    const s = sub({
      plan: 'basic',
      billing_cycle: 'monthly',
      status: 'active',
      current_period_end: '2026-11-01T00:00:00Z',
      extra_storage_tb: 0,
      storage_tb_quantity: 0,
      mandate_method: 'directdebit',
    })
    let lastParams: unknown = null
    const result = await startUpgradeCheckout('pro', s, async (params) => {
      lastParams = params
      return { url: 'https://checkout.mollie.test/1469-nudge', payment_id: 'tr_1469_nudge' }
    })

    // The function must have already written the intent by the time it
    // resolves — the caller's next line is the actual redirect.
    expect(lastParams).toEqual({ plan: 'pro', billing_cycle: 'yearly' })
    const persisted = getPendingCheckout()
    expect(persisted).not.toBeNull()
    expect(persisted!.kind).toBe('plan')
    expect(persisted!.plan).toBe('pro')
    expect(persisted!.cycle).toBe('yearly')
    expect(persisted!.paymentId).toBe('tr_1469_nudge')
    // Complete pre-state — the live subscription passed in from drive.tsx
    // (useDriveData().planDetails.subscription), not a partial/legacy shape.
    expect(persisted!.pre).toEqual(makePreState(s))
    expect(persisted!.pre).toEqual({
      plan: 'basic',
      cycle: 'monthly',
      status: 'active',
      periodEnd: '2026-11-01T00:00:00Z',
      extraStorageTb: 0,
      storageTbQuantity: 0,
      mandateMethod: 'directdebit',
    })

    expect(result.url).toBe('https://checkout.mollie.test/1469-nudge')
  })

  test('a null subscription (DriveDataContext still loading) still persists an intent, falling back to the Free default pre-state', async () => {
    await startUpgradeCheckout(
      'starter',
      null,
      async () => ({ url: 'https://checkout.mollie.test/1469-nudge-null-sub', payment_id: 'tr_1469_null' }),
    )

    const persisted = getPendingCheckout()
    expect(persisted).not.toBeNull()
    expect(persisted!.plan).toBe('starter')
    expect(persisted!.pre).toEqual(makePreState(null))
  })

  test('a failed checkout call never persists a stale intent', async () => {
    await expect(
      startUpgradeCheckout('pro', sub(), async () => {
        throw new Error('checkout unavailable')
      }),
    ).rejects.toThrow('checkout unavailable')
    expect(getPendingCheckout()).toBeNull()
  })
})
