/**
 * Review-2 N3: L12 says a plaintext-named owner FILE picks its key convention
 * from the content's first chunk. Core refuses to resolve such a row without
 * that frame (owned_keys.rs:445-449), so after the L12 change plaintext-named
 * files stopped opening on every read path (download, zip, preview, rename).
 *
 * The read resolver fetches chunk 0 and passes it to core. Share-link creation
 * does NOT: a link must never wrap a key it could not authenticate from the
 * name alone (A27 / F7), so the plaintext row still refuses there.
 */
import { describe, expect, test } from 'bun:test'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { installWasmCryptoMirror, loadWasm } from './helpers/wasm-crypto-mirror'
import type { DriveFile } from '../src/lib/api'

preserveGlobals('fetch')
await installWasmCryptoMirror()

const wasm = loadWasm()
const enc = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const FILE_ID = '77777777-7777-4777-8777-777777777777'
const PLAINTEXT = enc.encode('the first chunk of a plaintext-named file')
const KEY = wasm.derive_file_key(MASTER, enc.encode(FILE_ID)) as Uint8Array
const sealed = wasm.encrypt_chunk(KEY, PLAINTEXT) as { nonce: Uint8Array; ciphertext: Uint8Array }
const FRAME = new Uint8Array(sealed.nonce.length + sealed.ciphertext.length)
FRAME.set(sealed.nonce, 0)
FRAME.set(sealed.ciphertext, sealed.nonce.length)

const file = {
  id: FILE_ID,
  name_encrypted: 'notes.txt',
  is_folder: false,
  size_bytes: PLAINTEXT.length,
  chunk_count: 1,
  mime_type: 'text/plain',
  uploaded_by: 'me',
} as unknown as DriveFile

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

setGlobal('fetch', (async (input: RequestInfo | URL) => {
  if (String(input).endsWith(`/api/v1/files/${FILE_ID}/download`)) {
    return new Response(FRAME, {
      status: 200,
      headers: {
        'X-Chunk-Size': String(PLAINTEXT.length),
        'X-Chunk-Count': '1',
        'Content-Length': String(FRAME.length),
      },
    })
  }
  throw new Error(`unexpected fetch: ${String(input)}`)
}) as typeof fetch)

const { resolveOwnerKeyForFile } = await import('../src/lib/key-context')
const { resolveOwnerKeyForRead } = await import('../src/lib/key-context')
const { fetchOwnerFirstChunkFrames } = await import('../src/lib/owner-write-guard')
const { shareFileKey } = await import('../src/lib/share-file-key')
const { renameKeyFor } = await import('../src/lib/owner-rename')

describe('N3: a plaintext-named owner file', () => {
  test('without chunk 0 core refuses it (the regression this fixes)', async () => {
    await expect(resolveOwnerKeyForFile(MASTER, file, 'me', null, async () => true)).rejects.toThrow(
      "Can't open this file",
    )
  })

  test('the read resolver fetches chunk 0 and returns the key that opens the content', async () => {
    const frames = await fetchOwnerFirstChunkFrames(file)
    expect(frames).toHaveLength(1)
    expect(hex(frames[0])).toBe(hex(FRAME))

    const key = await resolveOwnerKeyForRead(MASTER, file, 'me', null)
    expect(hex(key)).toBe(hex(KEY))
    // The key is the read path's key: it opens chunk 0 (download and preview).
    const opened = wasm.decrypt_chunk(key, sealed.nonce, sealed.ciphertext) as Uint8Array
    expect(new TextDecoder().decode(opened)).toBe('the first chunk of a plaintext-named file')
  })

  test('the inline rename resolves a plaintext-named file with chunk 0', async () => {
    // The file-list's rename path hands renameOwnerRow the resolved-key
    // callback; it must opt into chunk 0 exactly like the download/preview
    // read paths, or the rename refuses a plaintext-named file.
    const key = await renameKeyFor({
      fileId: FILE_ID,
      file,
      viewerId: 'me',
      getFileKey: async () => KEY,
      getFileKeyForFile: (row) => resolveOwnerKeyForRead(MASTER, row, 'me', null),
      readName: async () => {
        throw new Error('a plaintext name has no sealed read')
      },
    })
    expect(hex(key)).toBe(hex(KEY))
  })

  test('the inline rename wires getFileKeyForFile with chunk 0', async () => {
    const list = await Bun.file(new URL('../src/components/file-list.tsx', import.meta.url)).text()
    expect(list).toMatch(/getFileKeyForFile:\s*\(f\)\s*=>\s*getFileKeyForFile\(f,\s*\{\s*plaintextChunk:\s*true\s*\}\)/)
  })

  test('a share link for it still refuses: no chunk 0 on the share path', async () => {
    await expect(
      shareFileKey(FILE_ID, {
        file,
        getFileKey: async () => KEY,
        getFileKeyForFile: (row) => resolveOwnerKeyForFile(MASTER, row, 'me', null, async () => true),
      }),
    ).rejects.toThrow("Can't open this file")
  })

  test('the read paths opt in to chunk 0 (download and preview wiring)', async () => {
    const preview = await Bun.file(new URL('../src/components/preview/file-preview.tsx', import.meta.url)).text()
    expect(preview.includes('plaintextChunk: true')).toBe(true)
    const download = await Bun.file(new URL('../src/pages/starred.tsx', import.meta.url)).text()
    expect(download.includes('plaintextChunk: true')).toBe(true)
  })
})
