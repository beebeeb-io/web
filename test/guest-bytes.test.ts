/**
 * Task 2237b — guest preview bytes.
 *
 * Runs guest-bytes against the committed WASM build (the same in-process
 * crypto ops the worker uses) with a stubbed network so the header rule and
 * the size cap are both observable.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { installWasmCryptoMirror } from './helpers/wasm-crypto-mirror'
import type { PublicFolderItem } from '../src/lib/folder-link-types'

const mirror = await installWasmCryptoMirror()

const { GUEST_PREVIEW_MAX_BYTES, GuestPreviewTooLargeError, fetchGuestPlaintextBlob } =
  await import('../src/lib/guest-bytes')

const CHUNK_SIZE = 8
const PLAINTEXT = new TextEncoder().encode('hello guest preview')

// The upload encryptor takes a master key; the guest holds the unwrapped file
// key, so derive the same key the way the uploader did.
const MASTER = new Uint8Array(32).fill(9)
function uuidBytes(id: string): Uint8Array {
  return new TextEncoder().encode(id)
}
function fileKeyFor(id: string): Uint8Array {
  return mirror.wasm.derive_file_key(MASTER, uuidBytes(id))
}

type Call = { url: string; headers: Record<string, string> }
let calls: Call[] = []
let bodyFor: () => Uint8Array = () => new Uint8Array()
let status = 200
let serverChunkSize: number | null = null

function encryptedFrames(fileId: string, chunkSize = CHUNK_SIZE): Uint8Array {
  const encryptor = mirror.wasm.WasmChunkEncryptor.withChunkSize(
    MASTER,
    fileId,
    BigInt(PLAINTEXT.length),
    BigInt(chunkSize),
  ).withRecordedPin(2)
  const frames: Uint8Array[] = []
  for (let offset = 0; offset < PLAINTEXT.length; offset += chunkSize) {
    frames.push(encryptor.pushChunk(PLAINTEXT.slice(offset, offset + chunkSize)))
  }
  encryptor.finish()
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

function item(fileId: string, overrides: Partial<PublicFolderItem> = {}): PublicFolderItem {
  const nameEncrypted = mirror.wasm.encrypt_name_for(fileKeyFor(fileId), 'note.txt', 'text/plain', 2)
  return {
    id: fileId,
    parent_id: null,
    name_encrypted: nameEncrypted,
    size_bytes: PLAINTEXT.length,
    is_folder: false,
    chunk_count: 3,
    version_number: 1,
    has_thumbnail: false,
    thumbnail_encrypted: null,
    updated_at: '2026-10-01T00:00:00Z',
    wrapped_file_key: null,
    ...overrides,
  }
}

const proof = { token: 't', proof: 'proof-value', expiresAt: Date.now() + 60_000 }

beforeEach(() => {
  calls = []
  status = 200
  serverChunkSize = null
})

// Installed once; each test sets the body it wants the download route to serve.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>
  calls.push({ url: String(input), headers })
  if (status !== 200) return new Response('nope', { status })
  return new Response(new Blob([bodyFor() as BlobPart]).stream(), { status: 200, headers: serverChunkSize ? { 'X-Chunk-Size': String(serverChunkSize) } : {} })
}) as typeof fetch

describe('fetchGuestPlaintextBlob', () => {
  test('a 3-chunk ciphertext stream decrypts to the original bytes', async () => {
    const fileId = '11111111-1111-4111-8111-111111111111'
    bodyFor = () => encryptedFrames(fileId)
    const blob = await fetchGuestPlaintextBlob({
      token: 'tok',
      item: item(fileId),
      fileKey: fileKeyFor(fileId),
      proof,
      chunkSize: CHUNK_SIZE,
    })
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('hello guest preview')
    expect(blob.type.startsWith('text/plain')).toBe(true)
  })

  test('the download carries the proof header and no Authorization header', async () => {
    const fileId = '22222222-2222-4222-8222-222222222222'
    bodyFor = () => encryptedFrames(fileId)
    await fetchGuestPlaintextBlob({
      token: 'tok',
      item: item(fileId),
      fileKey: fileKeyFor(fileId),
      proof,
      chunkSize: CHUNK_SIZE,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/f/tok/items/')
    expect(calls[0].headers['x-folder-link-proof']).toBe('proof-value')
    expect(calls[0].headers.Authorization).toBeUndefined()
  })

  test('a metadata/content mismatch throws and returns no blob', async () => {
    const fileId = '33333333-3333-4333-8333-333333333333'
    const otherId = '44444444-4444-4444-8444-444444444444'
    bodyFor = () => encryptedFrames(otherId)
    let threw = false
    let result: Blob | null = null
    try {
      result = await fetchGuestPlaintextBlob({
        token: 'tok',
        item: item(fileId),
        fileKey: fileKeyFor(fileId),
        proof,
        chunkSize: CHUNK_SIZE,
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(result).toBeNull()
  })

  test('a file over the preview cap throws before any fetch', async () => {
    const fileId = '55555555-5555-4555-8555-555555555555'
    let error: unknown = null
    try {
      await fetchGuestPlaintextBlob({
        token: 'tok',
        item: item(fileId, { size_bytes: GUEST_PREVIEW_MAX_BYTES + 1 }),
        fileKey: fileKeyFor(fileId),
        proof,
      })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(GuestPreviewTooLargeError)
    expect(calls).toHaveLength(0)
  })
})


test('A2 server chunk header drives preview framing without a caller override', async () => {
  const id = '66666666-6666-4666-8666-666666666666'
  serverChunkSize = 8
  bodyFor = () => encryptedFrames(id, 8)
  const blob = await fetchGuestPlaintextBlob({ token: 'tok', item: item(id), fileKey: fileKeyFor(id), proof })
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PLAINTEXT)
})
