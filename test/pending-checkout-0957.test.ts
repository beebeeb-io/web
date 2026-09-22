import { describe, expect, test, beforeEach } from 'bun:test'

// Minimal in-memory localStorage stub — this module wraps every access in
// try/catch (private-mode/unavailable tolerant), so a real browser
// localStorage isn't needed; a simple Map-backed stub keeps the test
// deterministic and isolated from Bun's own built-in (disk-backed)
// localStorage implementation.
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

const {
  PENDING_CHECKOUT_KEY,
  makePreState,
  setPendingCheckout,
  clearPendingCheckout,
  getPendingCheckout,
  persistTrialConvertIntent,
} = await import('../src/lib/pending-checkout')

beforeEach(() => {
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

describe('pending-checkout intent store (task 0957)', () => {
  test('makePreState snapshots the fields spec §3.3 item 1 names', () => {
    const pre = makePreState({
      plan: 'pro',
      billing_cycle: 'yearly',
      status: 'active',
      current_period_end: '2026-10-01T00:00:00Z',
      extra_storage_tb: 2,
      storage_tb_quantity: 2,
      mandate_method: 'directdebit',
      // Fields makePreState doesn't read — present because Subscription
      // requires them.
      seats: 1,
      region: 'falkenstein',
      created_at: null,
    } as Parameters<typeof makePreState>[0])
    expect(pre).toEqual({
      plan: 'pro',
      cycle: 'yearly',
      status: 'active',
      periodEnd: '2026-10-01T00:00:00Z',
      extraStorageTb: 2,
      storageTbQuantity: 2,
      mandateMethod: 'directdebit',
    })
  })

  test('makePreState defaults a null/undefined subscription to a Free pre-state', () => {
    expect(makePreState(null)).toEqual({
      plan: 'free',
      cycle: undefined,
      status: undefined,
      periodEnd: undefined,
      extraStorageTb: 0,
      storageTbQuantity: 0,
      mandateMethod: undefined,
    })
    expect(makePreState(undefined)).toEqual(makePreState(null))
  })

  test('round-trips kind/plan/cycle/pre/paymentId through localStorage', () => {
    const pre = makePreState(null)
    setPendingCheckout('plan', 'pro', 'yearly', pre, 'tr_abc123')
    const got = getPendingCheckout()
    expect(got).not.toBeNull()
    expect(got!.kind).toBe('plan')
    expect(got!.plan).toBe('pro')
    expect(got!.cycle).toBe('yearly')
    expect(got!.pre).toEqual(pre)
    expect(got!.paymentId).toBe('tr_abc123')
    expect(typeof got!.ts).toBe('number')
  })

  test('paymentId is optional — omitting it round-trips as undefined, not a stored literal', () => {
    setPendingCheckout('storage', 'pro', 'monthly', makePreState(null))
    const got = getPendingCheckout()
    expect(got!.paymentId).toBeUndefined()
  })

  test('a legacy record with no kind/pre/paymentId (pre-0946 shape) still parses, weaker but not crashing', () => {
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ plan: 'pro', cycle: 'yearly', ts: Date.now() }))
    const got = getPendingCheckout()
    expect(got).not.toBeNull()
    expect(got!.kind).toBe('plan') // back-compat default
    expect(got!.plan).toBe('pro')
    expect(got!.paymentId).toBeUndefined()
    expect(got!.pre).toEqual(makePreState(null))
  })

  test('a record older than the 24h TTL is treated as absent and is cleared', () => {
    const stale = { kind: 'plan', plan: 'pro', cycle: 'yearly', pre: makePreState(null), ts: Date.now() - 25 * 60 * 60 * 1000 }
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(stale))
    expect(getPendingCheckout()).toBeNull()
    // Expiry also clears the stale key, not just ignores it.
    expect(localStorage.getItem(PENDING_CHECKOUT_KEY)).toBeNull()
  })

  test('a record just under the 24h TTL is still returned', () => {
    const fresh = { kind: 'plan', plan: 'pro', cycle: 'yearly', pre: makePreState(null), ts: Date.now() - 23 * 60 * 60 * 1000 }
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(fresh))
    expect(getPendingCheckout()).not.toBeNull()
  })

  test('clearPendingCheckout removes the record entirely', () => {
    setPendingCheckout('plan', 'pro', 'yearly', makePreState(null), 'tr_x')
    expect(getPendingCheckout()).not.toBeNull()
    clearPendingCheckout()
    expect(getPendingCheckout()).toBeNull()
    expect(localStorage.getItem(PENDING_CHECKOUT_KEY)).toBeNull()
  })

  test('no record at all returns null without throwing', () => {
    expect(getPendingCheckout()).toBeNull()
  })

  test('malformed JSON in the key returns null without throwing (private-mode/corruption tolerant)', () => {
    localStorage.setItem(PENDING_CHECKOUT_KEY, '{not json')
    expect(getPendingCheckout()).toBeNull()
  })

  // PR #53 review (task 0957 follow-up): the billing-page `handleConvertTrial`
  // caller persisted `payment_id`, but `trial-banner.tsx`'s `handleConvert`
  // destructured only `{ url }` from `convertTrial()` and called the raw
  // `setPendingCheckout` with no paymentId — so a conversion started from the
  // site-wide banner silently lost the direct `GET /payment/{id}/status`
  // reconciliation path. Both call sites now go through this ONE shared
  // helper so they cannot drift again.
  test('persistTrialConvertIntent stamps paymentId — regression for the trial-banner caller that dropped it', () => {
    persistTrialConvertIntent(
      { plan: 'pro', billing_cycle: 'monthly', status: 'trialing' } as Parameters<typeof persistTrialConvertIntent>[0],
      'tr_banner_convert',
    )
    const got = getPendingCheckout()
    expect(got).not.toBeNull()
    expect(got!.kind).toBe('plan')
    expect(got!.plan).toBe('pro')
    expect(got!.cycle).toBe('monthly')
    expect(got!.paymentId).toBe('tr_banner_convert')
    expect(got!.pre).toEqual(makePreState({ plan: 'pro', billing_cycle: 'monthly', status: 'trialing' } as Parameters<typeof persistTrialConvertIntent>[0]))
  })

  test('persistTrialConvertIntent tolerates a null subscription (defaults to Free) and an omitted paymentId', () => {
    persistTrialConvertIntent(null, undefined)
    const got = getPendingCheckout()
    expect(got!.plan).toBe('free')
    expect(got!.cycle).toBe('monthly')
    expect(got!.paymentId).toBeUndefined()
  })
})
