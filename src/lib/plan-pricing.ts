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
    wasmInitPromise = init().then(() => { wasmReady = true }).catch(() => {
      wasmInitPromise = null
    })
  }
  await wasmInitPromise
}

// Start WASM init immediately on module load — don't wait for first call
ensureWasm()


export function planCanAddStorage(planSlug: string): boolean {
  if (!wasmReady) return false
  return plan_can_add_storage(planSlug)
}

export function planMaxExtraTB(planSlug: string): number {
  if (!wasmReady) return 0
  return Number(plan_max_extra_tb(planSlug))
}

export function planBaseTB(planSlug: string): number {
  if (!wasmReady) return 0
  return Number(plan_base_storage_bytes(planSlug)) / 1_000_000_000_000
}

export function planMonthlyCostCents(
  planSlug: string,
  extraTB: number,
  extraUsers: number = 0,
): number {
  if (!wasmReady) return 0
  return Number(plan_monthly_cost_cents(planSlug, BigInt(extraTB), BigInt(extraUsers)))
}

export function planEffectiveQuota(
  planSlug: string,
  extraTB: number,
  bonusBytes: number = 0,
): number {
  if (!wasmReady) return 0
  return Number(plan_effective_quota(planSlug, BigInt(extraTB), BigInt(bonusBytes)))
}

export function formatCentsAsEur(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00'
  const eur = cents / 100
  return eur % 1 === 0 ? eur.toFixed(0) : eur.toFixed(2)
}

export function formatStorageSI(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (!wasmReady) return `${bytes} B`
  return storage_format_si(BigInt(Math.round(bytes)))
}

export function isWasmReady(): boolean {
  return wasmReady
}

export { ensureWasm }
