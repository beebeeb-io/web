/**
 * 2275 §15 (decision 2326 = A) at the app layer: the request-row resolver.
 *
 * These exercise the SAME resolver production uses
 * (`createRequestRowResolverWith`), over an in-process engine built on the
 * committed wasm build (`createLocalRequestRowEngine`). Only the worker hop is
 * absent; core still resolves the row, opens the seal, decrypts the name and
 * hands back the decrypt-only reader.
 *
 *  1. a shipped empty-id row reads (content + name);
 *  2. a bound row reads and names its seal;
 *  3. a range read opens one frame through the resolver's source;
 *  4. a rename is sealed under the string convention and NOT under C;
 *  5. an upper-repair name is refused / read-only.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { toBase64 } from '../src/lib/crypto/helpers'
import type { FileRequest } from '../src/lib/api'
import {
  createLocalRequestRowEngine,
  createRequestRowResolverWith,
  RENAME_KEY_UNAVAILABLE,
} from '../src/lib/request-row-resolver'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const FILE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
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

function sealContent(context: Uint8Array): { e_pub: Uint8Array; wrapped_key: Uint8Array } {
  return wasm.seal_to_request(rPub, context, CONTENT) as {
    e_pub: Uint8Array
    wrapped_key: Uint8Array
  }
}

/** The server row the resolver is given (a subset of DriveFile). */
function row(
  sealed: { e_pub: Uint8Array; wrapped_key: Uint8Array },
  nameEncrypted: string,
  id = FILE_ID,
) {
  return {
    id,
    name_encrypted: nameEncrypted,
    file_request_id: REQUEST_ID,
    sender_ephemeral_pubkey: toBase64(sealed.e_pub),
    wrapped_content_key: toBase64(sealed.wrapped_key),
  }
}

/** The owner's `GET /file-requests` row for this request. */
function requestRow(): FileRequest {
  return {
    id: REQUEST_ID,
    wrapped_private_key: toBase64(wrappedPriv.wrapped),
    wrap_nonce: toBase64(wrappedPriv.nonce),
  } as FileRequest
}

function resolverFor(fileRow: ReturnType<typeof row>) {
  return createRequestRowResolverWith(
    createLocalRequestRowEngine(wasm, async () => [requestRow()]),
  )
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

describe('§15 resolver: request rows are read only through core', () => {
  test('a shipped empty-id row reads: content through the source, name under C', async () => {
    const resolver = resolverFor(row(sealContent(EMPTY), NAME_UNDER_C))
    const resolved = await resolver.resolveRow(row(sealContent(EMPTY), NAME_UNDER_C), MASTER)

    expect(resolved.seal).toBe('unbound')
    expect(resolved.name).toBe('original.txt')
    expect(resolved.mimeType).toBe('text/plain')
    expect(resolved.content.fileId).toBe(FILE_ID)

    const plaintext = new Uint8Array([1, 2, 3, 4, 5])
    const decryptor = await resolved.content.startStream()
    expect(Array.from(await decryptor.pushFrame(v1Frame(plaintext)))).toEqual(Array.from(plaintext))
    await decryptor.finish()
    resolver.clear()
  })

  test('a bound row reads and names its seal bound', async () => {
    const resolver = resolverFor(row(sealContent(encoder.encode(FILE_ID)), envelope(CONTENT, 'bound.txt')))
    const resolved = await resolver.resolveRow(
      row(sealContent(encoder.encode(FILE_ID)), envelope(CONTENT, 'bound.txt')),
      MASTER,
    )
    expect(resolved.seal).toBe('bound')
    expect(resolved.name).toBe('bound.txt')

    const plaintext = new Uint8Array([9, 8, 7])
    const decryptor = await resolved.content.startStream()
    expect(Array.from(await decryptor.pushFrame(v1Frame(plaintext)))).toEqual(Array.from(plaintext))
    await decryptor.finish()
    resolver.clear()
  })

  test('a range read opens one frame through openFrame, without the frames before it', async () => {
    const fileRow = row(sealContent(EMPTY), NAME_UNDER_C)
    const resolver = resolverFor(fileRow)
    const resolved = await resolver.resolveRow(fileRow, MASTER)
    const first = new Uint8Array([0xaa, 0xbb])
    const second = new Uint8Array([0xcc, 0xdd, 0xee])

    const out = await resolved.content.openFrame(EMPTY, 1, true, 1, v1Frame(second))
    expect(Array.from(out)).toEqual(Array.from(second))
    const head = await resolved.content.openFrame(EMPTY, 0, false, 1, v1Frame(first))
    expect(Array.from(head)).toEqual(Array.from(first))
    resolver.clear()
  })

  test('a rename is sealed under the string convention, never under C', async () => {
    const fileRow = row(sealContent(EMPTY), NAME_UNDER_C)
    const resolver = resolverFor(fileRow)
    const resolved = await resolver.resolveRow(fileRow, MASTER)
    expect(resolved.renameTarget).not.toBeNull()
    expect(resolved.renameTarget!.origin).toBe('derived')

    const renamed = await resolver.sealRename(fileRow, 'renamed.txt', MASTER)
    const { nonce, ciphertext } = wasm.decodeMetadataEnvelope(renamed) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    expect(JSON.parse(wasm.decrypt_metadata(DERIVED, nonce, ciphertext) as string).name).toBe('renamed.txt')
    expect(() => wasm.decrypt_metadata(CONTENT, nonce, ciphertext)).toThrow()

    // The resolver re-reads the renamed row under the derivation.
    const again = await resolver.resolveRow(row(sealContent(EMPTY), renamed), MASTER)
    expect(again.name).toBe('renamed.txt')
    expect(again.nameOrigin).toBe('derived')
    resolver.clear()
  })

  test('an upper-repair name is refused, and a read-only row cannot be renamed', async () => {
    // Unbound + upper-repair: core refuses the row outright (no C fallback).
    const upperKey = wasm.derive_file_key(MASTER, encoder.encode(FILE_ID.toUpperCase())) as Uint8Array
    const unboundUpper = row(sealContent(EMPTY), envelope(upperKey, 'up.txt'))
    await expect(resolverFor(unboundUpper).resolveRow(unboundUpper, MASTER)).rejects.toThrow(
      /unbound convention refusal|upper_repair/i,
    )

    // Bound + upper-repair: core reads it but marks it read-only (no target).
    const boundUpper = row(sealContent(encoder.encode(FILE_ID)), envelope(upperKey, 'up.txt'))
    const resolver = resolverFor(boundUpper)
    const resolved = await resolver.resolveRow(boundUpper, MASTER)
    expect(resolved.nameOrigin).toBe('derived_upper_repair')
    expect(resolved.renameTarget).toBeNull()
    await expect(resolver.sealRename(boundUpper, 'nope.txt', MASTER)).rejects.toThrow(RENAME_KEY_UNAVAILABLE)
    resolver.clear()
  })
})

/**
 * 2326 review P3-1: the rename target's pin is the row's RECORDED format and it
 * must survive the rename. Every other web fixture seals with `encrypt_metadata`
 * (pin 0), so hard-coding `pin: 0` in the resolver passed them all.
 */
describe('§15 resolver: a pin-2 row renames with pin 2', () => {
  test('sealRequestRename gets pin 2, the new name is subkey-sealed, pin and MIME survive', async () => {
    // The name writer records the pin (a v2 request upload: `encrypt_name_for`
    // with 2), which core reports as both chunkFormat and renameTarget.pin.
    const namePin2 = wasm.encrypt_name_for(CONTENT, 'clip.mp4', 'video/mp4', 2) as string
    const fileRow = row(sealContent(EMPTY), namePin2)
    const base = createLocalRequestRowEngine(wasm, async () => [requestRow()])
    const sealArgs: Array<{ pin: number; filename: string; mimeType: string | null }> = []
    const resolver = createRequestRowResolverWith({
      ...base,
      async sealRename(args) {
        sealArgs.push({ pin: args.pin, filename: args.filename, mimeType: args.mimeType })
        return base.sealRename(args)
      },
    })

    const resolved = await resolver.resolveRow(fileRow, MASTER)
    expect(resolved.chunkFormat).toBe(2)
    expect(resolved.renameTarget).toEqual({ origin: 'derived', pin: 2 })

    const renamed = await resolver.sealRename(fileRow, 'renamed.mp4', MASTER)
    expect(sealArgs).toEqual([{ pin: 2, filename: 'renamed.mp4', mimeType: 'video/mp4' }])

    // The rename is sealed under the v2 name subkey: the documented reader opens
    // it, the raw derived key does not.
    expect(wasm.decrypt_file_metadata_with_key(DERIVED, renamed)).toEqual({
      name: 'renamed.mp4',
      mime_type: 'video/mp4',
      chunk_format: 2,
    })
    const { nonce, ciphertext } = wasm.decodeMetadataEnvelope(renamed) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    expect(() => wasm.decrypt_metadata(DERIVED, nonce, ciphertext)).toThrow()

    // Re-resolving the renamed row still reports pin 2 and keeps the MIME.
    const again = await resolver.resolveRow(row(sealContent(EMPTY), renamed), MASTER)
    expect(again.name).toBe('renamed.mp4')
    expect(again.mimeType).toBe('video/mp4')
    expect(again.renameTarget).toEqual({ origin: 'derived', pin: 2 })
    resolver.clear()
  })
})
