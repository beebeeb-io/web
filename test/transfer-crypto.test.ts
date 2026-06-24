import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initSync,
  transfer_generate_keypair,
  transfer_derive_key,
  transfer_derive_sas_bytes,
  transfer_sas_to_words,
  transfer_encrypt,
  transfer_decrypt,
  x25519_shared_secret,
} from 'beebeeb-wasm'

// The crypto.ts wrappers funnel through a Comlink worker that uses Vite-only
// `?url` imports — not loadable under `bun test`. So this round-trip exercises
// the REAL core crypto by initializing the same committed WASM the worker uses
// directly (read bytes → initSync), proving the key-agreement + AEAD that the
// receiver page relies on. The one piece of pure web logic — parsing the UUID
// session_id into its 16 raw salt bytes — is imported from crypto.ts itself.
import { sessionIdToBytes } from '../src/lib/crypto'

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

// A real UUID (as the server hands back) and its 16 raw bytes used as the HKDF
// salt for both the transfer key and the SAS derivation.
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('Constellation transfer crypto — real core round-trip', () => {
  test('session_id UUID → 16 raw salt bytes (hex, dashes stripped — not UTF-8)', () => {
    const bytes = sessionIdToBytes(SESSION_ID)
    expect(bytes.length).toBe(16)
    expect([...bytes.slice(0, 4)]).toEqual([0x55, 0x0e, 0x84, 0x00])
    expect([...bytes.slice(-2)]).toEqual([0x00, 0x00])
    // Reject the UTF-8-of-dashed-string mistake (would be 36 bytes).
    expect(bytes.length).not.toBe(SESSION_ID.length)
  })

  test('(a) both sides derive the SAME transfer key via ECDH + transfer_derive_key', () => {
    const sender = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const receiver = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const salt = sessionIdToBytes(SESSION_ID)

    // Sender: ECDH(sender_priv, receiver_pub); Receiver: ECDH(receiver_priv, sender_pub).
    const ssSender = x25519_shared_secret(sender.private, receiver.public)
    const ssReceiver = x25519_shared_secret(receiver.private, sender.public)
    expect([...ssReceiver]).toEqual([...ssSender])

    const keySender = transfer_derive_key(ssSender, salt)
    const keyReceiver = transfer_derive_key(ssReceiver, salt)
    expect(keySender.length).toBe(32)
    expect([...keyReceiver]).toEqual([...keySender])

    // SAS words also match on both sides (the MITM check) and there are 4.
    const sasSender = transfer_sas_to_words(transfer_derive_sas_bytes(ssSender, salt)) as string[]
    const sasReceiver = transfer_sas_to_words(transfer_derive_sas_bytes(ssReceiver, salt)) as string[]
    expect(sasSender.length).toBe(4)
    expect(sasReceiver).toEqual(sasSender)
  })

  test('(b) transferEncrypt → transferDecrypt round-trips an arbitrary payload', () => {
    const sender = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const receiver = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const salt = sessionIdToBytes(SESSION_ID)
    const ss = x25519_shared_secret(sender.private, receiver.public)
    const key = transfer_derive_key(ss, salt)

    const payload = new Uint8Array(1024)
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 11) & 0xff

    const blob = transfer_encrypt(key, payload)
    // Wire format is nonce(12) || ciphertext+tag → strictly larger than plaintext.
    expect(blob.length).toBeGreaterThan(payload.length + 12)

    const recovered = transfer_decrypt(key, blob)
    expect([...recovered]).toEqual([...payload])
  })

  test('(b) round-trips a UTF-8 filename (the file_name_hint path)', () => {
    const sender = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const receiver = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const salt = sessionIdToBytes(SESSION_ID)
    const ss = x25519_shared_secret(receiver.private, sender.public)
    const key = transfer_derive_key(ss, salt)

    const filename = 'rapport-financiën-2026 · final.pdf'
    const blob = transfer_encrypt(key, new TextEncoder().encode(filename))
    const recovered = new TextDecoder().decode(transfer_decrypt(key, blob))
    expect(recovered).toBe(filename)
  })

  test('a wrong key (mismatched ECDH) fails to decrypt — AEAD authenticity', () => {
    const sender = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const receiver = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const attacker = transfer_generate_keypair() as { public: Uint8Array; private: Uint8Array }
    const salt = sessionIdToBytes(SESSION_ID)

    const goodKey = transfer_derive_key(x25519_shared_secret(sender.private, receiver.public), salt)
    const blob = transfer_encrypt(goodKey, new TextEncoder().encode('secret'))

    // Attacker substituted their own pubkey → different shared secret → different key.
    const badKey = transfer_derive_key(x25519_shared_secret(sender.private, attacker.public), salt)
    expect(() => transfer_decrypt(badKey, blob)).toThrow()
  })
})
