// Formatting helpers for bytes, storage, dates, and relative time.
//
// Every byte string on the web comes from core (`beebeeb_types::format`,
// W-P3-4): the decimal/SI ladder, the binary/IEC ladder and the
// explicit-decimals form. This module owns the wasm handle for them and adds
// only the presentation guard each surface wants (never a second ladder).
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

/**
 * Format a document date for display ("12 Oct 2026").
 * A date-only value (`2026-10-12`, as invoices and credit notes carry) names a
 * calendar day, not an instant: it is formatted in UTC so it never shifts a day
 * for viewers west of UTC. A full timestamp is an instant and shows in local time.
 */
export function formatDocumentDate(iso: string): string {
  if (!iso) return '-'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const d = new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]))
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', opts)
}

/** Relative age as Files shows it ("just now", "3h ago", "2w ago"). */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}
