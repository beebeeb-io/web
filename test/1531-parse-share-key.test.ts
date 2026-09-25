import { describe, expect, test } from 'bun:test'
import {
  parseShareKey,
  extractShareKeyToken,
  decodeShareKeyToken,
  ShareKeyParseError,
  SHARE_KEY_BYTES,
} from '../src/lib/share-key'

/**
 * Task 1531 — share link: "Invalid key format" on a complete link.
 *
 * Root cause (confirmed live against the real local stack, see the task's PR
 * description for the full evidence): the automatic `#key=…` fragment path
 * (getKeyFromFragment) already normalized base64url ('-'/'_') before
 * decoding, but the MANUAL key-entry form (handleUnlock) called fromBase64()
 * — raw atob() — directly. Every share key is minted as base64url
 * (toBase64url() in share-dialog.tsx / share-link.ts), and a 43-char key has
 * a ~75% chance of containing '-' or '_' (P(none) = (62/64)^43 ≈ 25%), so
 * most manual pastes of a perfectly valid key threw "Invalid key format."
 *
 * parseShareKey() (src/lib/share-key.ts) is the one parser both paths now
 * share. These are its unit tests, run in isolation (no React, no DOM —
 * this repo's `bun test` harness has no jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

// A 32-byte fixture whose STANDARD base64 form contains BOTH '+' and '/', and
// whose base64url form contains BOTH '-' and '_' — so every test below
// exercises the full alphabet, not just one lucky character. Bytes:
// [17, 34, 51, ... (i*17+17) % 256 for i in 0..32].
const KEY_BYTES = [
  17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255, 16,
  33, 50, 67, 84, 101, 118, 135, 152, 169, 186, 203, 220, 237, 254, 15, 32,
]
const KEY_STD_PADDED = 'ESIzRFVmd4iZqrvM3e7/ECEyQ1RldoeYqbrL3O3+DyA=' // has '+' and '/'
const KEY_URL_UNPADDED = 'ESIzRFVmd4iZqrvM3e7_ECEyQ1RldoeYqbrL3O3-DyA' // has '-' and '_'

function expectKeyBytes(actual: Uint8Array): void {
  expect(Array.from(actual)).toEqual(KEY_BYTES)
}

describe('parseShareKey() — bare keys', () => {
  test('base64url, unpadded, with both "-" and "_" decodes to the 32 raw bytes', () => {
    expectKeyBytes(parseShareKey(KEY_URL_UNPADDED))
  })

  test('standard base64, padded, with both "+" and "/" decodes to the SAME 32 bytes', () => {
    expectKeyBytes(parseShareKey(KEY_STD_PADDED))
  })

  test('base64url WITH padding added back (still valid) decodes correctly', () => {
    expectKeyBytes(parseShareKey(KEY_URL_UNPADDED + '='))
  })

  test('leading/trailing whitespace is trimmed', () => {
    expectKeyBytes(parseShareKey(`  ${KEY_URL_UNPADDED}  \n`))
  })

  test('31-byte key (one char short of 32 bytes) is rejected as wrong-length', () => {
    // Drop the last full byte's worth of base64 (truncate to a shorter valid
    // base64 string that decodes to 31 bytes).
    const truncated = Buffer.from(KEY_BYTES.slice(0, 31)).toString('base64')
    expect(() => parseShareKey(truncated)).toThrow(ShareKeyParseError)
    try {
      parseShareKey(truncated)
      throw new Error('expected parseShareKey to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ShareKeyParseError)
      expect((e as ShareKeyParseError).reason).toBe('wrong-length')
    }
  })

  test('33-byte key (one byte too many) is rejected as wrong-length', () => {
    const extended = Buffer.from([...KEY_BYTES, 0xab]).toString('base64')
    expect(() => parseShareKey(extended)).toThrow(ShareKeyParseError)
    try {
      parseShareKey(extended)
      throw new Error('expected parseShareKey to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ShareKeyParseError)
      expect((e as ShareKeyParseError).reason).toBe('wrong-length')
    }
  })

  test('empty / whitespace-only input throws', () => {
    expect(() => parseShareKey('')).toThrow(ShareKeyParseError)
    expect(() => parseShareKey('   ')).toThrow(ShareKeyParseError)
  })

  test('garbage (non-base64) characters throw, never silently produce wrong bytes', () => {
    expect(() => parseShareKey('not a valid key at all!!')).toThrow(ShareKeyParseError)
  })

  test('SHARE_KEY_BYTES constant is 32 (AES-256 key size)', () => {
    expect(SHARE_KEY_BYTES).toBe(32)
  })
})

describe('parseShareKey() — "#key=…" fragments and full URLs (what the manual form must also accept)', () => {
  test('a bare "#key=<base64url>" fragment decodes correctly', () => {
    expectKeyBytes(parseShareKey(`#key=${KEY_URL_UNPADDED}`))
  })

  test('a "?key=<base64url>" query string decodes correctly', () => {
    expectKeyBytes(parseShareKey(`?key=${KEY_URL_UNPADDED}`))
  })

  test('a whole pasted share URL (base64url key) decodes correctly', () => {
    const url = `https://app.beebeeb.io/s/AbCdEf123-_Token#key=${encodeURIComponent(KEY_URL_UNPADDED)}`
    expectKeyBytes(parseShareKey(url))
  })

  test('a whole pasted share URL whose key is STANDARD base64 (percent-encoded "+"/"/"/"=") decodes correctly', () => {
    const url = `https://app.beebeeb.io/s/AbCdEf123Token#key=${encodeURIComponent(KEY_STD_PADDED)}`
    expectKeyBytes(parseShareKey(url))
  })

  test('a "#key=" fragment with additional params after "&" only takes the key value', () => {
    expectKeyBytes(parseShareKey(`#key=${KEY_URL_UNPADDED}&foo=bar`))
  })
})

describe('parseShareKey() — "+" must never be silently decoded as a space', () => {
  // This is the exact failure mode URLSearchParams has (application/
  // x-www-form-urlencoded semantics: '+' -> ' '). The OLD getKeyFromFragment()
  // used `new URLSearchParams(hash.slice(1))` to read the key, which would
  // have corrupted any standard-base64 key containing a literal '+'. This
  // module never calls URLSearchParams on the key value — verify directly.

  test('a LITERAL (non-percent-encoded) "+" in a "#key=" fragment decodes correctly, not as a space', () => {
    // KEY_STD_PADDED contains a literal '+'. A real URL fragment (unlike a
    // form-urlencoded query string) never auto-converts '+' to a space — but
    // URLSearchParams.get() would, if we ever routed the value through it.
    expectKeyBytes(parseShareKey(`#key=${KEY_STD_PADDED}`))
  })

  test('extractShareKeyToken preserves a literal "+" verbatim (does not become " ")', () => {
    const token = extractShareKeyToken(`#key=${KEY_STD_PADDED}`)
    expect(token).not.toBeNull()
    expect(token).not.toContain(' ')
    expect(token).toContain('+')
    expect(token).toBe(KEY_STD_PADDED)
  })

  test('decodeShareKeyToken on a token containing "+" and "/" decodes to the same bytes as its base64url twin', () => {
    const fromStd = decodeShareKeyToken(KEY_STD_PADDED)
    const fromUrl = decodeShareKeyToken(KEY_URL_UNPADDED)
    expect(Array.from(fromStd)).toEqual(Array.from(fromUrl))
  })
})

describe('extractShareKeyToken() — token location', () => {
  test('a bare key with no URL/marker returns the trimmed key itself', () => {
    expect(extractShareKeyToken(`  ${KEY_URL_UNPADDED}  `)).toBe(KEY_URL_UNPADDED)
  })

  test('a full URL with no "key=" marker at all returns null (never guesses)', () => {
    expect(extractShareKeyToken('https://app.beebeeb.io/s/AbCdEfToken')).toBeNull()
  })

  test('empty input returns null', () => {
    expect(extractShareKeyToken('')).toBeNull()
    expect(extractShareKeyToken('   ')).toBeNull()
  })
})

describe('extractShareKeyToken() — "key=" marker with NO leading "#"/"?"/"&" (Codex P2)', () => {
  // A paste of just "key=<value>" (no fragment/query punctuation in front,
  // e.g. someone copied only the trailing part of a share link) was not
  // recognised by the old marker regex /[#?&]key=/, which requires one of
  // '#', '?', '&' immediately before "key=". The whole string — including
  // the literal "key=" prefix — was then treated as the bare key and failed
  // to decode. Fixed marker: /(?:^|[#?&])key=/.

  test('a bare "key=<base64url>" paste with no leading marker punctuation decodes correctly', () => {
    expect(extractShareKeyToken(`key=${KEY_URL_UNPADDED}`)).toBe(KEY_URL_UNPADDED)
    expectKeyBytes(parseShareKey(`key=${KEY_URL_UNPADDED}`))
  })

  test('the same paste with surrounding whitespace decodes correctly', () => {
    expect(extractShareKeyToken(`  key=${KEY_URL_UNPADDED}  `)).toBe(KEY_URL_UNPADDED)
    expectKeyBytes(parseShareKey(`  key=${KEY_URL_UNPADDED}  `))
  })

  test('a bare key that merely CONTAINS "key=" mid-string (not at the start, not after "#"/"?"/"&") is never misread as a marker', () => {
    // "key=" appears at index 3 here, preceded by 'C' — not the start of the
    // string and not preceded by '#'/'?'/'&', so it must NOT be treated as a
    // marker; the whole string is the literal (bare) key/candidate.
    const literal = 'ABCkey=XYZ'
    expect(extractShareKeyToken(literal)).toBe(literal)
  })
})
