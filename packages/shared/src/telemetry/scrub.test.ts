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

// Task 1884 part 3 round 2 — Codex P1/P2 on web#163: the IPv6 matcher's trailing
// `\b` could not follow a colon (`2606:4700::`, `fe80::` leaked), and the
// uncompressed alternative accepted 3-8 groups (`12:34:56` was scrubbed as an IP).
describe('scrubText: IPv6 matcher (1884 r2)', () => {
  const MUST_SCRUB: Array<[string, string]> = [
    ['trailing :: run', 'blocked 2606:4700:: today'],
    ['trailing :: at end of string', 'peer 2606:4700::'],
    ['link-local bare', 'iface fe80:: up'],
    ['link-local with zone', 'bind fe80::1%en0 failed'],
    ['loopback', 'connect ::1 refused'],
    ['loopback in brackets (URL form)', 'GET http://[::1]:3001/x failed'],
    ['middle ::', 'peer 2001:db8::8a2e:370:7334 gone'],
    ['full 8 groups', 'peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334 gone'],
    ['full 8 groups short', 'peer 2001:db8:85a3:0:0:8a2e:370:7334 gone'],
    ['leading :: with several groups', 'peer ::ff00:42:8329 gone'],
    ['IPv4-mapped', 'peer ::ffff:203.0.113.42 gone'],
    ['uppercase', 'peer 2001:DB8::FF00:42 gone'],
  ]
  for (const [name, input] of MUST_SCRUB) {
    it(`scrubs: ${name}`, () => {
      const out = scrubText(input)
      expect(out).toContain('<ip>')
      // No hex group of the address may survive next to a colon.
      expect(out).not.toMatch(/[0-9A-Fa-f]{1,4}:[0-9A-Fa-f:]/)
      expect(out).not.toMatch(/::/)
      expect(out).not.toContain('203.0.113.42')
      expect(out).not.toContain('%en0')
    })
  }

  const MUST_KEEP: Array<[string, string]> = [
    ['clock time', 'failed at 12:34:56'],
    ['short time', 'retry at 12:34'],
    ['ISO timestamp', 'at 2026-10-10T12:34:56Z boom'],
    ['ISO timestamp with offset', 'at 2026-10-10T12:34:56+02:00 boom'],
    ['port', 'localhost:3001 refused'],
    ['frame position', 'api.ts:1346:12'],
    ['7 groups, no ::', 'a:b:c:d:e:f:1'],
    ['MAC address (parity with server scrubber; not an IP)', 'aa:bb:cc:dd:ee:ff'],
    ['bare ::', 'Error:: unexpected'],
  ]
  for (const [name, input] of MUST_KEEP) {
    it(`keeps: ${name}`, () => {
      const out = scrubText(input)
      expect(out).not.toContain('<ip>')
    })
  }

  it('keeps the surrounding text of a scrubbed address', () => {
    expect(scrubText('peer 2606:4700:: dropped')).toBe('peer <ip> dropped')
    expect(scrubText('bind fe80::1%en0 failed')).toBe('bind <ip> failed')
  })
})
