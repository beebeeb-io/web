import { describe, expect, test, afterEach } from 'bun:test'
import { checkPasswordPwned } from '../src/lib/hibp'

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

describe('checkPasswordPwned — HIBP k-anonymity (0723, 0854b)', () => {
  test('sends ONLY the 5-char SHA-1 prefix (never the password or full hash) + returns the count', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url)
      // a padded count-0 line + the real match
      return new Response(`00000000000000000000000000000000000:0\n${SUFFIX}:3730471`, { status: 200 })
    }) as unknown as typeof fetch
    const result = await checkPasswordPwned(PW)
    // The request URL is EXACTLY the prefix endpoint — nothing else is sent.
    expect(calledUrl).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    // The 35-char suffix (the rest of the hash) never leaves the browser, and
    // neither does the full 40-char digest.
    expect(calledUrl.includes(SUFFIX)).toBe(false)
    expect(calledUrl.includes(FULL_SHA1)).toBe(false)
    expect(result).toEqual({ pwned: true, count: 3730471, checkFailed: false })
  })

  test('a padding row that matches our suffix with count 0 is NOT a breach', async () => {
    globalThis.fetch = (async () =>
      new Response(`${SUFFIX}:0`, { status: 200 })) as unknown as typeof fetch
    expect(await checkPasswordPwned(PW)).toEqual({ pwned: false, count: 0, checkFailed: false })
  })

  test('suffix absent from the range response → not pwned (check ran)', async () => {
    globalThis.fetch = (async () =>
      new Response('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9', { status: 200 })) as unknown as typeof fetch
    expect(await checkPasswordPwned(PW)).toEqual({ pwned: false, count: 0, checkFailed: false })
  })

  test('HIBP unreachable (fetch throws) → checkFailed, never "pwned" (fail open)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await checkPasswordPwned(PW)).toEqual({ pwned: false, count: 0, checkFailed: true })
  })

  test('HIBP non-200 → checkFailed, never "pwned" (fail open)', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    expect(await checkPasswordPwned(PW)).toEqual({ pwned: false, count: 0, checkFailed: true })
  })

  test('empty password → not pwned, no request made', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch
    expect(await checkPasswordPwned('')).toEqual({ pwned: false, count: 0, checkFailed: false })
    expect(called).toBe(false)
  })
})
