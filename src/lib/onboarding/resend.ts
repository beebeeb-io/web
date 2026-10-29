/**
 * The "ask for a new code" countdown on the verify_email_code screen
 * (task 1738, Guus ruling 2026-10-05: a resend sends a fresh code).
 *
 * The wait comes from the document, `policy.email_code.resend_after_seconds`
 * (60 at the time of writing), never from a constant here. The server enforces
 * the same window per address and answers a too-early request with the usual
 * 202 and no mail, identically for known and unknown addresses, so this
 * countdown is the only place the user learns when asking again will do
 * anything.
 */

/** Whole seconds until the next code may be requested; 0 when it may be now. */
export function resendRemainingSeconds(
  sentAtMs: number | null,
  resendAfterSeconds: number,
  nowMs: number,
): number {
  if (sentAtMs === null) return 0
  const left = Math.ceil((sentAtMs + resendAfterSeconds * 1000 - nowMs) / 1000)
  return left > 0 ? left : 0
}

/** `m:ss` ("0:42", "1:05", "15:00"). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
