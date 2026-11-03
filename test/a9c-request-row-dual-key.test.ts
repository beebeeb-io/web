/**
 * 2275 L13 / A9c — a request row's name and content can live under DIFFERENT
 * keys.
 *
 * A request row's content stays sealed under the request content key C,
 * reached through the request keypair. Its NAME belongs to the string
 * convention derived from its id: a client that follows L13 renames it under
 * that derivation. An OLD client sealed the name under C. So the name key is
 * "derived or C (derived first)" — core's `resolveRequestRow` picks it and
 * returns BOTH keys, read-only, so a reader opens the name with the name key
 * and the content with C.
 *
 * The material here is sealed EXACTLY as production uploads it:
 * `src/pages/upload-request.tsx` calls `sealToRequest(rPub, contentKey)` with
 * the FIXED EMPTY file id, not the row's id. Core's bound
 * `resolveRequestRow`, however, opens the per-upload seal with the ROW id
 * bytes as HKDF info, so it cannot open a production seal. The read path
 * therefore falls back to the R5 legacy request reader (the pre-2236 empty
 * context, through core's own file-request functions) — but only behind the
 * same two gates the CLI applies: the row must be an owner-class id and its
 * name must be an encrypted envelope.
 *
 * These tests prove all of it against the real core:
 *  1. name sealed under C  → nameKey is C, the name opens.
 *  2. name sealed under the derivation → nameKey is the derived key, the name
 *     opens under it and NOT under C.
 *  3. a listing of production-sealed rows resolves content and names.
 *  4. a foreign-class row core refuses is NOT opened by the fallback.
 *  5. a plaintext name is refused.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = 'req-1'
const EMPTY = new Uint8Array()
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

// ── Real request material, built once ────────────────────────────────────
// A request's content key C is sealed to the sender's ephemeral public key;
// the request's private key is wrapped under the owner's master key. BOTH use
// the fixed EMPTY id as HKDF info — that is what upload-request.tsx and
// src/lib/crypto/file-requests.ts write. Core's bound `resolveRequestRow`
// opens the per-upload seal with the ROW id instead, so it refuses this
// material and the gated R5 legacy reader has to open it.
const rPub = wasm.derive_x25519_public(RPRIV) as Uint8Array
const sealed = wasm.seal_to_request(rPub, EMPTY, CONTENT) as {
  e_pub: Uint8Array
  wrapped_key: Uint8Array
}
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

const NAME_UNDER_C = envelope(CONTENT, 'original.txt')
const NAME_UNDER_DERIVED = envelope(DERIVED, 'renamed.txt')

// ── Mocks: real core for the resolver, a one-row request lookup ───────────
await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  // Core's request-row resolver, called in-process. The real module hops to a
  // worker that cannot load under bun, so route it to the committed WASM.
  resolveRequestRowWorker: async (args: {
    masterKey: Uint8Array
    itemId: string
    requestId: Uint8Array
    wrappedRequestPrivate: Uint8Array
    wrapNonce: Uint8Array
    senderEphemeralPubkey: Uint8Array
    wrappedContentKey: Uint8Array
    nameEncrypted: string
  }) => {
    const x = wasm.resolveRequestRow(
      args.masterKey,
      args.itemId,
      args.requestId,
      args.wrappedRequestPrivate,
      args.wrapNonce,
      args.senderEphemeralPubkey,
      args.wrappedContentKey,
      args.nameEncrypted,
    ) as {
      contentKey: Uint8Array
      nameKey: Uint8Array
      nameOrigin: string
      name?: string | null
      mimeType?: string | null
      chunkFormat?: number
    }
    return {
      contentKey: x.contentKey,
      nameKey: x.nameKey,
      nameOrigin: x.nameOrigin,
      name: x.name ?? null,
      mimeType: x.mimeType ?? null,
      chunkFormat: x.chunkFormat,
    }
  },
  // The R5 legacy reader's primitives, in process over the same core build.
  isForeignItemIdWorker: async (itemId: string) => wasm.isForeignItemId(itemId),
  unwrapRequestPrivate: async (
    masterKey: Uint8Array,
    wrapped: Uint8Array,
    nonce: Uint8Array,
    requestId: Uint8Array = EMPTY,
  ) => wasm.unwrap_request_private(masterKey, requestId, wrapped, nonce),
  openRequestUpload: async (
    rPriv: Uint8Array,
    ePub: Uint8Array,
    wrappedKey: Uint8Array,
    fileId: Uint8Array = EMPTY,
  ) => wasm.open_request_upload(rPriv, ePub, fileId, wrappedKey),
  resolveOwnedItemWorker: async (args: {
    masterKey: Uint8Array
    itemId: string
    kind: number
    ownerWrap?: Uint8Array | null
    nameEncrypted: string
  }) => {
    const x = wasm.resolveOwnedKey(
      args.masterKey,
      args.itemId,
      args.kind,
      args.ownerWrap ?? null,
      args.nameEncrypted,
    ) as {
      key: Uint8Array
      contentKey: Uint8Array | null
      origin: string
      name: { name?: string; mimeType?: string | null; plaintext?: string; chunkFormat: number } | null
      writeTarget: unknown
    }
    return { ...x, origin: x.origin }
  },
  // Core's strict file-name reader (throws on plaintext or a wrong key).
  readNameMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
    const { nonce, ciphertext } = wasm.decodeMetadataEnvelope(nameEncrypted) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    const meta = JSON.parse(wasm.decrypt_metadata(fileKey, nonce, ciphertext) as string) as {
      name: string
      mime_type: string | null
    }
    return { name: meta.name, mimeType: meta.mime_type, pin: 0 }
  },
}))

await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  // The request row names its request by id; the wrapped private key and its
  // nonce live on the request, not the file row.
  listFileRequests: async () => ({
    file_requests: [
      {
        id: REQUEST_ID,
        wrapped_private_key: b64(wrappedPriv.wrapped),
        wrap_nonce: b64(wrappedPriv.nonce),
      },
    ],
  }),
}))

// Imported AFTER the mocks are installed so the resolver sees them.
const { createRequestKeyResolver } = await import('../src/lib/file-request-crypto')

function requestRow(nameEncrypted: string) {
  return {
    id: FILE_ID,
    name_encrypted: nameEncrypted,
    file_request_id: REQUEST_ID,
    sender_ephemeral_pubkey: b64(sealed.e_pub),
    wrapped_content_key: b64(sealed.wrapped_key),
  }
}

describe('A9c: a request row resolves its name key and its content key separately', () => {
  test('a name sealed under C opens under C, and the content stays under C', async () => {
    const row = await createRequestKeyResolver().resolveRow(requestRow(NAME_UNDER_C), MASTER)

    // Content stays C — the request keypair's opening.
    expect(hex(row.contentKey)).toBe(hex(CONTENT))
    // The name opens under the returned name key, which is C for an original row.
    expect(hex(row.nameKey)).toBe(hex(CONTENT))
    // Core returns the name flat, not nested.
    expect(row.name).toBe('original.txt')
    expect(row.mimeType).toBe('text/plain')
    expect(typeof row.nameOrigin).toBe('string')
  })

  test('a name renamed under the derivation opens under the derived key, not C', async () => {
    const row = await createRequestKeyResolver().resolveRow(requestRow(NAME_UNDER_DERIVED), MASTER)

    // Content still stays C: the rename never moved it.
    expect(hex(row.contentKey)).toBe(hex(CONTENT))
    // The name key is the string convention derived from the id, derived first.
    expect(hex(row.nameKey)).toBe(hex(DERIVED))
    expect(hex(row.nameKey)).not.toBe(hex(CONTENT))
    expect(row.name).toBe('renamed.txt')
    expect(row.mimeType).toBe('text/plain')
  })

  test('the derived rename is genuinely unreadable under C', () => {
    // Guards the test above: if C could open the renamed envelope, the dual key
    // would be pointless and the "not C" assertion would prove nothing.
    const { nonce, ciphertext } = wasm.decodeMetadataEnvelope(NAME_UNDER_DERIVED) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    expect(() => wasm.decrypt_metadata(CONTENT, nonce, ciphertext)).toThrow()
    expect(JSON.parse(wasm.decrypt_metadata(DERIVED, nonce, ciphertext) as string).name).toBe('renamed.txt')
  })

  test('a listing of production-sealed request uploads opens and lists its names', async () => {
    // The drive's list path resolves every row and then shows the returned
    // name. The material is sealed with the EMPTY id, as upload-request.tsx
    // does, so this fails unless the read path opens what production writes.
    const listing = [requestRow(NAME_UNDER_C), requestRow(NAME_UNDER_DERIVED)]
    const rows = []
    const resolver = createRequestKeyResolver()
    for (const file of listing) {
      const row = await resolver.resolveRow(file, MASTER)
      rows.push({ content: hex(row.contentKey), name: row.name })
    }
    expect(rows).toEqual([
      { content: hex(CONTENT), name: 'original.txt' },
      { content: hex(CONTENT), name: 'renamed.txt' },
    ])
  })

  test('a foreign-class id core refuses is NOT opened by the legacy reader', async () => {
    // L12: a request row is an owner item. Without the class gate the legacy
    // reader would happily open this seal (it is bound to nothing) and show a
    // foreign row as an owner request upload.
    const foreignId = (wasm.newForeignItemId(MASTER) as { idText: string }).idText
    const row = { ...requestRow(NAME_UNDER_C), id: foreignId }
    await expect(createRequestKeyResolver().resolveRow(row, MASTER)).rejects.toThrow()
  })

  test('a plaintext name is refused', async () => {
    // A plaintext name authenticates nothing, so it never reaches the R5
    // reader: core refuses it and the encrypted-name gate refuses it too.
    await expect(
      createRequestKeyResolver().resolveRow(requestRow('plain-note.txt'), MASTER),
    ).rejects.toThrow(/encrypted envelope/i)
  })
})
