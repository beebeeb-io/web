/**
 * 2275 T5.7 / L16 — link labels are sealed under the owner's master key and
 * bound to the share id. A label for another link, or under another master
 * key, does not open; the wrap format is core's, with no web-side envelope.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const unb64 = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))

const w = loadWasm()
await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  wrapLinkLabel: async (masterKey: Uint8Array, shareId: string, label: string) =>
    w.wrapLinkLabel(masterKey, shareId, label) as Uint8Array,
  unwrapLinkLabel: async (masterKey: Uint8Array, shareId: string, wrapped: Uint8Array) =>
    w.unwrapLinkLabel(masterKey, shareId, wrapped) as string,
  toBase64: b64,
  fromBase64: unb64,
})

const { encryptLinkLabel, decryptLinkLabel } = await import('../src/lib/link-label')

const MASTER = new Uint8Array(32).fill(3)
const OTHER_MASTER = new Uint8Array(32).fill(4)
const SHARE = '11111111-1111-4111-8111-111111111111'
const OTHER_SHARE = '22222222-2222-4222-8222-222222222222'

describe('L16 link labels', () => {
  test('round-trips and never carries the label in the clear', async () => {
    const sealed = await encryptLinkLabel(MASTER, SHARE, 'Family WhatsApp')
    expect(sealed).not.toContain('Family')
    expect(await decryptLinkLabel(MASTER, SHARE, sealed)).toBe('Family WhatsApp')
  })

  test('a label for another link does not open', async () => {
    const sealed = await encryptLinkLabel(MASTER, SHARE, 'Family WhatsApp')
    expect(await decryptLinkLabel(MASTER, OTHER_SHARE, sealed)).toBeNull()
  })

  test('a label under another master key does not open', async () => {
    const sealed = await encryptLinkLabel(MASTER, SHARE, 'Family WhatsApp')
    expect(await decryptLinkLabel(OTHER_MASTER, SHARE, sealed)).toBeNull()
  })

  test('a missing or empty value yields null, never a throw', async () => {
    expect(await decryptLinkLabel(MASTER, SHARE, null)).toBeNull()
    expect(await decryptLinkLabel(MASTER, SHARE, '')).toBeNull()
    expect(await decryptLinkLabel(MASTER, SHARE, 'not-base64')).toBeNull()
  })
})
