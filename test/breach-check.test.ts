import { describe, expect, test, afterEach } from 'bun:test'
import { checkPasswordBreached } from '../src/lib/breach-check'

// SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
//   prefix (sent)   = 5BAA6
//   suffix (local)  = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const PW = 'password'
const FULL_SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('checkPasswordBreached — k-anonymity over OUR OWN corpus (task 1367)', () => {
  test('sends ONLY the 5-char SHA-1 prefix to OUR API (never the password, full hash, or any third party) + returns the count', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url)
      // a padded count-0 line + the real match
      return new Response(`00000000000000000000000000000000000:0\n${SUFFIX}:3730471`, { status: 200 })
    }) as unknown as typeof fetch
    const result = await checkPasswordBreached(PW)
    // The request URL is EXACTLY our own pwned-range endpoint — never pwnedpasswords.com.
    expect(calledUrl).toBe('https://api.beebeeb.io/api/v1/auth/pwned-range/5BAA6')
    // The 35-char suffix (the rest of the hash) never leaves the browser, and
    // neither does the full 40-char digest.
    expect(calledUrl.includes(SUFFIX)).toBe(false)
    expect(calledUrl.includes(FULL_SHA1)).toBe(false)
    expect(result).toEqual({ breached: true, count: 3730471, checkFailed: false })
  })

  test('a padding row that matches our suffix with count 0 is NOT a breach', async () => {
    globalThis.fetch = (async () =>
      new Response(`${SUFFIX}:0`, { status: 200 })) as unknown as typeof fetch
    expect(await checkPasswordBreached(PW)).toEqual({ breached: false, count: 0, checkFailed: false })
  })

  test('suffix absent from the range response → not breached (check ran)', async () => {
    globalThis.fetch = (async () =>
      new Response('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9', { status: 200 })) as unknown as typeof fetch
    expect(await checkPasswordBreached(PW)).toEqual({ breached: false, count: 0, checkFailed: false })
  })

  test('empty response body (unseeded corpus) → not breached, fail-open, check still "ran"', async () => {
    globalThis.fetch = (async () => new Response('', { status: 200 })) as unknown as typeof fetch
    expect(await checkPasswordBreached(PW)).toEqual({ breached: false, count: 0, checkFailed: false })
  })

  test('our API unreachable (fetch throws) → checkFailed, never "breached" (fail open)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await checkPasswordBreached(PW)).toEqual({ breached: false, count: 0, checkFailed: true })
  })

  test('our API non-200 → checkFailed, never "breached" (fail open)', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    expect(await checkPasswordBreached(PW)).toEqual({ breached: false, count: 0, checkFailed: true })
  })

  test('empty password → not breached, no request made', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch
    expect(await checkPasswordBreached('')).toEqual({ breached: false, count: 0, checkFailed: false })
    expect(called).toBe(false)
  })
})
