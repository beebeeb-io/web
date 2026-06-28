/**
 * Cookie consent store.
 *
 * Two choices:
 *   'all'       — essential + functional
 *   'essential' — essential only (auth session cookie)
 *
 * Payments are handled by a redirect to our payment provider's hosted page, so
 * no third-party payment cookies are set on beebeeb.io under either choice.
 *
 * Not set → banner shown.
 */

export type ConsentLevel = 'all' | 'essential'

const KEY = 'bb_cookie_consent'

export function getConsent(): ConsentLevel | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'all' || v === 'essential') return v
    // Legacy: old banner stored '1' — treat as 'all' (user already accepted)
    if (v === '1') return 'all'
    return null
  } catch {
    return null
  }
}

export function setConsent(level: ConsentLevel): void {
  try {
    localStorage.setItem(KEY, level)
  } catch { /* ignore */ }
}

export function hasConsented(): boolean {
  return getConsent() !== null
}

export function allowsFunctional(): boolean {
  const c = getConsent()
  return c === 'all'
}
