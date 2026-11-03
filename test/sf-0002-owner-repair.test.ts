import { describe, expect, test } from 'bun:test'
import { hexToBytes, installWasmCryptoMirror, loadVectors, toHex } from './helpers/wasm-crypto-mirror'
import {
  OWNER_REPAIR_READ_ONLY,
  assertOwnerRepairWritable,
  clearOwnerRepairReadOnly,
  isOwnerRepairReadOnly,
  ownerRepairContentKeyWith,
  ownerRepairKeyFor,
  ownerRepairNameKeyWith,
  rememberOwnerRepairKey,
} from '../src/lib/owner-repair'

// SF-0002: rows the iOS Files app sealed under the UPPERCASE file id open on
// web, read-only. The fixtures are core's own vectors (core 064c622), vendored
// byte-for-byte as test/vectors/core-vectors.v13.json, driven through the real
// WASM build and the real download reader.
const mirror = await installWasmCryptoMirror()
const { wasm } = mirror
const { decryptEncryptedBytes } = await import('../src/lib/encrypted-download')

const vectors = loadVectors()
const enc = new TextEncoder()
const V1 = vectors['upper_repair_v1']
const SPLIT = vectors['upper_repair_split_v1']

const PIN_UNRECORDED = 0 as const

describe('SF-0002 owner repair keys', () => {
  test('upper_repair_v1: the owner name key opens the uppercase-sealed name', () => {
    const master = hexToBytes(V1.master_key_hex)
    const nameKey = ownerRepairNameKeyWith(wasm, master, V1.file_id, V1.name_encrypted)
    expect(nameKey).not.toBeNull()
    expect(nameKey!.convention).toBe('upper_repair')
    expect(toHex(nameKey!.fileKey)).toBe(V1.expected_key_hex)
    const name = wasm.decrypt_name_metadata_with_key(nameKey!.fileKey, V1.name_encrypted)
    expect((name as { name: string }).name).toBe('uppercase-repair.pdf')
  })

  test('upper_repair_split_v1: the name resolves under the uppercase convention', () => {
    const nameKey = ownerRepairNameKeyWith(
      wasm,
      hexToBytes(SPLIT.master_key_hex),
      SPLIT.file_id,
      SPLIT.name_encrypted,
    )
    expect(nameKey!.convention).toBe('upper_repair')
    expect(toHex(nameKey!.fileKey)).toBe(SPLIT.expected_name_key_hex)
  })

  test('an ordinary owner row is not read-only: remembering a string key keeps writes allowed', () => {
    const master = hexToBytes(V1.master_key_hex)
    const ordinaryKey = wasm.derive_file_key(master, enc.encode(V1.file_id))
    const encrypted = wasm.encrypt_name_for(ordinaryKey, 'ordinary-owner.pdf', 'application/pdf', 0)
    const repair = ownerRepairNameKeyWith(wasm, master, V1.file_id, encrypted)
    expect(repair!.convention).toBe('string')
    clearOwnerRepairReadOnly()
    rememberOwnerRepairKey(V1.file_id, repair!)
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
    expect(() => assertOwnerRepairWritable(V1.file_id)).not.toThrow()
    clearOwnerRepairReadOnly()
  })

  test('content v1 opens only with the repaired key; the ordinary key does not authenticate', () => {
    const master = hexToBytes(V1.master_key_hex)
    const frame = hexToBytes(V1.content_frame_hex)
    const repaired = ownerRepairContentKeyWith(wasm, master, V1.file_id, frame)
    expect(repaired!.convention).toBe('upper_repair')
    expect(toHex(repaired!.fileKey)).toBe(V1.expected_key_hex)

    const derived = wasm.derive_file_key(master, enc.encode(V1.file_id))
    const decryptor = wasm.WasmChunkDecryptor.fromFileKey(derived, V1.file_id, PIN_UNRECORDED)
    let refused = false
    try {
      decryptor.pushFrame(frame)
    } catch {
      refused = true
    } finally {
      decryptor.free()
    }
    expect(refused).toBe(true)
  })
})

describe('SF-0002 content fallback in the real reader', () => {
  test('upper_repair_v1 opens through decryptEncryptedBytes and marks the row read-only', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = wasm.derive_file_key(master, enc.encode(V1.file_id))
    clearOwnerRepairReadOnly()

    const plaintext = await decryptEncryptedBytes(
      derived,
      { fileId: V1.file_id, pin: PIN_UNRECORDED },
      hexToBytes(V1.content_frame_hex),
      1,
      V1.content_plaintext_hex.length / 2,
      undefined,
      master,
    )
    expect(toHex(plaintext)).toBe(V1.content_plaintext_hex)
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    expect(ownerRepairKeyFor(V1.file_id)).not.toBeNull()
  })

  test('split file: v1 needs the fallback, v2 opens under the ordinary string key, still read-only', async () => {
    const master = hexToBytes(SPLIT.master_key_hex)
    const derived = wasm.derive_file_key(master, enc.encode(SPLIT.file_id))
    expect(toHex(derived)).toBe(SPLIT.expected_content_v2_key_hex)
    clearOwnerRepairReadOnly()

    const v1 = await decryptEncryptedBytes(
      derived,
      { fileId: SPLIT.file_id, pin: PIN_UNRECORDED },
      hexToBytes(SPLIT.content_v1_frame_hex),
      1,
      SPLIT.content_v1_plaintext_hex.length / 2,
      undefined,
      master,
    )
    expect(toHex(v1)).toBe(SPLIT.content_v1_plaintext_hex)
    expect(isOwnerRepairReadOnly(SPLIT.file_id)).toBe(true)

    const v2 = await decryptEncryptedBytes(
      derived,
      { fileId: SPLIT.file_id, pin: PIN_UNRECORDED },
      hexToBytes(SPLIT.content_v2_frame_hex),
      1,
      SPLIT.content_v2_plaintext_hex.length / 2,
      undefined,
      master,
    )
    expect(toHex(v2)).toBe(SPLIT.content_v2_plaintext_hex)
  })

  test('writes are refused with the exact message, and only after a repair', () => {
    clearOwnerRepairReadOnly()
    expect(() => assertOwnerRepairWritable('some-file-id')).not.toThrow()

    const repair = ownerRepairContentKeyWith(
      wasm,
      hexToBytes(V1.master_key_hex),
      V1.file_id,
      hexToBytes(V1.content_frame_hex),
    )
    rememberOwnerRepairKey(V1.file_id, repair!)
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    expect(() => assertOwnerRepairWritable(V1.file_id)).toThrow(OWNER_REPAIR_READ_ONLY)
    expect(OWNER_REPAIR_READ_ONLY).toBe(
      'This file was saved by an older version of the iOS app. You can open and download it. To change it, save a copy.',
    )
    clearOwnerRepairReadOnly()
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
  })
})
