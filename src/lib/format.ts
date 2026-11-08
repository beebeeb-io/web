// Formatting helpers for bytes, storage, dates, and relative time.
//
// Every byte string on the web comes from core (`beebeeb_types::format`,
// W-P3-4): the decimal/SI ladder, the binary/IEC ladder and the
// explicit-decimals form. This module owns the wasm handle for them and adds
// only the presentation guard each surface wants (never a second ladder).
import { registerSizeFormatter } from '@beebeeb/shared/drive-ui'
import init, { formatBinary, formatCompact, storage_format_si } from 'beebeeb-wasm'

let wasmReady = false
let wasmInitPromise: Promise<void> | null = null

/** Resolves once the WASM module is initialised (idempotent, never rejects). */
export async function ensureWasm(): Promise<void> {
  if (wasmReady) return
  if (!wasmInitPromise) {
    wasmInitPromise = init().then(() => { wasmReady = true }).catch(() => {
      wasmInitPromise = null
    })
  }
  await wasmInitPromise
}

export function isWasmReady(): boolean {
  return wasmReady
}

// Start WASM init immediately on module load — don't wait for first call.
ensureWasm()

const toBytes = (bytes: number) => BigInt(Math.round(bytes))

/** Decimal storage form (1 KB = 1,000 B), core's canonical `format_si`. */
export function formatStorageSI(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (!wasmReady) return `${bytes} B`
  return storage_format_si(toBytes(bytes))
}

/** The same decimal form under the name most call sites use. */
export function formatBytes(bytes: number): string {
  return formatStorageSI(bytes)
}

/** Binary/IEC form (1 KiB = 1,024 B), core's `format_binary`. */
export function formatBinarySize(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (!wasmReady) return `${bytes} B`
  return formatBinary(toBytes(bytes))
}

/**
 * Decimal, one decimal at most, with a whole number shown bare ("2 GB",
 * "6.3 GB", "500 MB") — core's `format_compact`, which does the rounding.
 */
export function formatSize(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (!wasmReady) return `${bytes} B`
  return formatCompact(toBytes(bytes), 1).replace(/\.0 (B|KB|MB|GB|TB)$/, ' $1')
}

/** Decimal with an explicit decimal count, for dense tables — core's `format_compact`. */
export function formatCompactBytes(bytes: number, decimals: 0 | 1 | 2): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (!wasmReady) return `${bytes} B`
  return formatCompact(toBytes(bytes), decimals)
}

export { formatDocumentDate, timeAgo } from '@beebeeb/shared/drive-ui'

// The shared Drive UI formats sizes through whatever the host registers: web hands it core's WASM ladder.
registerSizeFormatter({ si: formatStorageSI, compact: formatSize })
