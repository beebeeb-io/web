import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'

// Run the passphrase stretch and combineFolderLinkKey against the committed
// WASM build; the worker hop is the only thing skipped.
await mockModuleScoped('../src/lib/crypto', import.meta.dir, () => ({
  ...ownedFolderCrypto(),
  combineFolderLinkKey: async (key: Uint8Array, stretch: Uint8Array | null) =>
    loadWasm().combineFolderLinkKey(key, stretch) as Uint8Array,
}))

const {
  LINK_PASSPHRASE_SALT_LABEL,
  deriveLinkPassphraseKey,
  generateLinkKey,
  linkKeyFragment,
  linkUnwrapKey,
  readLinkKeyFragment,
  resolveGuestFolderKey,
  unwrapFolderKeyFromLink,
  wrapFolderKeyForLink,
} = await import('../src/lib/shared-folder-link-crypto')

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
})
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  writable: true,
  value: { hash: '' },
})

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const KC = new Uint8Array(Array.from({ length: 32 }, (_, i) => 0x80 + i))
const STRETCH = new Uint8Array(Array.from({ length: 32 }, (_, i) => 0xa0 + i))

let calls: Array<{ url: string; init: RequestInit }> = []
let next: () => Response = () => new Response('{}', { status: 200 })
const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url)
    // Only the guest routes under test are intercepted; anything else falls
    // through to the real fetch so a concurrently running file's transport is
    // never answered from this queue.
    if (!target.includes('/api/v1/f/')) return originalFetch(url, init)
    calls.push({ url: target, init: init ?? {} })
    return next()
  }) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
})
beforeEach(() => {
  calls = []
  store.clear()
  next = () => new Response('{}', { status: 200 })
  ;(globalThis as unknown as { location: { hash: string } }).location.hash = ''
})

describe('link key fragments (2237b)', () => {
  test('a 32-byte key round-trips through #key=', () => {
    const key = generateLinkKey()
    expect(key.length).toBe(32)
    expect(readLinkKeyFragment(`#key=${linkKeyFragment(key)}`)).toEqual(key)
  })

  test('a malformed fragment is null', () => {
    expect(readLinkKeyFragment('#key=zz')).toBeNull()
    expect(readLinkKeyFragment('')).toBeNull()
    expect(readLinkKeyFragment(`#key=${linkKeyFragment(new Uint8Array(31))}`)).toBeNull()
  })
})

describe('link unwrap key (2237b)', () => {
  test('matches the core test vector byte for byte', async () => {
    expect(hex(await linkUnwrapKey(KC, null))).toBe(
      '5fb510b7068bfa1e9290e8a8ed296da4f610e5451a567699dc48e9bc3bd1badc',
    )
    expect(hex(await linkUnwrapKey(KC, STRETCH))).toBe(
      '1b87f03afb4b81c4b17c1a6f74648a4e725d1d5c1e0750b5767df89ee653b13b',
    )
  })

  test('salt label is the documented one', () => {
    expect(LINK_PASSPHRASE_SALT_LABEL).toBe('beebeeb-folder-link-passphrase-v1')
  })
})

describe('folder key wrapping (2237b)', () => {
  test('a link wrap is 60 bytes and round-trips', async () => {
    const folderKey = generateLinkKey()
    const linkKey = new Uint8Array(await linkUnwrapKey(KC, null))
    const wrapped = await wrapFolderKeyForLink(folderKey, linkKey)
    const wire = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0))
    expect(wire.length).toBe(60)
    expect(wrapped.length).toBe(80)
    expect(await unwrapFolderKeyFromLink(wrapped, linkKey)).toEqual(folderKey)
  })

  test('a different link key does not open the wrap', async () => {
    const folderKey = generateLinkKey()
    const wrapped = await wrapFolderKeyForLink(folderKey, new Uint8Array(await linkUnwrapKey(KC, null)))
    await expect(
      unwrapFolderKeyFromLink(wrapped, new Uint8Array(await linkUnwrapKey(KC, STRETCH))),
    ).rejects.toThrow()
  })

  test('passphrase and link are both required', async () => {
    const folderKey = generateLinkKey()
    const passphraseKey = new Uint8Array(await linkUnwrapKey(KC, STRETCH))
    const wrapped = await wrapFolderKeyForLink(folderKey, passphraseKey)

    // the stretch alone, without K_c, is not the unwrap key
    await expect(unwrapFolderKeyFromLink(wrapped, STRETCH)).rejects.toThrow()
    // K_c alone (no stretch) is not it either
    await expect(
      unwrapFolderKeyFromLink(wrapped, new Uint8Array(await linkUnwrapKey(KC, null))),
    ).rejects.toThrow()
    // another link key is not it
    await expect(
      unwrapFolderKeyFromLink(wrapped, new Uint8Array(await linkUnwrapKey(generateLinkKey(), STRETCH))),
    ).rejects.toThrow()
  })
})

describe('passphrase stretch (2237b)', () => {
  test('is token-bound and 32 bytes', async () => {
    const a = await deriveLinkPassphraseKey('abc', 'tok')
    const c = await deriveLinkPassphraseKey('abc', 'other')
    expect(a.length).toBe(32)
    expect(a).not.toEqual(c)
  })

  test("is core's stretch (L6): the pinned vector, NFC and NFD alike", async () => {
    const vectors = JSON.parse(
      await Bun.file(new URL('./vectors/core-vectors.v11.json', import.meta.url)).text(),
    ) as { vectors: Array<Record<string, string>> }
    for (const name of ['folder_link_passphrase', 'folder_link_passphrase_nfd']) {
      const v = vectors.vectors.find((entry) => entry.name === name)!
      expect(hex(await deriveLinkPassphraseKey(v.passphrase, v.token))).toBe(v.stretch_hex)
    }
  })

  test('a blank passphrase is refused before any stretch', async () => {
    await expect(deriveLinkPassphraseKey('   ', 'tok')).rejects.toThrow(/empty/)
    await expect(deriveLinkPassphraseKey('', 'tok')).rejects.toThrow(/empty/)
  })
})

describe('resolveGuestFolderKey (2237b)', () => {
  test('a passphrase link with no proof asks for the passphrase once', async () => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash =
      `#key=${linkKeyFragment(KC)}`
    next = () => Response.json({ passphrase_required: true })
    expect(await resolveGuestFolderKey('tok', null)).toEqual({ kind: 'passphrase_required' })
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/f/tok')
    expect(calls.some((call) => call.url.includes('/verify'))).toBe(false)
  })

  test('an expired proof is cleared and the passphrase is asked for again', async () => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash =
      `#key=${linkKeyFragment(KC)}`
    store.set('beebeeb.folderLink.proof.tok', JSON.stringify({ proof: 'p', expiresAt: 1 }))
    next = () => Response.json({ passphrase_required: true })
    expect(
      await resolveGuestFolderKey('tok', { token: 'tok', proof: 'p', expiresAt: 1 }),
    ).toEqual({ kind: 'passphrase_required' })
    expect(store.has('beebeeb.folderLink.proof.tok')).toBe(false)
  })

  test('a 404 is not_available', async () => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash =
      `#key=${linkKeyFragment(KC)}`
    next = () => Response.json({ error: 'not_found' }, { status: 404 })
    expect(await resolveGuestFolderKey('tok', null)).toEqual({ kind: 'not_available' })
  })

  test('a protected link keeps no raw key in storage and prompts after reload', async () => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash =
      `#key=${linkKeyFragment(KC)}`
    const folderKey = new Uint8Array(32).fill(0x11)
    const wrap = await wrapFolderKeyForLink(folderKey, await linkUnwrapKey(KC, STRETCH))
    next = () =>
      Response.json({
        folder_id: 'folder',
        root_name_encrypted: 'enc',
        access_level: 'view',
        label_encrypted: null,
        expires_at: null,
        passphrase_protected: true,
        wrapped_folder_key: wrap,
        key_version: 1,
        cap_bytes: null,
        cap_used_bytes: 0,
      })

    const first = await resolveGuestFolderKey('tok', null, STRETCH)
    expect(first.kind).toBe('unlocked')
    expect(store.has('beebeeb.folderLink.key.tok')).toBe(false)

    const second = await resolveGuestFolderKey('tok', null, null)
    expect(second.kind).toBe('passphrase_required')
    // Proof that the wrap alone cannot be opened with K_c: a plain K_c unwrap
    // of the same blob is a different key, so the cache is doing the work.
    const plain = await unwrapFolderKeyFromLink(wrap, await linkUnwrapKey(KC, null)).catch(() => null)
    expect(plain === null || Array.from(plain).join() !== Array.from(folderKey).join()).toBe(true)
  })

  test('a missing fragment key is not_available before any request', async () => {
    expect(await resolveGuestFolderKey('tok', null)).toEqual({ kind: 'not_available' })
    expect(calls.length).toBe(0)
  })
})

describe('link passphrase form (crypto review: NFC, never empty)', () => {
  test('NFC: one code point and e + combining accent are the same passphrase', async () => {
    const { normalizeLinkPassphrase } = await import('../src/lib/link-passphrase')
    const composed = 'café'
    const decomposed = 'café'
    expect(composed).not.toBe(decomposed)
    expect(normalizeLinkPassphrase(decomposed)).toBe(composed)
    // Otherwise exactly as typed: spaces inside or around are part of it.
    expect(normalizeLinkPassphrase(' a b ')).toBe(' a b ')
  })

  test('the stretch of both spellings is the same key', async () => {
    const a = await deriveLinkPassphraseKey('café', 'tok')
    const b = await deriveLinkPassphraseKey('café', 'tok')
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  test('empty or whitespace-only is refused, before any stretch', async () => {
    const { normalizeLinkPassphrase, EmptyLinkPassphraseError } = await import('../src/lib/link-passphrase')
    for (const empty of ['', ' ', '\t\n', ' ']) {
      expect(() => normalizeLinkPassphrase(empty)).toThrow(EmptyLinkPassphraseError)
      await expect(deriveLinkPassphraseKey(empty, 'tok')).rejects.toThrow(EmptyLinkPassphraseError)
    }
  })
})
