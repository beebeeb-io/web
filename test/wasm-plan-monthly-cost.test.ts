import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, plan_monthly_cost_cents } from 'beebeeb-wasm'

// ─── WASM plan_monthly_cost_cents reflects the €10.99/TB add-on (task 1607) ─
//
// Task 1607 (Guus ruling, 2026-09-29) reverses task 1463's 2026-09-22 raise
// from €10.99/TB back to €10.99/TB — i.e. the add-on rate returns to what it
// was before 1463. The committed `beebeeb-wasm` package must be regenerated
// from a core build carrying STORAGE_ADDON_CENTS_PER_TB = 1099 again (core
// PR beebeeb-io/core#24), or the billing UI's storage-slider preview
// (billing.tsx ~680-681, planMonthlyCostCents) and the addonPerTbCents
// fallback (~1525-1530) keep computing at the stale €14.99/TB rate while
// the server + display copy already advertise €10.99/TB.
//
// This test calls the vendored WASM directly (same style as
// thumbnail-kat.test.ts / core-vectors-kat.test.ts) so it is pinned to
// whatever package is actually committed at packages/beebeeb-wasm/ — no
// core source is imported. Before the task 1607 core PR is vendored in,
// this FAILS with the 1463-era 1499-per-TB numbers (4097n / 6994n instead
// of 3297n / 6594n). See the "Notes" section of
// .claude/tasks/in-development/1607-*.md for the red→green transcript.

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

describe('plan_monthly_cost_cents — €10.99/TB storage add-on (task 1607)', () => {
  test('pro + 2 extra TB = base (1099) + 2 * 1099 = 3297 cents', () => {
    expect(plan_monthly_cost_cents('pro', 2n, 0n)).toBe(3297n)
  })

  test('business + 1 extra TB = base (5495) + 1 * 1099 = 6594 cents', () => {
    expect(plan_monthly_cost_cents('business', 1n, 0n)).toBe(5495n + 1099n)
  })
})
