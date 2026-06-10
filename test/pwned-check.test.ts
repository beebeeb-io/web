import { describe, expect, test, afterEach } from 'bun:test'
import { pwnedPasswordCount } from '../src/lib/pwned-check'

// SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
//   prefix (sent)   = 5BAA6
//   suffix (local)  = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const PW = 'password'
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('pwnedPasswordCount — HIBP k-anonymity (0723)', () => {
  test('sends ONLY the 5-char SHA-1 prefix (never the password or full hash) + returns the count', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url)
      // a padded count-0 line + the real match
      return new Response(`00000000000000000000000000000000000:0\n${SUFFIX}:3730471`, { status: 200 })
    }) as unknown as typeof fetch
    const count = await pwnedPasswordCount(PW)
    // The request URL is EXACTLY the prefix endpoint — nothing else is sent.
    expect(calledUrl).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    // The 35-char suffix (the rest of the hash) never leaves the browser.
    expect(calledUrl.includes(SUFFIX)).toBe(false)
    expect(count).toBe(3730471)
  })

  test('suffix absent from the range response → 0 (not breached)', async () => {
    globalThis.fetch = (async () =>
      new Response('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9', { status: 200 })) as unknown as typeof fetch
    expect(await pwnedPasswordCount(PW)).toBe(0)
  })

  test('HIBP unreachable (fetch throws) → null (fail open)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await pwnedPasswordCount(PW)).toBeNull()
  })

  test('HIBP non-200 → null (fail open)', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    expect(await pwnedPasswordCount(PW)).toBeNull()
  })

  test('empty password → 0, no request made', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch
    expect(await pwnedPasswordCount('')).toBe(0)
    expect(called).toBe(false)
  })
})
