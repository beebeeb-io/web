/**
 * Pure helpers for the /cli-auth approval page (task 1734, security review
 * 2026-10-04 finding 9).
 *
 * The page used to read the device code from the link and approve with one
 * click, so a link sent by an attacker (who had started their own device flow)
 * handed the victim's master key to the attacker's key. The page now NEVER
 * reads a code from the URL: the person types the code their own device shows.
 * Everything here is deliberately free of React, fetch and the DOM so it can be
 * unit-tested directly.
 */

/** The server's code shape: two groups of four from A-Z / 0-9 (the generator skips I, O, 0 and 1). */
export const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

/**
 * Format what the person is typing or pasting: upper-case, letters and digits
 * only, a dash after the fourth character, at most eight characters. "abcd efgh"
 * and "abcdefgh" both become "ABCD-EFGH".
 */
export function formatCodeInput(raw: string): string {
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return alnum.length > 4 ? `${alnum.slice(0, 4)}-${alnum.slice(4)}` : alnum
}

/** The code in the server's shape, or null when what was typed is not a complete code. */
export function normalizeTypedCode(raw: string): string | null {
  const formatted = formatCodeInput(raw)
  return CODE_RE.test(formatted) ? formatted : null
}

/**
 * True when the page URL carries a `code` parameter. We only ever ask this to
 * warn the person; the VALUE is never read, prefilled or looked up.
 */
export function linkCarriesCode(search: string): boolean {
  return new URLSearchParams(search).has('code')
}

/**
 * What `GET /api/v1/auth/cli-pubkey` returns about the asker. `requested_at`,
 * `expires_at`, `ip`, `country` and `user_agent` are measured by the server;
 * `client`, `client_version`, `device_name` and `os` are whatever the asking
 * program SAID about itself (the server sanitises them but cannot verify them).
 */
export interface CliRequestFacts {
  requested_at: string
  expires_at: string
  ip: string
  country: string | null
  user_agent: string | null
  client: 'cli' | 'desktop' | null
  client_version: string | null
  device_name: string | null
  os: 'macos' | 'windows' | 'linux' | null
}

/** "just now" / "3 minutes ago". A clock that disagrees with the server by a few seconds still reads "just now". */
export function describeAge(requestedAtIso: string, now: Date): string {
  const requested = Date.parse(requestedAtIso)
  if (Number.isNaN(requested)) return 'a moment ago'
  const seconds = Math.floor((now.getTime() - requested) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

/** "Netherlands" for "NL"; falls back to the code itself when the runtime cannot name it. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** Where the request came from, as the server measured it. Honest about not knowing the place. */
export function describePlace(facts: Pick<CliRequestFacts, 'ip' | 'country'>): string {
  const place = facts.country ? countryName(facts.country) : 'location unknown'
  return `${facts.ip} (${place})`
}

const OS_LABEL: Record<NonNullable<CliRequestFacts['os']>, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

/**
 * What the program says it is, e.g. "Beebeeb command-line tool 0.9.9 on macOS".
 * Null when it said nothing usable. The page labels this "reported by the
 * device" because anything can claim to be anything.
 */
export function describeClient(facts: Pick<CliRequestFacts, 'client' | 'client_version' | 'os'>): string | null {
  const name =
    facts.client === 'desktop'
      ? 'Beebeeb desktop app'
      : facts.client === 'cli'
        ? 'Beebeeb command-line tool'
        : null
  if (!name) return facts.os ? OS_LABEL[facts.os] : null
  const version = facts.client_version ? ` ${facts.client_version}` : ''
  const os = facts.os ? ` on ${OS_LABEL[facts.os]}` : ''
  return `${name}${version}${os}`
}
