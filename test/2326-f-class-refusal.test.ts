/**
 * 2326 review P3-3: an F-class request row is refused at the APP level.
 *
 * `getFileKeyForFile` is what download, zip, share links, the preview and the
 * list reach for a key. A row received through a file request must never take
 * the owner path there: core hands out a decrypt-only content source, and an
 * id-derived key would not open the row (for a FOREIGN id core refuses the row
 * outright). The old app-level test for this ran through the now-deleted local
 * reader, so only the reader-level behaviour was still covered.
 *
 * The fork is `fileKeyForFileWith` (key-context.tsx), the function
 * `getFileKeyForFile` delegates to; the request branch runs the REAL core
 * resolver over the committed wasm, so the refusal is core's.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { toBase64 } from '../src/lib/crypto/helpers'
import type { DriveFile, FileRequest } from '../src/lib/api'
import { isRequestContentSource } from '../src/lib/request-row'
import {
  createLocalRequestRowEngine,
  createRequestRowResolverWith,
} from '../src/lib/request-row-resolver'
import { fileKeyForFileWith } from '../src/lib/key-context'
import { downloadAsZipWith, type BulkDownloadPorts, type ZipSink } from '../src/lib/bulk-download'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const CONTENT = new Uint8Array(32).fill(0x11)
const RPRIV = new Uint8Array(32).fill(0x22)
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const EMPTY = new Uint8Array()

const rPub = wasm.derive_x25519_public(RPRIV) as Uint8Array
const wrappedPriv = wasm.wrap_request_private(MASTER, EMPTY, RPRIV) as {
  wrapped: Uint8Array
  nonce: Uint8Array
}
const SEALED = wasm.seal_to_request(rPub, EMPTY, CONTENT) as {
  e_pub: Uint8Array
  wrapped_key: Uint8Array
}
const DERIVED = wasm.derive_file_key(MASTER, encoder.encode('never-used')) as Uint8Array

/** L12: the class core enforces. F ids belong to a member, never to us. */
const FOREIGN_ID = (wasm.newForeignItemId(MASTER) as { idText: string }).idText
const OWNER_ID = (wasm.newOwnerItemId(MASTER) as { idText: string }).idText

function requestRow(id: string): DriveFile {
  return {
    id,
    name_encrypted: wasm.encrypt_name_for(CONTENT, 'member.mov', 'video/quicktime', 0) as string,
    mime_type: 'video/quicktime',
    size_bytes: 8,
    chunk_count: 1,
    file_request_id: REQUEST_ID,
    sender_ephemeral_pubkey: toBase64(SEALED.e_pub),
    wrapped_content_key: toBase64(SEALED.wrapped_key),
  } as unknown as DriveFile
}

function ownerRow(id: string): DriveFile {
  return {
    id,
    name_encrypted: 'plain-note.txt',
    mime_type: 'text/plain',
    size_bytes: 4,
    chunk_count: 1,
  } as unknown as DriveFile
}

function requestRowFor(): FileRequest {
  return {
    id: REQUEST_ID,
    wrapped_private_key: toBase64(wrappedPriv.wrapped),
    wrap_nonce: toBase64(wrappedPriv.nonce),
  } as FileRequest
}

function resolver() {
  return createRequestRowResolverWith(createLocalRequestRowEngine(wasm, async () => [requestRowFor()]))
}

describe('2326 P3-3: an F-class request row is refused on the app key path', () => {
  test('the request branch runs core, which refuses the foreign id, and no owner key is derived', async () => {
    const file = requestRow(FOREIGN_ID)
    const rows = resolver()
    let ownerKeyCalls = 0
    const key = fileKeyForFileWith({
      file,
      requestContent: async () => (await rows.resolveRow(file, MASTER)).content,
      ownerKey: async () => {
        ownerKeyCalls += 1
        return DERIVED
      },
    })

    await expect(key).rejects.toThrow(/request row class check|owner item id/i)
    expect(ownerKeyCalls).toBe(0)
    rows.clear()
  })

  test('an owner-class request row returns core’s content source, never a derived key', async () => {
    const file = requestRow(OWNER_ID)
    const rows = resolver()
    let ownerKeyCalls = 0
    const key = await fileKeyForFileWith({
      file,
      requestContent: async () => (await rows.resolveRow(file, MASTER)).content,
      ownerKey: async () => {
        ownerKeyCalls += 1
        return DERIVED
      },
    })

    expect(isRequestContentSource(key)).toBe(true)
    expect(key).not.toBeInstanceOf(Uint8Array)
    expect(ownerKeyCalls).toBe(0)
    rows.clear()
  })

  test('an ordinary row still takes the owner path', async () => {
    let requestCalls = 0
    const file = ownerRow(OWNER_ID)
    const key = await fileKeyForFileWith({
      file,
      requestContent: async () => {
        requestCalls += 1
        throw new Error('not a request row')
      },
      ownerKey: async () => DERIVED,
    })
    expect(key).toBe(DERIVED)
    expect(requestCalls).toBe(0)
  })

  test('downloadAsZip refuses the F-class request row: one error entry, no derived key', async () => {
    const file = requestRow(FOREIGN_ID)
    const rows = resolver()
    const written: Uint8Array[] = []
    const sink: ZipSink = {
      write: async (chunk) => {
        written.push(chunk)
      },
      close: async () => {},
      abort: async () => {},
    }
    let ownerKeyCalls = 0
    let decryptCalls = 0
    const ports: BulkDownloadPorts = {
      listChildren: async () => [],
      getFileKey: (f) =>
        fileKeyForFileWith({
          file: f,
          requestContent: async () => (await rows.resolveRow(f, MASTER)).content,
          ownerKey: async () => {
            ownerKeyCalls += 1
            return DERIVED
          },
        }),
      decryptToBlob: async () => {
        decryptCalls += 1
        return { plaintext: new Blob(['should never be written']), filename: 'member.mov' }
      },
    }

    const result = await downloadAsZipWith(ports, [file], { sink, zipFilename: 'drive.zip' })
    const names = archiveEntryNames(Buffer.concat(written.map((c) => Buffer.from(c))))
    expect(result.errorCount).toBe(1)
    expect(names).toEqual(['_errors.txt'])
    expect(decryptCalls).toBe(0)
    expect(ownerKeyCalls).toBe(0)
    rows.clear()
  })
})

/** Names in the order their local file headers appear in the archive. */
function archiveEntryNames(bytes: Uint8Array): string[] {
  const found: string[] = []
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) {
      continue
    }
    const nameLength = bytes[i + 26] | (bytes[i + 27] << 8)
    if (nameLength <= 0 || i + 30 + nameLength > bytes.length) continue
    found.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLength)))
  }
  return found
}
