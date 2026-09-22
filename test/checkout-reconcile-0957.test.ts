import { describe, expect, test } from 'bun:test'
import { reflectsUpgrade, reflectsUpgradeNoIntent } from '../src/lib/checkout-reconcile'
import type { PendingCheckout, CheckoutPreState } from '../src/lib/pending-checkout'
import type { Subscription } from '@beebeeb/shared'

function pre(overrides: Partial<CheckoutPreState> = {}): CheckoutPreState {
  return {
    plan: 'free',
    cycle: undefined,
    status: undefined,
    periodEnd: undefined,
    extraStorageTb: 0,
    storageTbQuantity: 0,
    mandateMethod: undefined,
    ...overrides,
  }
}

function intent(overrides: Partial<PendingCheckout> = {}): PendingCheckout {
  return {
    kind: 'plan',
    plan: 'pro',
    cycle: 'yearly',
    pre: pre(),
    ts: Date.now(),
    ...overrides,
  }
}

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'free',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'falkenstein',
    status: 'active',
    created_at: null,
    current_period_end: null,
    ...overrides,
  } as Subscription
}

describe('reflectsUpgrade — the reconcile state machine (task 0957, spec §3.3)', () => {
  // ── No intent at all ──────────────────────────────────────────────────
  test('null intent never confirms (nothing to compare against)', () => {
    expect(reflectsUpgrade(null, sub({ plan: 'pro', status: 'active' }))).toBe(false)
  })

  // ── Plan-kind intent ──────────────────────────────────────────────────
  test('confirms a plan upgrade that matches the target and changed from a Free pre-state', () => {
    const i = intent({ kind: 'plan', plan: 'pro', cycle: 'yearly', pre: pre({ plan: 'free', status: 'active' }) })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'yearly', status: 'active' }))).toBe(true)
  })

  test('does NOT confirm while the subscription still shows the pre-checkout plan (still finalizing)', () => {
    const i = intent({ kind: 'plan', plan: 'pro', cycle: 'yearly', pre: pre({ plan: 'basic', status: 'active' }) })
    expect(reflectsUpgrade(i, sub({ plan: 'basic', billing_cycle: 'monthly', status: 'active' }))).toBe(false)
  })

  test('does NOT confirm a no-op "match" — target equals an UNCHANGED pre-state (not a real confirmation)', () => {
    // Regression guard: matching the target plan/cycle alone isn't enough if
    // it's identical to what the user already had before the redirect.
    const i = intent({
      kind: 'plan', plan: 'pro', cycle: 'yearly',
      pre: pre({ plan: 'pro', cycle: 'yearly', status: 'active', periodEnd: '2026-06-01T00:00:00Z' }),
    })
    expect(
      reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'yearly', status: 'active', current_period_end: '2026-06-01T00:00:00Z' })),
    ).toBe(false)
  })

  test('DOES confirm target-match-vs-unchanged-pre when the period end actually advanced (a real renewal-through-upgrade)', () => {
    const i = intent({
      kind: 'plan', plan: 'pro', cycle: 'yearly',
      pre: pre({ plan: 'pro', cycle: 'yearly', status: 'active', periodEnd: '2026-06-01T00:00:00Z' }),
    })
    expect(
      reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'yearly', status: 'active', current_period_end: '2027-06-01T00:00:00Z' })),
    ).toBe(true)
  })

  test('trial → active conversion confirms even though plan/cycle never move (F-mode: 0905 UNIT B)', () => {
    const i = intent({
      kind: 'plan', plan: 'pro', cycle: 'monthly',
      pre: pre({ plan: 'pro', cycle: 'monthly', status: 'trialing' }),
    })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'active' }))).toBe(true)
  })

  test('a non-active status (e.g. still provisioning) never confirms a plan intent, even with a matching plan/cycle', () => {
    // Distinct from the trial-conversion case above: `trialing` IS in
    // ACTIVE_STATUSES (a fresh trial start also counts as "landed"), but a
    // genuinely non-active status must not.
    const i = intent({ kind: 'plan', plan: 'pro', cycle: 'monthly', pre: pre({ plan: 'free', status: 'active' }) })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'incomplete' }))).toBe(false)
  })

  test('a fresh checkout landing as `trialing` (not just `active`) still confirms — ACTIVE_STATUSES covers both', () => {
    const i = intent({ kind: 'plan', plan: 'pro', cycle: 'monthly', pre: pre({ plan: 'free', status: 'active' }) })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'trialing' }))).toBe(true)
  })

  // ── Storage-kind intent — the F2/0946 fix this task's scope item 1 names ─
  test('storage intent confirms on extra_storage_tb rising above the PRE-checkout value', () => {
    const i = intent({
      kind: 'storage', plan: 'pro', cycle: 'monthly',
      pre: pre({ plan: 'pro', cycle: 'monthly', status: 'active', extraStorageTb: 1, storageTbQuantity: 1 }),
    })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'active', extra_storage_tb: 3, storage_tb_quantity: 3 }))).toBe(true)
  })

  test('storage intent does NOT confirm on the plan/cycle heuristic even if it happens to match — storage never moved', () => {
    const i = intent({
      kind: 'storage', plan: 'pro', cycle: 'monthly',
      pre: pre({ plan: 'pro', cycle: 'monthly', status: 'active', extraStorageTb: 2, storageTbQuantity: 2 }),
    })
    // plan/cycle identical to the target AND the pre-state — a storage intent
    // must ignore this path entirely and require the storage delta.
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'active', extra_storage_tb: 2, storage_tb_quantity: 2 }))).toBe(false)
  })

  test('storage intent requires an ACTIVE status — a paused/past_due sub with higher storage does not confirm', () => {
    const i = intent({
      kind: 'storage', plan: 'pro', cycle: 'monthly',
      pre: pre({ plan: 'pro', cycle: 'monthly', status: 'active', extraStorageTb: 0, storageTbQuantity: 0 }),
    })
    expect(reflectsUpgrade(i, sub({ plan: 'pro', billing_cycle: 'monthly', status: 'past_due', extra_storage_tb: 2, storage_tb_quantity: 2 }))).toBe(false)
  })

  // ── No-intent fallback (legacy direct-visit heuristic) ────────────────
  test('reflectsUpgradeNoIntent accepts any active/trialing paid plan', () => {
    expect(reflectsUpgradeNoIntent(sub({ plan: 'pro', status: 'active' }))).toBe(true)
    expect(reflectsUpgradeNoIntent(sub({ plan: 'pro', status: 'trialing' }))).toBe(true)
  })

  test('reflectsUpgradeNoIntent rejects Free or a non-active status', () => {
    expect(reflectsUpgradeNoIntent(sub({ plan: 'free', status: 'active' }))).toBe(false)
    expect(reflectsUpgradeNoIntent(sub({ plan: 'pro', status: 'past_due' }))).toBe(false)
    expect(reflectsUpgradeNoIntent(sub({ plan: 'pro', status: 'canceled' }))).toBe(false)
  })
})
