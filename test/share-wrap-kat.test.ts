import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, encrypt_chunk, decrypt_chunk } from 'beebeeb-wasm'
import { wrapKeyForShare, unwrapKeyFromShare } from '../src/lib/crypto'

// ─── Cross-client share-wrap KAT (K3, task 1383) ────────────────────────────
//
// web's wrapKeyForShare/unwrapKeyFromShare (src/lib/crypto.ts) implement
// AES-256-GCM directly via WebCrypto, independently of core. Wire format:
// nonce(12) || AES-256-GCM-ciphertext(32-byte key + 16-byte tag) = 60 bytes,
// no AAD, no KDF (the "wrap key" is used as a raw AES-256 key). This is the
// exact format `beebeeb-core::encrypt::encrypt_chunk`/`decrypt_chunk` produce
// for a 32-byte plaintext. The pinned vector lives at
// `repos/core/test-vectors/vectors.json` (name `share_key_wrap`), generated
// by `repos/core/beebeeb-core/src/bin/generate_test_vectors.rs`.
//
// We prove interop two ways:
//  (1) Pinned KAT — web's real unwrapKeyFromShare must decrypt core's frozen
//      vector to the exact expected key. A tampered ciphertext must fail the
//      GCM auth tag (proven once, see test 1b).
//  (2) Live cross-implementation — the REAL compiled core code (via the
//      committed beebeeb-wasm build) encrypts/decrypts against web's REAL
//      production wrapKeyForShare/unwrapKeyFromShare, in both directions.
//      wrapKeyForShare generates its own random nonce internally, so rather
//      than adding a test-only nonce-injection point to production code, we
//      cross-check with the live WASM core using whatever nonce each side
//      actually produced — this is a stronger interop proof than a frozen
//      vector alone, since it exercises the current compiled implementations
//      on both ends, not just a historical snapshot.
//
// crypto.ts's Comlink/worker plumbing is import-time inert (the Worker is
// only constructed inside spawnWorker()), so wrapKeyForShare/
// unwrapKeyFromShare — which run on the main thread directly via
// crypto.subtle, no worker involved — are safely importable under `bun test`
// (same reasoning as search-index-kat.test.ts's WASM-direct approach).

// Pinned vector: repos/core/test-vectors/vectors.json → "share_key_wrap".
const WRAP_KEY_HEX = 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5'
const KEY_TO_WRAP_HEX = '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a'
const NONCE_HEX = '174e5553a15305c56b28ae60'
const CIPHERTEXT_HEX = '296c608d2b6150057284434cacb9ac684db811891e0e5b4cdb39cdec3ce53f99f1b5611f75edd9b75c2614e32bb5c596'

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

describe('share-wrap cross-client KAT (web wrapKeyForShare/unwrapKeyFromShare == core)', () => {
  test('(1) unwrapKeyFromShare decrypts the pinned core vector to the exact expected key', async () => {
    const wrapKey = hexToBytes(WRAP_KEY_HEX)
    const wrapped = hexToBytes(NONCE_HEX + CIPHERTEXT_HEX)
    expect(wrapped.length).toBe(60) // nonce(12) + ciphertext(48) — the K3 wire format

    const unwrapped = await unwrapKeyFromShare(wrapKey, wrapped)
    expect(toHex(unwrapped)).toBe(KEY_TO_WRAP_HEX)
  })

  test('(1b) a tampered ciphertext byte fails GCM authentication', async () => {
    const wrapKey = hexToBytes(WRAP_KEY_HEX)
    const wrapped = hexToBytes(NONCE_HEX + CIPHERTEXT_HEX)
    // Flip one bit in the ciphertext (leave the 12-byte nonce untouched).
    wrapped[15] ^= 0x01

    await expect(unwrapKeyFromShare(wrapKey, wrapped)).rejects.toThrow()
  })

  test('(2a) core (via WASM) encrypts -> web unwrapKeyFromShare decrypts to the same key', async () => {
    const wrapKey = hexToBytes(WRAP_KEY_HEX)
    const keyToWrap = hexToBytes(KEY_TO_WRAP_HEX)

    const encrypted = encrypt_chunk(wrapKey, keyToWrap) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    const wrapped = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length)
    wrapped.set(encrypted.nonce, 0)
    wrapped.set(encrypted.ciphertext, encrypted.nonce.length)
    expect(wrapped.length).toBe(60)

    const unwrapped = await unwrapKeyFromShare(wrapKey, wrapped)
    expect(toHex(unwrapped)).toBe(KEY_TO_WRAP_HEX)
  })

  test('(2b) web wrapKeyForShare encrypts -> core (via WASM) decrypts to the same key', async () => {
    const wrapKey = hexToBytes(WRAP_KEY_HEX)
    const keyToWrap = hexToBytes(KEY_TO_WRAP_HEX)

    const wrapped = await wrapKeyForShare(wrapKey, keyToWrap)
    expect(wrapped.length).toBe(60)
    const nonce = wrapped.slice(0, 12)
    const ciphertext = wrapped.slice(12)

    const decrypted = decrypt_chunk(wrapKey, nonce, ciphertext) as Uint8Array
    expect(toHex(new Uint8Array(decrypted))).toBe(KEY_TO_WRAP_HEX)
  })

  test('(2c) web wrapKeyForShare -> web unwrapKeyFromShare roundtrip (regression guard)', async () => {
    const wrapKey = hexToBytes(WRAP_KEY_HEX)
    const keyToWrap = hexToBytes(KEY_TO_WRAP_HEX)

    const wrapped = await wrapKeyForShare(wrapKey, keyToWrap)
    const unwrapped = await unwrapKeyFromShare(wrapKey, wrapped)
    expect(toHex(unwrapped)).toBe(KEY_TO_WRAP_HEX)
  })
})
