/**
 * Plan pricing utilities — delegates to WASM core (beebeeb-types::quota).
 *
 * NO local constants or fallbacks. If WASM isn't loaded, these throw.
 * The WasmGuard component ensures WASM is ready before the app renders.
 */

import init, {
  plan_can_add_storage,
  plan_max_extra_tb,
  plan_base_storage_bytes,
  plan_monthly_cost_cents,
  plan_effective_quota,
  storage_format_si,
} from 'beebeeb-wasm'

let wasmReady = false
let wasmInitPromise: Promise<void> | null = null

async function ensureWasm(): Promise<void> {
  if (wasmReady) return
  if (!wasmInitPromise) {
    wasmInitPromise = init().then(() => { wasmReady = true })
  }
  await wasmInitPromise
}

function assertWasm(): void {
  if (!wasmReady) {
    throw new Error('WASM not loaded — quota functions require beebeeb-wasm to be initialized')
  }
}

export function planCanAddStorage(planSlug: string): boolean {
  assertWasm()
  return plan_can_add_storage(planSlug)
}

export function planMaxExtraTB(planSlug: string): number {
  assertWasm()
  return Number(plan_max_extra_tb(planSlug))
}

export function planBaseTB(planSlug: string): number {
  assertWasm()
  return Number(plan_base_storage_bytes(planSlug)) / 1_000_000_000_000
}

export function planMonthlyCostCents(
  planSlug: string,
  extraTB: number,
  extraUsers: number = 0,
): number {
  assertWasm()
  return Number(plan_monthly_cost_cents(planSlug, BigInt(extraTB), BigInt(extraUsers)))
}

export function planEffectiveQuota(
  planSlug: string,
  extraTB: number,
  bonusBytes: number = 0,
): number {
  assertWasm()
  return Number(plan_effective_quota(planSlug, BigInt(extraTB), BigInt(bonusBytes)))
}

export function formatCentsAsEur(cents: number): string {
  const eur = cents / 100
  return eur % 1 === 0 ? eur.toFixed(0) : eur.toFixed(2)
}

export function formatStorageSI(bytes: number): string {
  assertWasm()
  return storage_format_si(BigInt(bytes))
}

export { ensureWasm }
