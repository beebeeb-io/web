/**
 * Task 1943 — file notes go through core (core 1908 round 5).
 *
 * Before: the details panel sealed `files.note_encrypted` with
 * `encrypt_metadata(rawFileKey, text)` and opened it with `decrypt_metadata`. A
 * raw-key note has exactly the shape of a legacy name, so a server could serve
 * it as a v2 file's `name_encrypted`, re-enable format detection and then serve
 * the same bytes as a one-frame v1 "file". Now:
 *   - open: core `decrypt_note` (note subkey, then the legacy raw key);
 *   - seal: core `encrypt_note_for(fileKey, text, pin)`, pin from the FILE
 *     metadata reader of that file or folder (never the folder reader: see the
 *     last block).
 * Driven through web's `src/lib/file-note.ts` (what the details panel calls)
 * against real core crypto (test/helpers/wasm-crypto-mirror.ts).
 */
import { describe, expect, test } from 'bun:test'
import {
  hexToBytes,
  installWasmCryptoMirror,
  loadVectors,
  toHex,
} from './helpers/wasm-crypto-mirror'

const { wasm, ops } = await installWasmCryptoMirror()
const notes = await import('../src/lib/file-note')
const { UnverifiedFileMetadataError } = await import('../src/lib/content-crypto')

const V = loadVectors()
const V2_KEY = hexToBytes(V.metadata_v2_name.file_key_hex)
const V2_FILE_ID = V.metadata_v2_name.file_id as string
const V2_NAME = V.metadata_v2_name.name_encrypted as string

const V1_KEY = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff)
const V1_FILE_ID = '1943b0b0-0000-4000-8000-000000000001'

/** The old web note writer, byte for byte: `encryptFilename` (= `encrypt_metadata` under the raw key) + `serializeEncryptedBlob`. */
function legacyWebNote(fileKey: Uint8Array, text: string): string {
  const b = wasm.encrypt_metadata(fileKey, text) as { nonce: Uint8Array; ciphertext: Uint8Array }
  return JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: Array.from(b.nonce), ciphertext: Array.from(b.ciphertext) })
}

/** The oldest web note shape: `{nonce, ciphertext}` as base64 strings. */
function legacyBase64Note(fileKey: Uint8Array, text: string): string {
  const b = wasm.encrypt_metadata(fileKey, text) as { nonce: Uint8Array; ciphertext: Uint8Array }
  return JSON.stringify({ nonce: Buffer.from(b.nonce).toString('base64'), ciphertext: Buffer.from(b.ciphertext).toString('base64') })
}

function v1Name(fileKey: Uint8Array, name: string): string {
  return legacyWebNote(fileKey, JSON.stringify({ name, mime_type: null }))
}

function parseBlob(json: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const p = JSON.parse(json) as { nonce: number[]; ciphertext: number[] }
  return { nonce: new Uint8Array(p.nonce), ciphertext: new Uint8Array(p.ciphertext) }
}

describe('notes written before this change still open', () => {
  test('a raw-key note in the canonical blob shape (what the details panel stored until now)', async () => {
    expect(await notes.openFileNote(V1_KEY, legacyWebNote(V1_KEY, 'call the notary'))).toBe('call the notary')
  })

  test('the older base64 {nonce, ciphertext} note shape', async () => {
    expect(await notes.openFileNote(V1_KEY, legacyBase64Note(V1_KEY, 'old shape'))).toBe('old shape')
  })

  test('a raw-key note on a file that is v2 now still opens (written before its pin existed)', async () => {
    expect(await notes.openFileNote(V2_KEY, legacyWebNote(V2_KEY, 'from before'))).toBe('from before')
  })
})

describe('a note on a v2-pinned file is sealed under the note subkey', () => {
  test('it round-trips through the note reader', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME })
    expect(await notes.openFileNote(V2_KEY, stored)).toBe('quarterly figures')
  })

  test('it does NOT open under the raw file key (so it can never stand in for a legacy name or a v1 frame)', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME })
    const { nonce, ciphertext } = parseBlob(stored)
    expect(() => wasm.decrypt_metadata(V2_KEY, nonce, ciphertext)).toThrow()
  })

  test('served as the file’s name it does not open, and served as content it opens under neither pin', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME })
    expect(() => ops.readFileMetadata(V2_KEY, stored)).toThrow()
    expect(() => ops.readNameMetadata(V2_KEY, stored)).toThrow()
    const { nonce, ciphertext } = parseBlob(stored)
    const frame = new Uint8Array([...nonce, ...ciphertext])
    for (const pin of [0, 2] as const) {
      const h = ops.createDecryptor(V2_KEY, V2_FILE_ID, pin)
      expect(() => ops.decryptorPushFrame(h, frame)).toThrow()
      ops.decryptorDispose(h)
    }
    expect(ops.liveDecryptorCount()).toBe(0)
  })

  test('the stored value is the canonical EncryptedBlob JSON the server already accepts', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'x', { nameEncrypted: V2_NAME })
    const p = JSON.parse(stored) as { cipher_suite: string; nonce: number[]; ciphertext: number[] }
    expect(p.cipher_suite).toBe('V1Aes256Gcm')
    expect(p.nonce).toHaveLength(12)
    expect(p.ciphertext).toHaveLength(1 + 16)
  })
})

describe('a note on a file with no recorded pin (every file today) during the read-only phase', () => {
  test('is sealed exactly as before, under the raw key, so web tabs not yet on this core still open it', async () => {
    const stored = await notes.sealFileNote(V1_KEY, 'still readable by old tabs', {
      nameEncrypted: v1Name(V1_KEY, 'contract.pdf'),
    })
    const { nonce, ciphertext } = parseBlob(stored)
    expect(wasm.decrypt_metadata(V1_KEY, nonce, ciphertext)).toBe('still readable by old tabs')
    expect(await notes.openFileNote(V1_KEY, stored)).toBe('still readable by old tabs')
  })
})

describe('the pin comes from the right reader, and an unreadable pin means no note is written', () => {
  test('a FILE whose name is plaintext: the file reader refuses it, so nothing is sealed', async () => {
    await expect(
      notes.sealFileNote(V1_KEY, 'never written', { nameEncrypted: 'contract.pdf' }),
    ).rejects.toThrow()
  })

  test('a file whose name does not open under its key: refused', async () => {
    const otherKey = new Uint8Array(32).fill(3)
    await expect(
      notes.sealFileNote(V1_KEY, 'never written', { nameEncrypted: v1Name(otherKey, 'x') }),
    ).rejects.toThrow()
  })

  // Crypto review of web#170 (Minor 1): this test used to assert the OPPOSITE
  // ("a FOLDER reads its pin with the folder reader, which accepts a legacy
  // plaintext folder name"). `is_folder` is a server field, so that rule let a
  // server pick the key a note is sealed under. See the block below.
  test('a legacy plaintext folder name: refused too (it carries no authenticated pin)', async () => {
    const folderKey = new Uint8Array(32).fill(7)
    const owner = { nameEncrypted: 'Projects', isFolder: true }
    await expect(notes.sealFileNote(folderKey, 'folder note', owner)).rejects.toThrow(UnverifiedFileMetadataError)
  })

  test('a note never opens under another file’s key', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'mine', { nameEncrypted: V2_NAME })
    await expect(notes.openFileNote(V1_KEY, stored)).rejects.toThrow()
  })

  test('the v2 vector’s file key is what this suite pinned (guards the fixture itself)', () => {
    expect(toHex(V2_KEY)).toBe(V.chunk_v2_stream.file_key_hex)
  })
})

/**
 * Crypto review of web#170, Minor 1. `is_folder` comes from the server. When
 * the note writer let it pick the reader, a hostile server could flag a v2
 * file as a folder and serve a plaintext name: the folder reader reads that as
 * pin 0, so the note was sealed under the RAW file key. That is exactly the
 * blob core round 5 closed (chunk_stream.rs
 * `raw_key_note_served_as_name_downgrades_v2_file`): served back as the file's
 * name it opens and records no pin, which re-enables frame-0 detection.
 *
 * Now every owner's pin comes from core's FILE reader. What folders carry
 * today keeps working: web (`encryptFilename` with a bare name or
 * `encryptFileMetadata`), mobile (`encryptMetadata` JSON) and cli/desktop
 * (core `encrypt_name`) all write an ENCRYPTED folder name.
 */
describe('a server-supplied folder flag never decides how a note is sealed', () => {
  test('a v2 file flagged as a folder with a plaintext name: no note is sealed at all', async () => {
    // A variable, not a literal: the hostile shape is what the server sends.
    const owner = { nameEncrypted: 'vector-v2.pdf', isFolder: true }
    await expect(notes.sealFileNote(V2_KEY, 'secret', owner)).rejects.toThrow(UnverifiedFileMetadataError)
  })

  test('the same flag with the file’s real (v2) name: sealed under the note subkey, never the raw key', async () => {
    const owner = { nameEncrypted: V2_NAME, isFolder: true }
    const stored = await notes.sealFileNote(V2_KEY, 'secret', owner)
    const { nonce, ciphertext } = parseBlob(stored)
    expect(() => wasm.decrypt_metadata(V2_KEY, nonce, ciphertext)).toThrow()
    expect(await notes.openFileNote(V2_KEY, stored)).toBe('secret')
  })

  const mk = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
  const folderId = '1943f01d-0000-4000-8000-000000000001'
  const folderKey = wasm.derive_file_key(mk, new TextEncoder().encode(folderId))

  const encryptedFolderNames: Array<[string, () => string]> = [
    ['web move-modal / import: encryptFilename(bare name)', () => legacyWebNote(folderKey, 'Projects')],
    ['web drive / mobile: {"name","mime_type"} JSON', () => v1Name(folderKey, 'Projects')],
    ['cli / desktop: core encrypt_name (pin unrecorded)', () => wasm.encrypt_name_with_chunk_format(mk, folderId, 'Projects', null, 0)],
  ]
  for (const [how, name] of encryptedFolderNames) {
    test(`an encrypted folder name still takes a note (${how})`, async () => {
      const stored = await notes.sealFileNote(folderKey, 'folder note', { nameEncrypted: name() })
      expect(await notes.openFileNote(folderKey, stored)).toBe('folder note')
    })
  }
})
