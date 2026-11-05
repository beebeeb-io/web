// W-P3-2: the metadata envelope (a stored name/note/metadata blob) has ONE
// grammar, and it is core's. `lib/crypto.ts` no longer has an encoder or a
// decoder of its own: both hop to the worker, which runs `metadata_wire`.
//
// The vector is core's own `test-vectors/consolidation/envelope.json`
// (metadata_wire::serialize_encrypted_metadata + MetadataEnvelope::decode),
// inlined case for case. The decode cases are every form a client has stored:
// numeric byte arrays with an optional `cipher_suite`, base64 with no suite, a
// null suite, unknown fields, Swift's short `n`/`c`, and mixed encodings; the
// error cases are the ones core refuses. The encode cases pin the frozen
// writer: core's canonical form is
// `{"ciphertext":"<base64>","nonce":"<base64>"}` — base64, no cipher_suite.
//
// Second half: the REAL `serializeEncryptedBlob`/`parseEncryptedBlob` from
// `lib/crypto.ts`, with only `withProxy` stubbed to a worker that runs the
// committed WASM build (the worker itself cannot load under bun test). The
// reader is core's. The writer is NOT core's encoder (LD-0071): the server's
// name validator refuses core's base64 form with a 400, so web writes
// `{"cipher_suite":"V1Aes256Gcm","nonce":[…],"ciphertext":[…]}` again, the form
// CLI and mobile write (LD-0072 decides the one canonical form). A name in
// either form opens: the reader always accepted both.
import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as wasm from 'beebeeb-wasm'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { decodeEnvelope, encodeEnvelope } from '../src/lib/metadata-envelope'

const NONCE_HEX = '000102030405060708090a0b'
const CIPHERTEXT_HEX = '101112131415161718191a1b1c1d1e1f'
const CANONICAL = '{"ciphertext":"EBESExQVFhcYGRobHB0eHw==","nonce":"AAECAwQFBgcICQoL"}'
/** What web's local writer produced before W-P3-2 — still accepted on read. */
const OLD_WEB_FORMAT = `{"cipher_suite":"V1Aes256Gcm","nonce":[0,1,2,3,4,5,6,7,8,9,10,11],"ciphertext":[16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]}`

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(() => {
  const wasmPath = fileURLToPath(new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url))
  wasm.initSync({ module: readFileSync(wasmPath) })
})

// The worker methods `withProxy` would reach, bound to the committed build.
const worker = {
  async encodeMetadataEnvelope(nonce: Uint8Array, ciphertext: Uint8Array): Promise<string> {
    return encodeEnvelope(wasm, nonce, ciphertext)
  },
  async decodeMetadataEnvelope(payload: string): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
    return decodeEnvelope(wasm, payload)
  },
}

await mockModuleScoped('../src/lib/crypto/service', import.meta.dir, {
  withProxy: async (fn: (proxy: typeof worker) => unknown) => fn(worker),
})
const { serializeEncryptedBlob, parseEncryptedBlob } = await import('../src/lib/crypto')

interface DecodeCase {
  id: string
  payload: string
  expected: { cipher_suite: string | null; nonce_hex: string; ciphertext_hex: string }
}

describe('W-P3-2 metadata envelope from core', () => {
  it('core envelope vector: every stored form decodes; web writes the server form', async () => {
    const decode: DecodeCase[] = [
      {
        id: 'envelope_canonical_present',
        payload:
          '{"cipher_suite":"V1Aes256Gcm","nonce":[0,1,2,3,4,5,6,7,8,9,10,11],"ciphertext":[16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]}',
        expected: { cipher_suite: 'V1Aes256Gcm', nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_absent_cipher_suite',
        payload: '{"nonce":"AAECAwQFBgcICQoL","ciphertext":"EBESExQVFhcYGRobHB0eHw=="}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_null_cipher_suite',
        payload: '{"cipher_suite":null,"nonce":"AAECAwQFBgcICQoL","ciphertext":"EBESExQVFhcYGRobHB0eHw=="}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_unknown_field',
        payload:
          '{"nonce":"AAECAwQFBgcICQoL","ciphertext":"EBESExQVFhcYGRobHB0eHw==","chunk_format":2,"future":{"nested":true}}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_numeric_arrays',
        payload:
          '{"nonce":[0,1,2,3,4,5,6,7,8,9,10,11],"ciphertext":[16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_short_keys',
        payload: '{"n":"AAECAwQFBgcICQoL","c":"EBESExQVFhcYGRobHB0eHw=="}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
      {
        id: 'envelope_mixed_encodings',
        payload: '{"nonce":"AAECAwQFBgcICQoL","ciphertext":[16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]}',
        expected: { cipher_suite: null, nonce_hex: NONCE_HEX, ciphertext_hex: CIPHERTEXT_HEX },
      },
    ]
    for (const c of decode) {
      const envelope = wasm.decodeMetadataEnvelope(c.payload) as {
        cipher_suite: string | null
        nonce: Uint8Array
        ciphertext: Uint8Array
      }
      expect(envelope.cipher_suite, c.id).toBe(c.expected.cipher_suite)
      expect(toHex(Uint8Array.from(envelope.nonce)), c.id).toBe(c.expected.nonce_hex)
      expect(toHex(Uint8Array.from(envelope.ciphertext)), c.id).toBe(c.expected.ciphertext_hex)
      // The same bytes through web's reader (`lib/crypto.ts` → worker).
      const bytes = await parseEncryptedBlob(c.payload)
      expect(toHex(bytes.nonce), c.id).toBe(c.expected.nonce_hex)
      expect(toHex(bytes.ciphertext), c.id).toBe(c.expected.ciphertext_hex)
    }

    for (const payload of [
      '{}',
      '{"cipher_suite":"V9Future","nonce":"AAECAwQFBgcICQoL","ciphertext":"EBESExQVFhcYGRobHB0eHw=="}',
      '{"nonce":null,"ciphertext":"EBESExQVFhcYGRobHB0eHw=="}',
      '{"nonce":[256],"ciphertext":[0]}',
      'not json at all',
    ]) {
      expect(() => wasm.decodeMetadataEnvelope(payload), payload).toThrow()
      await expect(parseEncryptedBlob(payload)).rejects.toThrow()
    }

    const nonce = hexToBytes(NONCE_HEX)
    const ciphertext = hexToBytes(CIPHERTEXT_HEX)
    // Core's encoder is frozen to its canonical form and never writes
    // `cipher_suite`; web's writer emits the server's form instead (LD-0071).
    expect(wasm.encodeMetadataEnvelope(nonce, ciphertext)).toBe(CANONICAL)
    expect(await serializeEncryptedBlob(nonce, ciphertext)).toBe(OLD_WEB_FORMAT)
  })

  it('a name in core canonical form still opens; new names use the server form', async () => {
    const fileKey = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = JSON.stringify({ name: 'Q3 report.pdf', mime_type: 'application/pdf' })

    // A row written by the old web writer (numeric arrays + cipher_suite).
    const sealed = wasm.encrypt_metadata(fileKey, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const oldStored = JSON.stringify({
      cipher_suite: 'V1Aes256Gcm',
      nonce: Array.from(sealed.nonce),
      ciphertext: Array.from(sealed.ciphertext),
    })
    const reopened = wasm.decrypt_name_metadata_with_key(fileKey, oldStored) as { name: string; mime_type: string | null }
    expect(reopened.name).toBe('Q3 report.pdf')
    expect(reopened.mime_type).toBe('application/pdf')

    // A row in core's canonical form (written by web b01422e6 on routes the
    // server does not validate) opens too.
    const coreStored = JSON.stringify({
      ciphertext: Buffer.from(sealed.ciphertext).toString('base64'),
      nonce: Buffer.from(sealed.nonce).toString('base64'),
    })
    expect((wasm.decrypt_name_metadata_with_key(fileKey, coreStored) as { name: string }).name).toBe('Q3 report.pdf')

    // A new write: web's writer emits the server's form (LD-0071), and core's
    // reader (and web's own reader) open it to the same name.
    const stored = await serializeEncryptedBlob(sealed.nonce, sealed.ciphertext)
    expect(stored).toBe(oldStored)
    const readBack = wasm.decrypt_name_metadata_with_key(fileKey, stored) as { name: string }
    expect(readBack.name).toBe('Q3 report.pdf')
    const bytes = await parseEncryptedBlob(stored)
    expect(toHex(bytes.nonce)).toBe(toHex(sealed.nonce))
    expect(toHex(bytes.ciphertext)).toBe(toHex(sealed.ciphertext))
  })
})
