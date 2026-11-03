import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildShareLink as coreBuildShareLink, parseShareLink as coreParseShareLink, shareKeyBytes } from 'beebeeb-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { buildFullShareLink } from '../src/lib/share-full-link'
import { decodeShareKeyToken, parseShareKey } from '../src/lib/share-key'

/**
 * The share-link vector (`test-vectors/consolidation/share_link.json`, core
 * 8b6446c) driven through the web builders: one grammar for `/s/`, `/f/`, any
 * host, both base64 alphabets, and the four cases the plan names — canonical,
 * legacy host, missing fragment, unicode key.
 *
 * Updated for core 2f5cd8a (#65): the parser now takes attacker-controlled
 * input, so a token must be in the route's canonical format — `/s/` is 27
 * URL-safe base64 chars (20 bytes), `/f/` is 43 (32 bytes) — a public host
 * must be `https`, and no userinfo or backslash is allowed.
 *
 * `share-full-link.ts` and `share-key.ts` own no rule of their own: the first
 * asks core to build, the second asks core to decode.
 */

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhM'
// A folder link's token is 32 bytes (43 chars), not the 20-byte file token.
const FOLDER_TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const B64URL_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const STD_KEY = '+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/s='
const B64URL_F_KEY = '-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s'

const KEY_HEX = 'fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(() => {
  loadWasm()
})

describe('build: one grammar, percent-encoded fragment, trailing slashes trimmed', () => {
  it('the web builder holds no grammar of its own — it calls core', () => {
    const source = readFileSync('src/lib/share-full-link.ts', 'utf8')
    expect(source).toContain("from 'beebeeb-wasm'")
    expect(source).toContain('coreBuildShareLink(')
    // The old local template: a base-URL replace plus the path/token/fragment join.
    expect(source).not.toContain("baseUrl.replace(")
    expect(source).not.toContain('#key=${')
  })

  it('canonical /s/ link', () => {
    const expected = `https://app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`
    expect(buildFullShareLink('https://app.beebeeb.io', TOKEN, B64URL_KEY)).toBe(expected)
    expect(coreBuildShareLink('https://app.beebeeb.io', TOKEN, B64URL_KEY, 's')).toBe(expected)
  })

  it('trailing slashes on the app URL never double up', () => {
    expect(buildFullShareLink('https://app.beebeeb.io///', TOKEN, B64URL_KEY)).toBe(
      `https://app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`,
    )
  })

  it('standard base64 is percent-encoded exactly as encodeURIComponent', () => {
    const built = buildFullShareLink('https://app.beebeeb.io', TOKEN, STD_KEY)
    expect(built).toBe(`https://app.beebeeb.io/s/${TOKEN}#key=${encodeURIComponent(STD_KEY)}`)
    expect(built).toContain('%2B')
    expect(built).not.toContain('+')
  })

  it('a folder link keeps /f/ and the same fragment encoding', () => {
    expect(buildFullShareLink('https://app.beebeeb.io', TOKEN, B64URL_F_KEY, 'f')).toBe(
      `https://app.beebeeb.io/f/${TOKEN}#key=${B64URL_F_KEY}`,
    )
  })

  it('a unicode key is percent-encoded as UTF-8', () => {
    const built = buildFullShareLink('https://app.beebeeb.io', TOKEN, '✓ k/ä')
    expect(built).toBe(`https://app.beebeeb.io/s/${TOKEN}#key=%E2%9C%93%20k%2F%C3%A4`)
    expect(built.endsWith(encodeURIComponent('✓ k/ä'))).toBe(true)
  })
})

describe('parse: /s/ and /f/ on any host, both alphabets, stable error codes', () => {
  it('canonical link', () => {
    const parsed = coreParseShareLink(`https://app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`) as {
      base_url: string
      route: string
      token: string
      key: string
    }
    expect(parsed).toEqual({
      base_url: 'https://app.beebeeb.io',
      route: 's',
      token: TOKEN,
      key: B64URL_KEY,
    })
    expect(hex(shareKeyBytes(parsed.key) as Uint8Array)).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    )
  })

  it('legacy host and extra query parameters keep the base URL prefix', () => {
    expect(coreParseShareLink(`https://beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`)).toMatchObject({
      base_url: 'https://beebeeb.io',
      route: 's',
    })
    expect(
      coreParseShareLink(`https://files.example.com/bb/s/${TOKEN}?utm=share&v=2#key=${B64URL_KEY}`),
    ).toMatchObject({
      base_url: 'https://files.example.com/bb',
      route: 's',
      token: TOKEN,
    })
  })

  it('a folder link parses on route "f"', () => {
    expect(coreParseShareLink(`https://app.beebeeb.io/f/${FOLDER_TOKEN}#key=${B64URL_F_KEY}`)).toMatchObject({
      base_url: 'https://app.beebeeb.io',
      route: 'f',
      token: FOLDER_TOKEN,
      key: B64URL_F_KEY,
    })
  })

  it('a percent-encoded standard-base64 key decodes back to the same bytes', () => {
    const parsed = coreParseShareLink(
      `https://app.beebeeb.io/s/${TOKEN}#key=${encodeURIComponent(STD_KEY)}`,
    ) as { key: string }
    expect(parsed.key).toBe(STD_KEY)
    expect(hex(decodeShareKeyToken(parsed.key))).toBe(KEY_HEX)
  })

  it('a unicode key comes back as text', () => {
    const parsed = coreParseShareLink(`https://app.beebeeb.io/s/${TOKEN}#key=%E2%9C%93%20k%2F%C3%A4`) as {
      key: string
    }
    expect(parsed.key).toBe('✓ k/ä')
  })

  it('missing fragment / empty fragment / missing key / missing token / wrong route / not a URL', () => {
    const rows: Array<[string, string]> = [
      [`https://app.beebeeb.io/s/${TOKEN}`, 'missing_fragment'],
      [`https://app.beebeeb.io/s/${TOKEN}#`, 'missing_key'],
      [`https://app.beebeeb.io/s/${TOKEN}#foo=bar`, 'missing_key'],
      [`https://app.beebeeb.io/s/${TOKEN}#key=`, 'missing_key'],
      ['https://app.beebeeb.io/s/#key=' + B64URL_KEY, 'missing_token'],
      [`https://app.beebeeb.io/x/${TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
      ['nonsense', 'not_a_share_link'],
      // Core 2f5cd8a: the token format is per route, and a link must be https
      // with no userinfo or backslash (the parsers that read it treat `\` as `/`).
      [`https://app.beebeeb.io/f/${TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
      [`https://app.beebeeb.io/s/${FOLDER_TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
      [`https://app.beebeeb.io/s/..#key=${B64URL_KEY}`, 'not_a_share_link'],
      [`https://user:pass@app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
      [`https://evil.com\\@app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
      [`http://app.beebeeb.io/s/${TOKEN}#key=${B64URL_KEY}`, 'not_a_share_link'],
    ]
    for (const [url, code] of rows) {
      expect(() => coreParseShareLink(url)).toThrow(new RegExp(`^${code}:`))
    }
  })
})

describe('key bytes: both alphabets, padded or not, garbage refused', () => {
  it('standard padded / standard unpadded / base64url unpadded / base64url padded', () => {
    for (const key of [STD_KEY, STD_KEY.replace(/=$/, ''), B64URL_F_KEY, `${B64URL_F_KEY}=`]) {
      expect(hex(shareKeyBytes(key) as Uint8Array)).toBe(KEY_HEX)
      expect(hex(decodeShareKeyToken(key))).toBe(KEY_HEX)
    }
  })

  it('garbage is refused by core and by the web decoder alike', () => {
    expect(shareKeyBytes('not base64!')).toBeNull()
    expect(() => decodeShareKeyToken('not base64!')).toThrow(/invalid-characters/)
    // Characters in the alphabet but not valid base64 for this length.
    expect(() => decodeShareKeyToken('a')).toThrow(/invalid-base64/)
  })

  it('a whole pasted share URL yields the same 32 bytes through parseShareKey', () => {
    const url = buildFullShareLink('https://app.beebeeb.io', TOKEN, B64URL_KEY)
    expect(hex(parseShareKey(url))).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    )
  })
})
