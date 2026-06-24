/**
 * HIBP (Have I Been Pwned) breached-password check — client-side, k-anonymity.
 *
 * The "Pwned Passwords" range API never sees the password or its full hash.
 * We SHA-1 the password IN THE BROWSER, send ONLY the first 5 hex chars of the
 * digest ("prefix") to https://api.pwnedpasswords.com/range/{prefix}, and the
 * API returns every breached-hash SUFFIX (the remaining 35 hex chars) that
 * shares that prefix, each with a seen-count. We match the rest of OUR hash
 * against that list locally. The full password and the full hash NEVER leave
 * the device — the server (ours or HIBP's) only ever learns a 5-char prefix
 * that maps to ~hundreds of candidate hashes.
 *
 * This is the same model the HIBP browser integrations use. It is intentionally
 * fail-OPEN: if the API is unreachable (offline, blocked, CORS), we return "not
 * pwned" rather than blocking a legitimate password change on a third-party
 * outage. The caller can surface a soft note if it wants, but must not hard-fail
 * the password change purely because the breach service was down.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

export interface PwnedResult {
  /** True only if the password appeared in a known breach corpus. */
  pwned: boolean
  /** How many times the password was seen across breaches (0 when not pwned). */
  count: number
  /** True if the check could not run (network/CORS/parse failure) — fail-open. */
  checkFailed: boolean
}

/** SHA-1 a UTF-8 string and return the 40-char UPPERCASE hex digest. */
async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Check a password against HaveIBeenPwned's Pwned Passwords range API using
 * k-anonymity. Only the first 5 chars of the SHA-1 hex digest are transmitted.
 *
 * Fail-open: any network/parse error resolves to `{ pwned: false, count: 0,
 * checkFailed: true }` so a third-party outage never blocks a password change.
 */
export async function checkPasswordPwned(password: string): Promise<PwnedResult> {
  if (!password) return { pwned: false, count: 0, checkFailed: false }

  let hash: string
  try {
    hash = await sha1Hex(password)
  } catch {
    // SubtleCrypto unavailable (e.g. non-secure context) — fail open.
    return { pwned: false, count: 0, checkFailed: true }
  }

  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5) // 35 hex chars — the rest of OUR hash

  let text: string
  try {
    // Add-Padding asks HIBP to pad the response with bogus rows so the response
    // size doesn't leak how many real matches the prefix had.
    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    })
    if (!res.ok) return { pwned: false, count: 0, checkFailed: true }
    text = await res.text()
  } catch {
    return { pwned: false, count: 0, checkFailed: true }
  }

  // Each line is `SUFFIX:COUNT` (suffix is uppercase hex). Padding rows carry a
  // count of 0 — treat those as not-a-match even if the suffix coincidentally
  // matches (a real breached entry always has count >= 1).
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const lineSuffix = line.slice(0, idx).trim().toUpperCase()
    if (lineSuffix !== suffix) continue
    const count = parseInt(line.slice(idx + 1).trim(), 10) || 0
    if (count > 0) return { pwned: true, count, checkFailed: false }
    return { pwned: false, count: 0, checkFailed: false }
  }

  return { pwned: false, count: 0, checkFailed: false }
}
