/**
 * Money formatting for the billing surface (task W-P2-2).
 *
 * Amounts travel as integer cents everywhere else in the app; this module is
 * the only place that turns them into text. The invoice table, the transaction
 * list and the plan price lines used to each carry their own copy, which meant
 * a rounding tweak could silently apply to one surface and not the others.
 */

/**
 * Bare EUR amount for a line that already says "EUR", e.g. 3900 → "39",
 * 3995 → "39.95". Non-finite → "0.00" (a missing server amount must not print
 * "NaN" into a price).
 */
export function formatCentsAsEur(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00'
  const eur = cents / 100
  return eur % 1 === 0 ? eur.toFixed(0) : eur.toFixed(2)
}

/**
 * Signed amount with its currency code, e.g. 3995 → "EUR 39.95", -1099 →
 * "− EUR 10.99" (refunds are stored negative). The minus is a real minus sign
 * so it reads as money, not a hyphen. A missing currency falls back to EUR;
 * non-finite amounts render as zero rather than "NaN".
 */
export function formatMoneyCents(cents: number, currency: string): string {
  const safe = Number.isFinite(cents) ? cents : 0
  const cur = (currency || 'EUR').toUpperCase()
  const abs = (Math.abs(safe) / 100).toFixed(2)
  return safe < 0 ? `− ${cur} ${abs}` : `${cur} ${abs}`
}
