import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// Run deriveKeys and combineFolderLinkKey against the committed WASM build;
// the worker hop is the only thing skipped.
await mockModuleScoped('../src/lib/crypto', import.meta.dir, () => ({
  deriveKeys: async (password: string, salt: Uint8Array) => ({
    masterKey: loadWasm().derive_master_key(password, salt).key as Uint8Array,
  }),
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

  test('a protected link keeps its opened key so a reload does not ask again', async () => {
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

    // A reload has the proof but not the passphrase stretch: the key cached
    // under sessionStorage is the only thing that opens the wrap.
    const second = await resolveGuestFolderKey('tok', null, null)
    expect(second.kind).toBe('unlocked')
    if (second.kind === 'unlocked') {
      expect(Array.from(second.value.folderKey)).toEqual(Array.from(folderKey))
    }
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
