/**
 * HIBP Pwned Passwords — client-side k-anonymity breach check (task 0723).
 *
 * Web/OPAQUE signup is zero-knowledge: the password never reaches our server, so
 * the server-side HIBP check can't cover it. This adds an equivalent check in the
 * browser WITHOUT breaking zero-knowledge — via HIBP's k-anonymity range API:
 * the browser SHA-1s the password and sends ONLY the first 5 hex chars of the
 * hash to `api.pwnedpasswords.com/range/{prefix}`. The response lists
 * `SUFFIX:COUNT` for every breached hash sharing that prefix; we scan it locally
 * for our 35-char suffix. The password — and even its full hash — never leave the
 * browser.
 *
 * Fail-open: any failure (network, abort, malformed response) returns `null`
 * ("unknown"), so HIBP availability never gates signup — matching the
 * server-side check's disposition (security ledger §3).
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range'

/** Uppercase hex SHA-1 of `input` (HIBP suffixes are uppercase hex). */
async function sha1HexUpper(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * How many times `password` appears in known breaches.
 * - `> 0` — breached (the count).
 * - `0`   — checked, not found.
 * - `null`— check could not complete; treat as unknown (fail open, no warning).
 */
export async function pwnedPasswordCount(
  password: string,
  signal?: AbortSignal,
): Promise<number | null> {
  if (!password) return 0
  try {
    const hash = await sha1HexUpper(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5) // 35 chars — never sent
    // A plain GET (no custom headers) — a CORS "simple request", so no preflight.
    // We intentionally skip the `Add-Padding` header: it only obfuscates response
    // SIZE (a minor side-channel next to the k-anonymity we already have) and
    // would turn this into a preflighted request.
    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, { signal })
    if (!res.ok) return null
    const body = await res.text()
    for (const line of body.split('\n')) {
      const sep = line.indexOf(':')
      if (sep < 0) continue
      if (line.slice(0, sep).trim().toUpperCase() === suffix) {
        const count = Number.parseInt(line.slice(sep + 1), 10)
        return Number.isFinite(count) ? count : null
      }
    }
    return 0 // prefix fetched, our suffix absent → not breached
  } catch {
    return null // network / abort / parse error → fail open
  }
}
