/**
 * Task 2237b — guest upload engine.
 *
 * The engine talks to the public folder routes exactly as the server expects:
 * `metadata` FIRST (carrying the client-proposed id, L7a) plus contiguous
 * `chunk_N` parts, no gaps, and a `wrapped_key` that opens with the link's
 * folder key ONLY for (shared root, that id, file) through core (L7). Chunk and
 * name crypto is mirrored with WebCrypto so the wire bytes can be decrypted in
 * the test; the child wraps are core's, in process.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'

// fetch and localStorage are replaced for this file only (helpers/scoped-global.ts).
preserveGlobals('fetch', 'localStorage')

const ROOT = '11111111-1111-4111-8111-111111111111'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const owned = ownedFolderCrypto()

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
  planChunks: async (size: number, profile: string) => loadWasm().plan_chunks(BigInt(size), profile),
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
  fromBase64: unb64,
  wrapFolderChild: owned.wrapFolderChild,
  unwrapFolderChild: owned.unwrapFolderChild,
})

const {
  MAX_GUEST_CHUNKS,
  MIN_GUEST_CHUNK_BYTES,
  SHARE_BUSY_WAITS_MS,
  guestWriteTiming,
  planGuestChunks,
  rejectMessage,
  resolveGuestName,
  uploadGuestFiles,
} = await import('../src/lib/guest-upload')

// Busy retries wait in the real app; here they only count.
const waits: number[] = []
guestWriteTiming.wait = async (ms: number) => {
  waits.push(ms)
}

const {
  ACTOR_NAME_STORAGE_PREFIX,
  decryptActorName,
  encryptActorName,
  readActorName,
  readActorNameCiphertext,
  storeActorName,
  storeActorNameSkipped,
} = await import('../src/lib/guest-actor-name')

type UploadCall = { url: string; proof: string | null; form: FormData }
let calls: UploadCall[] = []
let folderBodies: Record<string, unknown>[] = []
/** The server stores exactly the proposed id (L7a) and answers with it. */
function echoId(form: FormData): Response {
  const metadata = JSON.parse(String(form.get('metadata'))) as { id?: string }
  return Response.json({ file_id: metadata.id }, { status: 201 })
}
let nextResponse: (form: FormData) => Response = echoId
let nextFolderResponse: (body: Record<string, unknown>) => Response = (body) =>
  Response.json({ id: body.id }, { status: 201 })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const headers = new Headers(init?.headers)
  if (url.includes('/folders')) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    folderBodies.push(body)
    return nextFolderResponse(body)
  }
  const form = init?.body as FormData
  calls.push({
    url,
    proof: headers.get('x-folder-link-proof'),
    form,
  })
  return nextResponse(form)
}) as typeof fetch

function fileOf(name: string, bytes: number, type = 'text/plain'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function metadataOf(form: FormData): Promise<Record<string, unknown>> {
  const raw = form.get('metadata')
  if (typeof raw !== 'string') throw new Error('metadata must be a string field')
  return JSON.parse(raw) as Record<string, unknown>
}

/** Open a sealed name the way the owner would: core's L7 unwrap for exactly this row. */
async function decryptName(
  nameEncrypted: string,
  wrappedKey: string,
  folderKey: Uint8Array,
  itemId: string,
  isFolder = false,
) {
  const fileKey = await owned.unwrapFolderChild(folderKey, ROOT, itemId, isFolder ? 2 : 1, unb64(wrappedKey))
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

setGlobal('localStorage', storageStub())

beforeEach(() => {
  calls = []
  folderBodies = []
  waits.length = 0
  nextResponse = echoId
  nextFolderResponse = (body) => Response.json({ id: body.id }, { status: 201 })
  localStorage.clear()
})

describe('planGuestChunks', () => {
  test('a zero-byte file and a 64 KiB file use the desktop floor', async () => {
    expect(await planGuestChunks(0)).toEqual({ chunkSize: MIN_GUEST_CHUNK_BYTES, chunkCount: 1 })
    expect(await planGuestChunks(65_536)).toEqual({ chunkSize: MIN_GUEST_CHUNK_BYTES, chunkCount: 1 })
  })

  test('a 10 GiB file plans at most 1024 chunks with the desktop floor', async () => {
    expect((await planGuestChunks(10 * 1024 ** 3)).chunkCount).toBeLessThanOrEqual(MAX_GUEST_CHUNKS)
    expect(MAX_GUEST_CHUNKS).toBe(1024)

    for (const size of [1, 65_535, 65_536, 1e6, 5e9, 2e10]) {
      const plan = await planGuestChunks(size)
      expect(plan.chunkSize).toBeGreaterThanOrEqual(MIN_GUEST_CHUNK_BYTES)
      expect(plan.chunkCount).toBeLessThanOrEqual(MAX_GUEST_CHUNKS)
      const nonFinalChunks = Math.max(0, plan.chunkCount - 1)
      expect(nonFinalChunks * plan.chunkSize).toBeLessThanOrEqual(Math.max(size, 0))
      if (nonFinalChunks > 0) expect(plan.chunkSize).toBeGreaterThanOrEqual(65_536)
    }
  })

  test('rejects a negative size', async () => {
    await expect(planGuestChunks(-1)).rejects.toThrow()
  })
})

describe('uploadGuestFiles', () => {
  test('sends metadata plus contiguous chunk parts and reports monotonic progress ending in added', async () => {
    const events: number[] = []
    const result = await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: { token: 'tok', proof: 'proof-value', expiresAt: Date.now() + 60_000 },
      parentId: null,
      tasks: [{ file: fileOf('notes.txt', 5 * 1024**2), relativePath: null }],
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
    // L7a: the metadata part comes first and names the file's id.
    expect([...calls[0].form.keys()][0]).toBe('metadata')
    expect(String(metadata.id)).toMatch(UUID_V4)
  })

  test('maps server rejections to reasons', async () => {
    const cases: Array<[number, string | undefined, string]> = [
      [409, 'cap_exceeded', 'cap'],
      [409, 'link_paused', 'paused'],
      // Retried (nothing was stored), then reported as busy, never as full.
      [409, 'share_busy', 'busy'],
      // Re-sealed under fresh ids, then given up on.
      [409, 'id_taken', 'network'],
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
        rootId: ROOT,
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
      rootId: ROOT,
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
      String(second.id),
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
      rootId: ROOT,
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
    // Each folder carried its own proposed id; the file lands in the second.
    expect(folderBodies.map((body) => String(body.id))).toEqual([
      expect.stringMatching(UUID_V4),
      expect.stringMatching(UUID_V4),
    ])
    expect(folderBodies[1].parent_id).toBe(folderBodies[0].id)
    expect(metadata.parent_id).toBe(folderBodies[1].id)
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

  test('the sealed name for a later batch is the stored ciphertext, null when skipped or foreign', async () => {
    const encrypted = await storeActorName('folder-4', FOLDER_KEY, 'Mum')
    expect(await readActorNameCiphertext('folder-4', FOLDER_KEY)).toBe(encrypted)
    storeActorNameSkipped('folder-5')
    expect(await readActorNameCiphertext('folder-5', FOLDER_KEY)).toBeNull()
    expect(await readActorNameCiphertext('folder-6', FOLDER_KEY)).toBeNull()
    // Sealed under another folder key: never sent as this folder's name.
    expect(await readActorNameCiphertext('folder-4', new Uint8Array(32).fill(8))).toBeNull()
  })
})


describe('2237b review regressions', () => {
  test('A1 guest chunks match server desktop inference at every ladder boundary', async () => {
    const wasm = loadWasm()
    for (const size of [0, 65537, 5 * 1024**2 + 1, 129 * 1024**2, 2 * 1024**3, 10 * 1024**3]) {
      const expected = wasm.plan_chunks(BigInt(size), 'desktop')
      expect(await planGuestChunks(size)).toEqual({ chunkSize: Number(expected.chunk_size_bytes), chunkCount: Number(expected.chunk_count) })
    }
  })

  test('A3 nested folder name and all descendant keys open under the shared root', async () => {
    await uploadGuestFiles({ token: 'tok', rootId: ROOT, folderKey: FOLDER_KEY, proof: null, parentId: null,
      tasks: [{ file: fileOf('a.txt', 17), relativePath: 'Trip/2019/a.txt' }],
      siblingNames: new Map(), actorNameEncrypted: null, onEvent: () => undefined })
    expect(folderBodies).toHaveLength(2)
    for (const [i, body] of folderBodies.entries()) {
      const meta = await decryptName(String(body.name_encrypted), String(body.wrapped_name_key), FOLDER_KEY, String(body.id), true)
      expect(meta.name).toBe(['Trip', '2019'][i])
    }
    const body = await metadataOf(calls[0].form)
    expect((await decryptName(String(body.name_encrypted), String(body.wrapped_key), FOLDER_KEY, String(body.id))).name).toBe('a.txt')
  })
})

describe('L7 and L7a: every guest write is bound to the id it proposes', () => {
  const upload = (name = 'a.txt') =>
    uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf(name, 10), relativePath: null }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })

  test("a file's wrap opens for its own id, as a file, under this root only", async () => {
    await upload()
    const metadata = await metadataOf(calls[0].form)
    const id = String(metadata.id)
    const wrap = unb64(String(metadata.wrapped_key))
    expect(wrap.length).toBe(60)
    await owned.unwrapFolderChild(FOLDER_KEY, ROOT, id, 1, wrap)
    expect(() => loadWasm().unwrapFolderChild(FOLDER_KEY, ROOT, crypto.randomUUID(), 1, wrap)).toThrow(/decryption failed/)
    expect(() => loadWasm().unwrapFolderChild(FOLDER_KEY, ROOT, id, 2, wrap)).toThrow(/decryption failed/)
    expect(() => loadWasm().unwrapFolderChild(FOLDER_KEY, crypto.randomUUID(), id, 1, wrap)).toThrow(/decryption failed/)
  })

  test('409 id_taken: the write is re-sealed under a fresh id, and the stored id is the new one', async () => {
    let first = true
    nextResponse = (form) => {
      if (first) {
        first = false
        return Response.json({ error: 'id_taken' }, { status: 409 })
      }
      return echoId(form)
    }
    const events: Array<{ name: string; fileId?: string }> = []
    const result = await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.txt', 10), relativePath: null }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: (event) => events.push({ name: event.state.name, fileId: event.state.name === 'added' ? event.state.fileId : undefined }),
    })
    expect(result).toEqual({ added: 1, rejected: 0 })
    expect(calls).toHaveLength(2)
    const [refused, accepted] = await Promise.all(calls.map((call) => metadataOf(call.form)))
    expect(accepted.id).not.toBe(refused.id)
    // The second wrap is bound to the second id, not the refused one.
    const wrap = unb64(String(accepted.wrapped_key))
    await owned.unwrapFolderChild(FOLDER_KEY, ROOT, String(accepted.id), 1, wrap)
    expect(() => loadWasm().unwrapFolderChild(FOLDER_KEY, ROOT, String(refused.id), 1, wrap)).toThrow(/decryption failed/)
    expect(events.find((event) => event.name === 'added')?.fileId).toBe(String(accepted.id))
  })

  test('409 share_busy is waited out and retried; nothing is reported as a full folder', async () => {
    let busy = 2
    nextResponse = (form) => {
      if (busy > 0) {
        busy -= 1
        return Response.json({ error: 'share_busy' }, { status: 409 })
      }
      return echoId(form)
    }
    expect(await upload()).toEqual({ added: 1, rejected: 0 })
    expect(calls).toHaveLength(3)
    expect(waits).toEqual(SHARE_BUSY_WAITS_MS.slice(0, 2))
  })

  test('a server that stores another id is refused: that row would be unreadable', async () => {
    nextResponse = () => Response.json({ file_id: crypto.randomUUID() }, { status: 201 })
    expect(await upload()).toEqual({ added: 0, rejected: 1 })
    nextFolderResponse = () => Response.json({ id: crypto.randomUUID() }, { status: 201 })
    nextResponse = echoId
    const result = await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.txt', 10), relativePath: 'Trip/a.txt' }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })
    expect(result).toEqual({ added: 0, rejected: 1 })
  })

  test("a guest folder's name-key wrap opens for its own id as a folder only", async () => {
    await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.txt', 10), relativePath: 'Trip/a.txt' }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })
    const folder = folderBodies[0]
    const wrap = unb64(String(folder.wrapped_name_key))
    await owned.unwrapFolderChild(FOLDER_KEY, ROOT, String(folder.id), 2, wrap)
    expect(() => loadWasm().unwrapFolderChild(FOLDER_KEY, ROOT, String(folder.id), 1, wrap)).toThrow(/decryption failed/)
  })
})

// Frozen contract 2237 §1: every guest write inserts a shared_folder_keys row
// sealed with L7, so it says so. The upload's metadata part still comes first.
describe('contract 2237 §1: guest writes declare format "l7"', () => {
  test('the upload metadata (the first part) carries format "l7"', async () => {
    await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.txt', 10), relativePath: null }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })
    expect([...calls[0].form.keys()][0]).toBe('metadata')
    expect((await metadataOf(calls[0].form)).format).toBe('l7')
  })

  test('a guest folder create carries format "l7"', async () => {
    await uploadGuestFiles({
      token: 'tok',
      rootId: ROOT,
      folderKey: FOLDER_KEY,
      proof: null,
      parentId: null,
      tasks: [{ file: fileOf('a.txt', 10), relativePath: 'Trip/a.txt' }],
      siblingNames: new Map(),
      actorNameEncrypted: null,
      onEvent: () => undefined,
    })
    expect(folderBodies[0].format).toBe('l7')
  })
})
