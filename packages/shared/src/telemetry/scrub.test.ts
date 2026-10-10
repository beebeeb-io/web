import { describe, expect, it } from 'bun:test'
import { scrubText, scrubFrames } from './scrub'
import { SCRUB_VECTORS } from './scrub.fixture'

describe('scrubText', () => {
  for (const v of SCRUB_VECTORS) {
    it(`scrubs: ${v.name}`, () => {
      const out = scrubText(v.input)
      for (const forbidden of v.mustNotContain) expect(out).not.toContain(forbidden)
      for (const expected of v.mustContain) expect(out).toContain(expected)
    })
  }

  it('is total — never throws on hostile input', () => {
    expect(() => scrubText('\0'.repeat(1000))).not.toThrow()
    expect(scrubText('')).toBe('')
  })

  it('bounds output length', () => {
    expect(scrubText('a'.repeat(5000)).length).toBeLessThanOrEqual(201)
  })
})

describe('scrubFrames', () => {
  it('keeps only basename, function, lineno, colno', () => {
    const stack = [
      'TypeError: nope',
      '    at uploadEncryptedFileNative (/Users/guuslangelaar/Development/Beebeeb/repos/web/src/lib/api.ts:1346:12)',
      '    at async handleUpload (https://app.beebeeb.io/assets/index-a1b2.js:99:3)',
    ].join('\n')
    const frames = scrubFrames(stack)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual({ filename: 'api.ts', function: 'uploadEncryptedFileNative', lineno: 1346, colno: 12 })
    expect(frames[1].filename).toBe('index-a1b2.js')
    expect(JSON.stringify(frames)).not.toContain('guuslangelaar')
  })

  it('returns [] for a missing stack', () => {
    expect(scrubFrames(undefined)).toEqual([])
  })
})

// Task 1884 part 3 — parity with repos/server/beebeeb-api/src/sentry_scrub.rs
// (IPs, bearer tokens). Added red-first: scrubText previously let both through.
describe('scrubText: server-parity categories (1884)', () => {
  it('removes IPv4 addresses', () => {
    const out = scrubText('connect ECONNREFUSED 203.0.113.42 via 10.200.200.10')
    expect(out).not.toContain('203.0.113.42')
    expect(out).not.toContain('10.200.200.10')
  })

  it('removes IPv6 addresses (full and ::-compressed)', () => {
    const out = scrubText('peer 2001:db8:85a3:0:0:8a2e:370:7334 and 2001:db8::ff00:42:8329')
    expect(out).not.toContain('2001:db8')
    expect(out).not.toContain('8a2e')
    expect(out).not.toContain('ff00:42')
  })

  it('removes Bearer tokens, including non-url-safe base64', () => {
    const out = scrubText('401 Authorization: Bearer abc+secret/foo== rejected')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('abc+')
  })

  it('keeps frame-like line:col positions readable', () => {
    expect(scrubText('failed at api.ts:1346:12')).toContain('1346')
  })
})
