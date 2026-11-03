/**
 * Contract 2275 L15 / A27 (crypto:F6): a file link created for a
 * binary-convention item discloses the BINARY key — the one that authenticates
 * the row's name — never the string-convention derivation.
 *
 * SF-0002 W8 already routes a single-file link through the row's own key
 * (`shareFileKey` + `resolveOwnerKeyForFile`). A27 pins it for the legacy
 * binary convention: the link's wrapped key must open the name, and it must be
 * the binary key, not `derive_file_key(master, file_id.as_bytes())`.
 */
import { describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import { installWasmCryptoMirror, loadWasm } from './helpers/wasm-crypto-mirror'

await installWasmCryptoMirror()

const wasm = loadWasm()
const enc = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const FILE_ID = '66666666-6666-4666-8666-666666666666'

const uuidBytes = Uint8Array.from(
  FILE_ID.replace(/-/g, '').match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
)
const STRING_KEY = wasm.derive_file_key(MASTER, enc.encode(FILE_ID))
const BINARY_KEY = wasm.derive_file_key(MASTER, uuidBytes)
const NAME = wasm.encrypt_name_for(BINARY_KEY, 'legacy-binary.bin', null, 0)

const { shareFileKey } = await import('../src/lib/share-file-key')
const { resolveOwnerKeyForFile } = await import('../src/lib/key-context')
const { wrapKeyForShare, unwrapKeyFromShare, toBase64 } = await import('../src/lib/crypto')

const row = {
  id: FILE_ID,
  name_encrypted: NAME,
  is_folder: false,
  size_bytes: 4,
  chunk_count: 1,
  updated_at: '2026-11-03T00:00:00Z',
} as unknown as DriveFile

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('A27: a file link for a binary-convention item', () => {
  test('discloses the binary key, and the recipient opens the name with it', async () => {
    expect(hex(BINARY_KEY)).not.toBe(hex(STRING_KEY))
    // Core reports this row as the legacy binary convention.
    expect(wasm.ownerFileKeyForName(MASTER, FILE_ID, NAME).convention).toBe('binary')

    const key = await shareFileKey(FILE_ID, {
      file: row,
      // What a client that skipped the resolver would wrap: the string key.
      getFileKey: async () => STRING_KEY,
      getFileKeyForFile: (file) => resolveOwnerKeyForFile(MASTER, file, 'me', null, async () => true),
    })
    expect(hex(key)).toBe(hex(BINARY_KEY))

    // The recipient: unwrap from the URL-fragment key, then open the row's name.
    const clientKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapKeyForShare(clientKey, key)
    expect(typeof toBase64(wrapped)).toBe('string')
    const opened = await unwrapKeyFromShare(clientKey, wrapped)
    const name = wasm.decrypt_name_metadata_with_key(opened, NAME) as { name: string }
    expect(name.name).toBe('legacy-binary.bin')

    // And the string key does NOT open it (the disclosure was load-bearing).
    expect(() => wasm.decrypt_name_metadata_with_key(STRING_KEY, NAME)).toThrow()
  })
})
