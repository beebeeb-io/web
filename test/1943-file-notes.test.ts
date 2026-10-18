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
 *     metadata reader of that file (the folder reader for a folder).
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
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME, isFolder: false })
    expect(await notes.openFileNote(V2_KEY, stored)).toBe('quarterly figures')
  })

  test('it does NOT open under the raw file key (so it can never stand in for a legacy name or a v1 frame)', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME, isFolder: false })
    const { nonce, ciphertext } = parseBlob(stored)
    expect(() => wasm.decrypt_metadata(V2_KEY, nonce, ciphertext)).toThrow()
  })

  test('served as the file’s name it does not open, and served as content it opens under neither pin', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'quarterly figures', { nameEncrypted: V2_NAME, isFolder: false })
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
    const stored = await notes.sealFileNote(V2_KEY, 'x', { nameEncrypted: V2_NAME, isFolder: false })
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
      isFolder: false,
    })
    const { nonce, ciphertext } = parseBlob(stored)
    expect(wasm.decrypt_metadata(V1_KEY, nonce, ciphertext)).toBe('still readable by old tabs')
    expect(await notes.openFileNote(V1_KEY, stored)).toBe('still readable by old tabs')
  })
})

describe('the pin comes from the right reader, and an unreadable pin means no note is written', () => {
  test('a FILE whose name is plaintext: the file reader refuses it, so nothing is sealed', async () => {
    await expect(
      notes.sealFileNote(V1_KEY, 'never written', { nameEncrypted: 'contract.pdf', isFolder: false }),
    ).rejects.toThrow()
  })

  test('a file whose name does not open under its key: refused', async () => {
    const otherKey = new Uint8Array(32).fill(3)
    await expect(
      notes.sealFileNote(V1_KEY, 'never written', { nameEncrypted: v1Name(otherKey, 'x'), isFolder: false }),
    ).rejects.toThrow()
  })

  test('a FOLDER reads its pin with the folder reader, which accepts a legacy plaintext folder name', async () => {
    const folderKey = new Uint8Array(32).fill(7)
    const stored = await notes.sealFileNote(folderKey, 'folder note', { nameEncrypted: 'Projects', isFolder: true })
    expect(await notes.openFileNote(folderKey, stored)).toBe('folder note')
  })

  test('a note never opens under another file’s key', async () => {
    const stored = await notes.sealFileNote(V2_KEY, 'mine', { nameEncrypted: V2_NAME, isFolder: false })
    await expect(notes.openFileNote(V1_KEY, stored)).rejects.toThrow()
  })

  test('the v2 vector’s file key is what this suite pinned (guards the fixture itself)', () => {
    expect(toHex(V2_KEY)).toBe(V.chunk_v2_stream.file_key_hex)
  })
})
