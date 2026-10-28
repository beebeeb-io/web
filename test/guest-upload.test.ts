/**
 * Task 2237b — guest upload engine.
 *
 * The engine talks to the public folder routes exactly as the server expects:
 * `metadata` plus contiguous `chunk_N` parts, no gaps, and a `wrapped_key` that
 * opens with the link's folder key. Crypto is mirrored with WebCrypto so the
 * wire bytes can be decrypted in the test.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const subtle = crypto.subtle

async function seal(key: Uint8Array, plaintext: Uint8Array) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cryptoKey, plaintext as BufferSource),
  )
  return { nonce, ciphertext }
}

async function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array) {
  const cryptoKey = await subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ])
  return new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      cryptoKey,
      ciphertext as BufferSource,
    ),
  )
}

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function unb64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

await mockModuleScoped('../src/lib/crypto', import.meta.dir, {
  encryptChunk: seal,
  encryptFilename: (key: Uint8Array, name: string) =>
    seal(key, new TextEncoder().encode(name)),
  readNameMetadata: async (key: Uint8Array, serialized: string) => {
    const parsed = JSON.parse(serialized) as { nonce: number[]; ciphertext: number[] }
    const plain = await open(key, Uint8Array.from(parsed.nonce), Uint8Array.from(parsed.ciphertext))
    const text = new TextDecoder().decode(plain)
    // Real records are JSON name metadata; a bare string is a legacy name.
    try {
      const meta = JSON.parse(text) as { name?: string; mime_type?: string | null }
      if (typeof meta.name === 'string') return { name: meta.name, mimeType: meta.mime_type ?? null }
    } catch {
      // fall through
    }
    return { name: text, mimeType: null }
  },
  encryptFileMetadata: async (key: Uint8Array, name: string, mimeType?: string | null) => {
    const json = JSON.stringify({ name, mime_type: mimeType ?? null })
    return seal(key, new TextEncoder().encode(json))
  },
  serializeEncryptedBlob: (nonce: Uint8Array, ciphertext: Uint8Array) =>
    JSON.stringify({
      cipher_suite: 'V1Aes256Gcm',
      nonce: Array.from(nonce),
      ciphertext: Array.from(ciphertext),
    }),
  toBase64: b64,
  wrapKeyForShare: async (wrapKey: Uint8Array, keyToWrap: Uint8Array) => {
    const { nonce, ciphertext } = await seal(wrapKey, keyToWrap)
    const out = new Uint8Array(nonce.length + ciphertext.length)
    out.set(nonce, 0)
    out.set(ciphertext, nonce.length)
    return out
  },
})

const {
  MAX_GUEST_CHUNKS,
  MIN_GUEST_CHUNK_BYTES,
  planGuestChunks,
  rejectMessage,
  resolveGuestName,
  uploadGuestFiles,
} = await import('../src/lib/guest-upload')

const {
  ACTOR_NAME_STORAGE_PREFIX,
  decryptActorName,
  encryptActorName,
  readActorName,
  storeActorName,
  storeActorNameSkipped,
} = await import('../src/lib/guest-actor-name')

type UploadCall = { url: string; proof: string | null; form: FormData }
let calls: UploadCall[] = []
let folderSeq = 0
let nextResponse: () => Response = () =>
  Response.json({ file_id: `file-${calls.length}` }, { status: 201 })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const headers = new Headers(init?.headers)
  if (url.includes('/folders')) {
    folderSeq += 1
    return Response.json({ id: `folder-${folderSeq}` }, { status: 201 })
  }
  calls.push({
    url,
    proof: headers.get('x-folder-link-proof'),
    form: init?.body as FormData,
  })
  return nextResponse()
}) as typeof fetch

function fileOf(name: string, bytes: number, type = 'text/plain'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function metadataOf(form: FormData): Promise<Record<string, unknown>> {
  const raw = form.get('metadata')
  if (typeof raw !== 'string') throw new Error('metadata must be a string field')
  return JSON.parse(raw) as Record<string, unknown>
}

async function decryptName(nameEncrypted: string, wrappedKey: string, folderKey: Uint8Array) {
  const frame = unb64(wrappedKey)
  const fileKey = await open(folderKey, frame.slice(0, 12), frame.slice(12))
  const meta = JSON.parse(nameEncrypted) as { nonce: number[]; ciphertext: number[] }
  const plain = await open(fileKey, Uint8Array.from(meta.nonce), Uint8Array.from(meta.ciphertext))
  return JSON.parse(new TextDecoder().decode(plain)) as { name: string; mime_type: string | null }
}

const FOLDER_KEY = new Uint8Array(32).fill(3)

function storageStub(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

globalThis.localStorage = storageStub()

beforeEach(() => {
  calls = []
  folderSeq = 0
  nextResponse = () => Response.json({ file_id: `file-${calls.length}` }, { status: 201 })
  localStorage.clear()
})

describe('planGuestChunks', () => {
  test('a zero-byte file and a 64 KiB file are one 64 KiB chunk', () => {
    expect(planGuestChunks(0)).toEqual({ chunkSize: MIN_GUEST_CHUNK_BYTES, chunkCount: 1 })
    expect(planGuestChunks(65_536)).toEqual({ chunkSize: 65_536, chunkCount: 1 })
  })

  test('a 10 GiB file plans at most 1024 chunks and every non-final chunk is at least 64 KiB', () => {
    expect(planGuestChunks(10 * 1024 ** 3).chunkCount).toBeLessThanOrEqual(MAX_GUEST_CHUNKS)
    expect(MAX_GUEST_CHUNKS).toBe(1024)

    for (const size of [1, 65_535, 65_536, 1e6, 5e9, 2e10]) {
      const plan = planGuestChunks(size)
      expect(plan.chunkSize).toBeGreaterThanOrEqual(MIN_GUEST_CHUNK_BYTES)
      expect(plan.chunkCount).toBeLessThanOrEqual(MAX_GUEST_CHUNKS)
      const nonFinalChunks = Math.max(0, plan.chunkCount - 1)
      expect(nonFinalChunks * plan.chunkSize).toBeLessThanOrEqual(Math.max(size, 0))
      if (nonFinalChunks > 0) expect(plan.chunkSize).toBeGreaterThanOrEqual(65_536)
    }
  })

  test('rejects a negative size', () => {
    expect(() => planGuestChunks(-1)).toThrow()
  })
})

describe('uploadGuestFiles', () => {
  test('sends metadata plus contiguous chunk parts and reports monotonic progress ending in added', async () => {
    const events: number[] = []
    const result = await uploadGuestFiles({
      token: 'tok',
      folderKey: FOLDER_KEY,
      proof: { token: 'tok', proof: 'proof-value', expiresAt: Date.now() + 60_000 },
      parentId: null,
      tasks: [{ file: fileOf('notes.txt', 70_000), relativePath: null }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: (event) => {
        if (event.state.name === 'uploading') events.push(event.state.percent)
      },
    })

    expect(result).toEqual({ added: 1, rejected: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/f/tok/upload')
    expect(calls[0].proof).toBe('proof-value')

    const indices = [...calls[0].form.keys()]
      .filter((key) => key.startsWith('chunk_'))
      .map((key) => Number(key.slice('chunk_'.length)))
      .sort((a, b) => a - b)
    expect(indices).toEqual(Array.from({ length: indices.length }, (_, index) => index))
    expect(indices.length).toBeGreaterThan(1)
    expect(calls[0].form.getAll('metadata')).toHaveLength(1)

    expect(events[0]).toBe(0)
    expect(events).toEqual([...events].sort((a, b) => a - b))
    expect(events[events.length - 1]).toBe(100)

    const metadata = await metadataOf(calls[0].form)
    expect(metadata.parent_id).toBeNull()
    expect(metadata.actor_name_encrypted).toBeUndefined()
    expect('actor_name_encrypted' in metadata).toBe(false)
  })

  test('maps server rejections to reasons', async () => {
    const cases: Array<[number, string | undefined, string]> = [
      [409, 'cap_exceeded', 'cap'],
      [409, 'link_paused', 'paused'],
      [429, undefined, 'rate'],
      [403, undefined, 'level'],
      [404, undefined, 'folder_gone'],
      [413, undefined, 'quota'],
    ]

    for (const [status, code, expected] of cases) {
      calls = []
      nextResponse = () =>
        Response.json(code ? { error: code } : { error: 'nope' }, { status })
      const events: Array<{ name: string; reason?: string }> = []
      const result = await uploadGuestFiles({
        token: 'tok',
        folderKey: FOLDER_KEY,
        proof: null,
        parentId: null,
        tasks: [{ file: fileOf('a.txt', 10), relativePath: null }],
        siblingNames: new Map(),
        actorNameEncrypted: null,
        onEvent: (event) => events.push({ name: event.state.name, reason: event.state.name === 'rejected' ? event.state.reason : undefined }),
      })
      expect(result).toEqual({ added: 0, rejected: 1 })
      const rejected = events.find((event) => event.name === 'rejected')
      expect(rejected?.reason).toBe(expected)
      expect(rejectMessage(expected as never)).toBeString()
    }
  })

  test('two files with the same name: the second is sent as "note (2).txt"', async () => {
    const siblings = new Map<string, string>()
    await uploadGuestFiles({
      token: 'tok',
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [
        { file: fileOf('note.txt', 10), relativePath: null },
        { file: fileOf('note.txt', 10), relativePath: null },
      ],
      siblingNames: siblings,
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })

    expect(calls).toHaveLength(2)
    const second = await metadataOf(calls[1].form)
    const meta = await decryptName(
      String(second.name_encrypted),
      String(second.wrapped_key),
      FOLDER_KEY,
    )
    expect(meta.name).toBe('note (2).txt')
    expect(siblings.has('root:note (2).txt')).toBe(true)
  })

  test('a nested path creates Trip then 2019 before uploading the file', async () => {
    const urls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      return original(input as never, init)
    }) as typeof fetch

    await uploadGuestFiles({
      token: 'tok',
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.jpg', 10, 'image/jpeg'), relativePath: 'Trip/2019/a.jpg' }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })

    expect(urls.filter((url) => url.includes('/folders'))).toHaveLength(2)
    expect(urls.filter((url) => url.includes('/upload'))).toHaveLength(1)
    expect(urls.findIndex((url) => url.includes('/folders'))).toBeLessThan(
      urls.findIndex((url) => url.includes('/upload')),
    )
    const metadata = await metadataOf(calls[0].form)
    expect(metadata.parent_id).toBe('folder-2')
    globalThis.fetch = original
  })

  test('resolveGuestName is case-insensitive and keeps the extension', async () => {
    const existing = new Map<string, string>([['root:note.txt', 'id']])
    expect(await resolveGuestName(null, 'Note.TXT', existing)).toBe('Note (2).TXT')
    expect(await resolveGuestName(null, 'other.txt', existing)).toBe('other.txt')
  })
})

describe('actor name', () => {
  test('round-trips and never stores plaintext', async () => {
    const name = 'Anouk de Vries'
    const encrypted = await storeActorName('folder-1', FOLDER_KEY, name)
    expect(localStorage.getItem(ACTOR_NAME_STORAGE_PREFIX + 'folder-1')).toBe(encrypted)
    expect(encrypted.indexOf(name)).toBe(-1)
    expect(await readActorName('folder-1', FOLDER_KEY)).toBe(name)
  })

  test('a different folder key reads null instead of throwing', async () => {
    const encrypted = await encryptActorName(FOLDER_KEY, 'Anouk')
    expect(await decryptActorName(new Uint8Array(32).fill(8), encrypted)).toBeNull()
  })

  test('readActorName is null when nothing was stored', async () => {
    expect(await readActorName('folder-2', FOLDER_KEY)).toBeNull()
  })

  test('a skipped prompt stays remembered as empty, not as never asked', async () => {
    storeActorNameSkipped('folder-3')
    expect(await readActorName('folder-3', FOLDER_KEY)).toBe('')
    expect(localStorage.getItem(ACTOR_NAME_STORAGE_PREFIX + 'folder-3')).toBe('')
  })
})
