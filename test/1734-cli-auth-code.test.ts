import { describe, expect, test } from 'bun:test'

import {
  CODE_RE,
  countryName,
  describeAge,
  describeClient,
  describePlace,
  formatCodeInput,
  linkCarriesCode,
  normalizeTypedCode,
} from '../src/lib/cli-auth-code'

// Task 1734 (security review 2026-10-04, finding 9): the /cli-auth page must
// never take a device code from the URL. These are the pure rules behind that.

describe('linkCarriesCode — a code in the link is detected so the page can warn, never used', () => {
  test('flags any code parameter, whatever its value', () => {
    expect(linkCarriesCode('?code=ABCD-EFGH')).toBe(true)
    expect(linkCarriesCode('?code=')).toBe(true)
    expect(linkCarriesCode('?x=1&code=zzzz-zzzz')).toBe(true)
  })

  test('is false for a plain link', () => {
    expect(linkCarriesCode('')).toBe(false)
    expect(linkCarriesCode('?next=%2Fcli-auth')).toBe(false)
  })
})

describe('formatCodeInput — what the person types or pastes', () => {
  test('upper-cases and inserts the dash after four characters', () => {
    expect(formatCodeInput('abcd')).toBe('ABCD')
    expect(formatCodeInput('abcde')).toBe('ABCD-E')
    expect(formatCodeInput('abcdefgh')).toBe('ABCD-EFGH')
  })

  test('accepts a pasted code however it was written down', () => {
    expect(formatCodeInput('abcd efgh')).toBe('ABCD-EFGH')
    expect(formatCodeInput('  ABCD-EFGH\n')).toBe('ABCD-EFGH')
    expect(formatCodeInput('abcd_efgh')).toBe('ABCD-EFGH')
  })

  test('never grows past eight characters', () => {
    expect(formatCodeInput('abcdefghjkl')).toBe('ABCD-EFGH')
  })

  test('drops characters that cannot be in a code', () => {
    expect(formatCodeInput('ab!cd')).toBe('ABCD')
    expect(formatCodeInput('')).toBe('')
  })
})

describe('normalizeTypedCode — only a complete code goes to the server', () => {
  test('a complete code in any spelling normalises to the server shape', () => {
    expect(normalizeTypedCode('abcd efgh')).toBe('ABCD-EFGH')
    expect(normalizeTypedCode('AB12-CD34')).toBe('AB12-CD34')
    expect(CODE_RE.test(normalizeTypedCode('ab12cd34')!)).toBe(true)
  })

  test('an incomplete code is null (the Continue button stays disabled)', () => {
    expect(normalizeTypedCode('')).toBeNull()
    expect(normalizeTypedCode('abcd')).toBeNull()
    expect(normalizeTypedCode('abcd-efg')).toBeNull()
  })
})

describe('describeAge', () => {
  const requested = '2026-10-04T12:00:00Z'
  const at = (seconds: number) => new Date(Date.parse(requested) + seconds * 1000)

  test('reads "just now" for a fresh request, even if the clocks disagree a little', () => {
    expect(describeAge(requested, at(0))).toBe('just now')
    expect(describeAge(requested, at(30))).toBe('just now')
    expect(describeAge(requested, at(-20))).toBe('just now')
  })

  test('counts minutes, singular and plural', () => {
    expect(describeAge(requested, at(60))).toBe('1 minute ago')
    expect(describeAge(requested, at(180))).toBe('3 minutes ago')
  })

  test('counts hours for an old request and survives a bad timestamp', () => {
    expect(describeAge(requested, at(2 * 3600))).toBe('2 hours ago')
    expect(describeAge('not a date', at(0))).toBe('a moment ago')
  })
})

describe('describePlace — honest about what is not known', () => {
  test('names the country when the server knew it', () => {
    expect(describePlace({ ip: '203.0.113.7', country: 'NL' })).toBe('203.0.113.7 (Netherlands)')
  })

  test('says so when it did not', () => {
    expect(describePlace({ ip: '203.0.113.7', country: null })).toBe('203.0.113.7 (location unknown)')
  })

  test('falls back to the raw code for something the runtime cannot name', () => {
    expect(countryName('ZZ')).toBeTruthy()
  })
})

describe('describeClient — what the device SAYS it is', () => {
  test('names the program, version and system', () => {
    expect(describeClient({ client: 'cli', client_version: '0.9.9', os: 'macos' })).toBe(
      'Beebeeb command-line tool 0.9.9 on macOS',
    )
    expect(describeClient({ client: 'desktop', client_version: null, os: 'windows' })).toBe(
      'Beebeeb desktop app on Windows',
    )
  })

  test('says nothing when the device said nothing', () => {
    expect(describeClient({ client: null, client_version: null, os: null })).toBeNull()
  })

  test('still reports a system when the program is unknown', () => {
    expect(describeClient({ client: null, client_version: null, os: 'linux' })).toBe('Linux')
  })
})
