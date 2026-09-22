import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, plan_monthly_cost_cents } from 'beebeeb-wasm'

// ─── WASM plan_monthly_cost_cents reflects the €14.99/TB add-on (task 1463) ─
//
// Codex P1 on PR #52 (billing.tsx:1263): the committed beebeeb-wasm package
// was regenerated from core @ 80f51e2 (2026-06-25), which still bakes in
// STORAGE_ADDON_CENTS_PER_TB = 1099. The live storage-slider preview
// (billing.tsx ~680-681, planMonthlyCostCents) and the addonPerTbCents
// fallback (~1261-1263) both compute through this same binary, so the
// billing UI previewed €10.99/TB while the changed plan copy (task 1463,
// Guus ruling 2026-09-22) advertised €14.99/TB.
//
// This test calls the vendored WASM directly (same style as
// thumbnail-kat.test.ts / core-vectors-kat.test.ts) so it is pinned to
// whatever package is actually committed at packages/beebeeb-wasm/ — no
// core source is imported. Before the task 1463 core PR (beebeeb-io/core#20,
// 3ee6b90f) is vendored in, this FAILS with the old 1099-per-TB numbers
// (3297n / 6594n instead of 4097n / 6994n). See the "Notes" section of
// .claude/tasks/in-development/1463-*.md for the red→green transcript.

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

describe('plan_monthly_cost_cents — €14.99/TB storage add-on (task 1463)', () => {
  test('pro + 2 extra TB = base (1099) + 2 * 1499 = 4097 cents', () => {
    expect(plan_monthly_cost_cents('pro', 2n, 0n)).toBe(4097n)
  })

  test('business + 1 extra TB = base (5495) + 1 * 1499 = 6994 cents', () => {
    expect(plan_monthly_cost_cents('business', 1n, 0n)).toBe(5495n + 1499n)
  })
})
