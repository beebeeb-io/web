// SF-0002 review round (2026-10-30): the read-repair path must never widen
// what a client can open or write.
import { beforeEach, describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import { hexToBytes, installWasmCryptoMirror, loadVectors, toHex } from './helpers/wasm-crypto-mirror'
import {
  OWNER_REPAIR_READ_ONLY,
  clearOwnerRepairReadOnly,
  isOwnerRepairReadOnly,
  rememberOwnerRepairKey,
} from '../src/lib/owner-repair'

const mirror = await installWasmCryptoMirror()
const { wasm } = mirror
const { decryptEncryptedBytes } = await import('../src/lib/encrypted-download')
const { resolveOwnerKeyForFile } = await import('../src/lib/key-context')
const { renameKeyFor } = await import('../src/lib/owner-rename')
const { assertCurrentVersionWritable } = await import('../src/lib/owner-write-guard')

const enc = new TextEncoder()
const vectors = loadVectors()
const V1 = vectors.upper_repair_v1
const PIN_UNRECORDED = 0 as const

function row(over: Partial<DriveFile>): DriveFile {
  return { id: V1.file_id, size_bytes: 0, chunk_count: 1, name_encrypted: V1.name_encrypted, ...over } as unknown as DriveFile
}

describe('SF-0002 review: content fallback stays with the owner key', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a shared-folder key never opens content sealed under an owner key', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const sharedKey = new Uint8Array(32).fill(9)
    await expect(
      decryptEncryptedBytes(
        sharedKey,
        { fileId: V1.file_id, pin: PIN_UNRECORDED },
        hexToBytes(V1.content_frame_hex),
        1,
        V1.content_plaintext_hex.length / 2,
        undefined,
        master,
      ),
    ).rejects.toThrow()
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
  })

  test('only the read-only uppercase convention is accepted from the helper', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = wasm.derive_file_key(master, enc.encode(V1.file_id))
    const binary = wasm.derive_file_key(master, hexToBytes(V1.file_id.replace(/-/g, '')))
    const plaintext = enc.encode('binary-convention content')
    const frame = wasm.encrypt_chunk(binary, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const body = new Uint8Array(frame.nonce.length + frame.ciphertext.length)
    body.set(frame.nonce, 0)
    body.set(frame.ciphertext, frame.nonce.length)

    // The helper would report the write-capable `binary` convention; recovery
    // never switches to it, so the read fails and nothing is marked.
    await expect(
      decryptEncryptedBytes(
        derived,
        { fileId: V1.file_id, pin: PIN_UNRECORDED },
        body,
        1,
        plaintext.length,
        undefined,
        master,
      ),
    ).rejects.toThrow()
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
  })
})

describe('SF-0002 review: name resolution', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a cached repair key never takes precedence over a derived key that opens', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = wasm.derive_file_key(master, enc.encode(V1.file_id))
    const nameEnc = wasm.encrypt_name_for(derived, 'ordinary.pdf', null, 0)
    rememberOwnerRepairKey(V1.file_id, { fileKey: new Uint8Array(32).fill(1), convention: 'upper_repair' })

    const key = await resolveOwnerKeyForFile(
      master,
      row({ name_encrypted: nameEnc, acted_via_share_id: null, uploaded_by: null }),
      'me',
      null,
    )
    expect(toHex(key)).toBe(toHex(derived))
  })

  test('a foreign row the shared path cannot open is unavailable, not re-keyed', async () => {
    const master = hexToBytes(V1.master_key_hex)
    await expect(
      resolveOwnerKeyForFile(
        master,
        row({ acted_via_share_id: 'share-id' }),
        'me',
        null,
      ),
    ).rejects.toThrow()
  })
})

describe('SF-0002 review: writes', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('an owner rename uses the key that authenticated the name', async () => {
    const stringKey = new Uint8Array(32).fill(6)
    const binaryKey = new Uint8Array(32).fill(5)
    const key = await renameKeyFor({
      fileId: V1.file_id,
      file: row({ acted_via_share_id: null, uploaded_by: null }),
      viewerId: 'me',
      getFileKey: async () => stringKey,
      getFileKeyForFile: async () => binaryKey,
      readName: async () => undefined,
    })
    expect(key).toBe(binaryKey)
  })

  test('a write is refused when only the current content is uppercase-sealed', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const frame = hexToBytes(V1.content_frame_hex)
    const plaintext = hexToBytes(V1.content_plaintext_hex)
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(frame, {
        status: 200,
        headers: { 'X-Chunk-Size': String(plaintext.length), 'X-Chunk-Count': '1' },
      })) as unknown as typeof fetch
    try {
      await expect(
        assertCurrentVersionWritable(
          row({ size_bytes: plaintext.length, chunk_count: 1 }),
          master,
        ),
      ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  test('an ordinary version is writable', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = wasm.derive_file_key(master, enc.encode(V1.file_id))
    const plaintext = enc.encode('ordinary content')
    const frame = wasm.encrypt_chunk(derived, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const body = new Uint8Array(frame.nonce.length + frame.ciphertext.length)
    body.set(frame.nonce, 0)
    body.set(frame.ciphertext, frame.nonce.length)
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'X-Chunk-Size': String(plaintext.length), 'X-Chunk-Count': '1' },
      })) as unknown as typeof fetch
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: plaintext.length, chunk_count: 1 }), master),
      ).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = original
    }
  })
})
