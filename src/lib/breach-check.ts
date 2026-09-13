/**
 * Breached-password check — k-anonymity over OUR OWN corpus.
 *
 * The password is SHA-1'd IN THE BROWSER and only the first 5 hex chars of the
 * digest are sent to `GET /api/v1/auth/pwned-range/{prefix}` on api.beebeeb.io,
 * which answers from the node-local HaveIBeenPwned corpus (tasks 0766/0767).
 * The full password and full hash never leave the device, and no request goes
 * to any third party — the direct api.pwnedpasswords.com call this replaces was
 * a US-fronted origin banned by the no-US-systems rule (task 0995).
 *
 * Fail-OPEN: any network/parse failure, or an unseeded corpus (empty body),
 * resolves to "not breached" so a password change is never blocked.
 */
import { API_URL } from './api'

export interface BreachResult {
  breached: boolean
  count: number
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
 * Check a password against our own node-local HIBP corpus using k-anonymity.
 * Only the first 5 chars of the SHA-1 hex digest are transmitted, to our API.
 *
 * Fail-open: any network/parse error resolves to `{ breached: false, count: 0,
 * checkFailed: true }` so a corpus/service issue never blocks a password change.
 */
export async function checkPasswordBreached(password: string): Promise<BreachResult> {
  if (!password) return { breached: false, count: 0, checkFailed: false }

  let hash: string
  try {
    hash = await sha1Hex(password)
  } catch {
    // SubtleCrypto unavailable (e.g. non-secure context) — fail open.
    return { breached: false, count: 0, checkFailed: true }
  }

  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5) // 35 hex chars — the rest of OUR hash

  let text: string
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/pwned-range/${prefix}`, {
      credentials: 'include',
    })
    if (!res.ok) return { breached: false, count: 0, checkFailed: true }
    text = await res.text()
  } catch {
    return { breached: false, count: 0, checkFailed: true }
  }

  // Each line is `SUFFIX:COUNT` (suffix is uppercase hex).
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    const lineSuffix = (idx === -1 ? line : line.slice(0, idx)).trim().toUpperCase()
    if (lineSuffix !== suffix) continue
    const count = idx === -1 ? 1 : parseInt(line.slice(idx + 1).trim(), 10) || 0
    return count > 0
      ? { breached: true, count, checkFailed: false }
      : { breached: false, count: 0, checkFailed: false }
  }

  return { breached: false, count: 0, checkFailed: false }
}
