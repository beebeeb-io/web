/**
 * §15 (decision 2326 = A) — core's `resolveRequestRow` is the ONE reader for a
 * request row. It opens BOTH the bound seal (HKDF info = the row's id bytes)
 * and the shipped empty-id seal, names the seal it opened, and returns a
 * DECRYPT-ONLY content reader — `decryptor()` for sequential reads,
 * `openFrame(...)` for a seek/range read. No raw content key reaches JS, so a
 * rename cannot be sealed under C: it goes through `sealRequestRename`, which
 * derives the string-convention key from the row's id.
 *
 * These tests exercise core directly through the same adapter production uses
 * (`resolveRequestRowWith`), over the committed WASM build:
 *  1. a shipped empty-id row reads (content + name);
 *  2. a bound row reads and says so;
 *  3. a range read opens one frame with `openFrame`, without the frames before
 *     it;
 *  4. a rename target is the string-convention key, never C — a name sealed by
 *     `sealRequestRename` opens under the derivation and NOT under C;
 *  5. an upper-repair name is refused / read-only;
 *  6. a foreign (F) id is refused, and `sealRequestRename` refuses it too.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { resolveRequestRowWith, type RequestRowResolution } from '../src/lib/request-row'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const FILE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const EMPTY = new Uint8Array()

const rPub = wasm.derive_x25519_public(RPRIV) as Uint8Array
const wrappedPriv = wasm.wrap_request_private(MASTER, EMPTY, RPRIV) as {
  wrapped: Uint8Array
  nonce: Uint8Array
}
const DERIVED = wasm.derive_file_key(MASTER, encoder.encode(FILE_ID)) as Uint8Array

function envelope(key: Uint8Array, name: string): string {
  const enc = wasm.encrypt_metadata(key, JSON.stringify({ name, mime_type: 'text/plain' })) as {
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
  return wasm.encodeMetadataEnvelope(enc.nonce, enc.ciphertext)
}

/** Seal C to the request's public key under `context` (the HKDF info). */
function sealContent(context: Uint8Array): { e_pub: Uint8Array; wrapped_key: Uint8Array } {
  return wasm.seal_to_request(rPub, context, CONTENT) as {
    e_pub: Uint8Array
    wrapped_key: Uint8Array
  }
}

function resolve(
  sealed: { e_pub: Uint8Array; wrapped_key: Uint8Array },
  nameEncrypted: string,
  itemId = FILE_ID,
): RequestRowResolution {
  return resolveRequestRowWith(wasm, {
    masterKey: MASTER,
    itemId,
    requestWrapContext: EMPTY,
    wrappedRequestPrivate: wrappedPriv.wrapped,
    wrapNonce: wrappedPriv.nonce,
    senderEphemeralPubkey: sealed.e_pub,
    wrappedContentKey: sealed.wrapped_key,
    nameEncrypted,
  })
}

/** One v1 wire frame (`nonce || ciphertext || tag`) sealed under C. */
function v1Frame(plaintext: Uint8Array): Uint8Array {
  const enc = wasm.encrypt_chunk(CONTENT, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const frame = new Uint8Array(enc.nonce.length + enc.ciphertext.length)
  frame.set(enc.nonce, 0)
  frame.set(enc.ciphertext, enc.nonce.length)
  return frame
}

const NAME_UNDER_C = envelope(CONTENT, 'original.txt')

describe('§15: core opens a request row and hands back a decrypt-only reader', () => {
  test('a shipped empty-id row reads: content via decryptor(), name under C', () => {
    const row = resolve(sealContent(EMPTY), NAME_UNDER_C)

    expect(row.seal).toBe('unbound')
    expect(row.name).toBe('original.txt')
    expect(row.mimeType).toBe('text/plain')
    expect(row.nameOrigin).toBe('request_content')
    expect(row.content.fileId).toBe(FILE_ID)

    const plaintext = new Uint8Array([1, 2, 3, 4, 5])
    const decryptor = row.content.decryptor()
    expect(Array.from(decryptor.pushFrame(v1Frame(plaintext)) as Uint8Array)).toEqual(Array.from(plaintext))
    decryptor.finish()
  })

  test('a bound row reads and names its seal bound', () => {
    const row = resolve(sealContent(encoder.encode(FILE_ID)), envelope(CONTENT, 'bound.txt'))

    expect(row.seal).toBe('bound')
    expect(row.name).toBe('bound.txt')
    const plaintext = new Uint8Array([9, 8, 7])
    const decryptor = row.content.decryptor()
    expect(Array.from(decryptor.pushFrame(v1Frame(plaintext)) as Uint8Array)).toEqual(Array.from(plaintext))
    decryptor.finish()
  })

  test('a range read opens one frame with openFrame, without the frames before it', () => {
    const row = resolve(sealContent(EMPTY), NAME_UNDER_C)
    const first = new Uint8Array([0xaa, 0xbb])
    const second = new Uint8Array([0xcc, 0xdd, 0xee])

    // Seek straight to chunk 1: no chunk 0 was pushed through this reader.
    const out = row.content.openFrame(EMPTY, 1, true, 1, v1Frame(second))
    expect(Array.from(out as Uint8Array)).toEqual(Array.from(second))
    // Chunk 0 still opens on its own (nothing was consumed by the seek).
    const head = row.content.openFrame(EMPTY, 0, false, 1, v1Frame(first))
    expect(Array.from(head as Uint8Array)).toEqual(Array.from(first))
  })

  test('a rename target is the string key, never C, and a rename seals under it', () => {
    const row = resolve(sealContent(EMPTY), NAME_UNDER_C)
    expect(row.renameTarget).not.toBeNull()
    expect(row.renameTarget!.origin).toBe('derived')

    // The only rename path core offers: no key leaves the resolver.
    const renamed = wasm.sealRequestRename(MASTER, FILE_ID, row.renameTarget!.pin, 'renamed.txt', 'text/plain')
    const { nonce, ciphertext } = wasm.decodeMetadataEnvelope(renamed) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    // It opens under the derived key and NOT under C — a rename never goes under C.
    expect(JSON.parse(wasm.decrypt_metadata(DERIVED, nonce, ciphertext) as string).name).toBe('renamed.txt')
    expect(() => wasm.decrypt_metadata(CONTENT, nonce, ciphertext)).toThrow()

    // A reader of the renamed row resolves the name under the derivation.
    const again = resolve(sealContent(EMPTY), renamed)
    expect(again.name).toBe('renamed.txt')
    expect(again.nameOrigin).toBe('derived')
  })

  test('an upper-repair name is refused on an unbound row (read-only, never a rename under it)', () => {
    const upper = FILE_ID.toUpperCase()
    const upperKey = wasm.derive_file_key(MASTER, encoder.encode(upper)) as Uint8Array
    expect(() => resolve(sealContent(EMPTY), envelope(upperKey, 'up.txt'))).toThrow(
      /unbound convention refusal|upper_repair/i,
    )
  })

  test('a foreign (F) id is refused, and sealRequestRename refuses it too', () => {
    const foreignId = wasm.mintGuestItemId()
    expect(wasm.isForeignItemId(foreignId)).toBe(true)
    expect(() => resolve(sealContent(EMPTY), NAME_UNDER_C, foreignId)).toThrow(/class check|foreign/i)
    expect(() => wasm.sealRequestRename(MASTER, foreignId, 0, 'x.txt', null)).toThrow(/class check|foreign/i)
  })
})
