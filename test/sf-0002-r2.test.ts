// SF-0002 review round 2 (2026-10-31, web #204): the write-time read-only
// check, the flag-off key path and the read/share keys of repaired rows.
// Driven through the real WASM build (core's own vectors) and the real guard.
import { beforeEach, describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import { hexToBytes, installWasmCryptoMirror, loadVectors, loadWasm } from './helpers/wasm-crypto-mirror'
import {
  OWNER_REPAIR_READ_ONLY,
  clearOwnerRepairReadOnly,
  isOwnerRepairReadOnly,
  markOwnerRepairReadOnly,
} from '../src/lib/owner-repair'

// transferFrames: a pushed frame is detached, as Comlink.transfer does in the app.
const mirror = await installWasmCryptoMirror({ transferFrames: true })
const { assertCurrentVersionWritable, OWNER_WRITE_CHECK_FAILED } = await import('../src/lib/owner-write-guard')

const vectors = loadVectors()
const V1 = vectors.upper_repair_v1

function row(over: Partial<DriveFile>): DriveFile {
  return {
    id: V1.file_id,
    name_encrypted: V1.name_encrypted,
    is_folder: false,
    size_bytes: 0,
    chunk_count: 1,
    updated_at: '2026-10-31T00:00:00Z',
    ...over,
  } as unknown as DriveFile
}

interface Call {
  method: string
  url: string
}

/** Replace fetch for one test; every request is recorded as METHOD + URL. */
function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url })
    return handler(url, init)
  }) as unknown as typeof fetch
  return {
    calls,
    downloads: () => calls.filter((c) => c.url.includes('/download')),
    writes: () => calls.filter((c) => c.method === 'PATCH' || c.method === 'POST' || c.method === 'PUT'),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

describe('W1: a folder has no content version to check', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a folder rename makes zero /download requests and is allowed', async () => {
    const master = hexToBytes(V1.master_key_hex)
    // A folder's /download answers 4xx; the check must never ask for it.
    const net = installFetch(() => new Response('{"error":"not_found"}', { status: 404 }))
    try {
      await expect(
        assertCurrentVersionWritable(row({ is_folder: true, size_bytes: 0, chunk_count: 0 }), master),
      ).resolves.toBeUndefined()
      expect(net.downloads()).toHaveLength(0)
    } finally {
      net.restore()
    }
  })

  test('a folder whose name resolved as upper_repair is still refused by its mark', async () => {
    const master = hexToBytes(V1.master_key_hex)
    markOwnerRepairReadOnly(V1.file_id)
    const net = installFetch(() => new Response(null, { status: 404 }))
    try {
      await expect(
        assertCurrentVersionWritable(row({ is_folder: true, chunk_count: 0 }), master),
      ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(net.downloads()).toHaveLength(0)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    } finally {
      net.restore()
    }
  })
})

// ── W2: the probe fails CLOSED when nothing authenticates ───────────────────

const enc = new TextEncoder()

/** One v1 legacy wire frame (nonce || ciphertext || tag) sealed under `key`. */
function v1Frame(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const f = loadWasm().encrypt_chunk(key, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const out = new Uint8Array(f.nonce.length + f.ciphertext.length)
  out.set(f.nonce, 0)
  out.set(f.ciphertext, f.nonce.length)
  return out
}

/** A multi-chunk v1 body: `chunks` full chunks of `chunkSize` bytes, then a `tail`-byte last chunk. */
function multiChunkBody(key: Uint8Array, chunkSize: number, chunks: number, tail: number) {
  const frames: Uint8Array[] = []
  for (let i = 0; i < chunks; i++) frames.push(v1Frame(key, new Uint8Array(chunkSize).fill(i + 1)))
  frames.push(v1Frame(key, new Uint8Array(tail).fill(0xee)))
  const total = frames.reduce((n, f) => n + f.length, 0)
  const body = new Uint8Array(total)
  let at = 0
  for (const f of frames) {
    body.set(f, at)
    at += f.length
  }
  return { body, sizeBytes: chunkSize * chunks + tail, chunkCount: chunks + 1 }
}

describe('W2: no verdict is a refusal, never "writable"', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a multi-chunk upper_repair row whose real chunk size is larger than every candidate is refused', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const upperKey = hexToBytes(V1.expected_key_hex)
    // Real chunk 3000 B; the server's X-Chunk-Size (a legacy row's computed
    // value) says 1000. Candidates: 1028, the 1 MiB / 4 MiB frames (longer than
    // the body) and the average (2061): none is frame 0's length.
    const { body, sizeBytes, chunkCount } = multiChunkBody(upperKey, 3000, 2, 100)
    const net = installFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { 'X-Chunk-Size': '1000', 'X-Chunk-Count': String(chunkCount) },
        }),
    )
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: sizeBytes, chunk_count: chunkCount }), master),
      ).rejects.toThrow(OWNER_WRITE_CHECK_FAILED)
      // Unknown is not read-only: nothing is marked, a retry asks again.
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
    } finally {
      net.restore()
    }
  })

  test('a frame core cannot open under any owner convention (it throws for every candidate) is refused', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const garbage = new Uint8Array(64).fill(0x42)
    const net = installFetch(
      () => new Response(garbage, { status: 200, headers: { 'X-Chunk-Size': '36', 'X-Chunk-Count': '1' } }),
    )
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: 36, chunk_count: 1 }), master),
      ).rejects.toThrow(OWNER_WRITE_CHECK_FAILED)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
    } finally {
      net.restore()
    }
  })

  test('a failed download is refused with the retryable copy, never marked read-only', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const net = installFetch(() => new Response('{"error":"not_found"}', { status: 404 }))
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: 10, chunk_count: 1 }), master),
      ).rejects.toThrow(OWNER_WRITE_CHECK_FAILED)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
    } finally {
      net.restore()
    }
  })

  test('an ordinary multi-chunk row is writable (frame 0 sized from X-Chunk-Size)', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const { body, sizeBytes, chunkCount } = multiChunkBody(derived, 3000, 2, 100)
    const net = installFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { 'X-Chunk-Size': '3000', 'X-Chunk-Count': String(chunkCount) },
        }),
    )
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: sizeBytes, chunk_count: chunkCount }), master),
      ).resolves.toBeUndefined()
    } finally {
      net.restore()
    }
  })

  test('an upper_repair multi-chunk row is read-only when frame 0 is found', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const upperKey = hexToBytes(V1.expected_key_hex)
    const { body, sizeBytes, chunkCount } = multiChunkBody(upperKey, 3000, 2, 100)
    const net = installFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { 'X-Chunk-Size': '3000', 'X-Chunk-Count': String(chunkCount) },
        }),
    )
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: sizeBytes, chunk_count: chunkCount }), master),
      ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    } finally {
      net.restore()
    }
  })

  test("a member's row in a shared folder is not probed (its key is not the owner's)", async () => {
    const master = hexToBytes(V1.master_key_hex)
    const net = installFetch(() => new Response(new Uint8Array(64).fill(1), { status: 200 }))
    try {
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: 36, chunk_count: 1, uploaded_by: 'member-1' }), master, {
          viewerId: 'owner-1',
        }),
      ).resolves.toBeUndefined()
      await expect(
        assertCurrentVersionWritable(row({ size_bytes: 36, chunk_count: 1, acted_via_share_id: 'link-1' }), master, {
          viewerId: 'owner-1',
        }),
      ).resolves.toBeUndefined()
      expect(net.downloads()).toHaveLength(0)
    } finally {
      net.restore()
    }
  })
})

// ── W3: the flag-off key path is main's ─────────────────────────────────────

const { resolveOwnerKeyForFile } = await import('../src/lib/key-context')

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('W3: shared-folders flag off keeps the derived key (rv-web198d R1)', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('flag off: a row with acted_via_share_id gets the derived key, as on main', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const key = await resolveOwnerKeyForFile(
      master,
      row({ acted_via_share_id: 'share-id', uploaded_by: null }),
      'me',
      null,
      async () => false,
    )
    expect(hex(key)).toBe(hex(derived))
  })

  test("flag off: a member's row gets the derived key too", async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const key = await resolveOwnerKeyForFile(
      master,
      row({ acted_via_share_id: null, uploaded_by: 'member-1' }),
      'me',
      null,
      async () => false,
    )
    expect(hex(key)).toBe(hex(derived))
  })

  test('flag on: a foreign row the shared path cannot open stays unavailable', async () => {
    const master = hexToBytes(V1.master_key_hex)
    await expect(
      resolveOwnerKeyForFile(master, row({ acted_via_share_id: 'share-id' }), 'me', null, async () => true),
    ).rejects.toThrow("Can't open this file")
  })
})

// ── W4: every write path is guarded, not only the dialog rename ─────────────

const { renameOwnerRow } = await import('../src/lib/owner-rename')
const { writeFileNote } = await import('../src/lib/file-note')
const { restoreOwnerVersion } = await import('../src/lib/owner-write-guard')

const UPPER_FRAME = hexToBytes(V1.content_frame_hex)
const UPPER_PLAINTEXT_LEN = V1.content_plaintext_hex.length / 2
const VERSION_ID = '0b9d6f1e-6f2a-4c3e-9a51-1d2e3f4a5b6c'

/** An owner row whose NAME is ordinary but whose current content is upper_repair-sealed, never opened. */
function contentOnlyUpperRow(): DriveFile {
  const master = hexToBytes(V1.master_key_hex)
  const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
  return row({
    name_encrypted: loadWasm().encrypt_name_for(derived, 'notes.txt', null, 0) as string,
    size_bytes: UPPER_PLAINTEXT_LEN,
    chunk_count: 1,
    acted_via_share_id: null,
    uploaded_by: 'me',
  })
}

/** The server: /download and /versions/:id/download answer with the given frames; writes answer JSON. */
function server(current: Uint8Array, version: Uint8Array = current) {
  return installFetch((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && url.endsWith(`/versions/${VERSION_ID}/download`)) {
      return new Response(version, { status: 200, headers: { 'X-Chunk-Count': '1', 'X-Chunk-Size': String(version.length - 28) } })
    }
    if (method === 'GET' && url.endsWith('/download')) {
      return new Response(current, { status: 200, headers: { 'X-Chunk-Count': '1', 'X-Chunk-Size': String(current.length - 28) } })
    }
    if (method === 'POST' && url.includes('/restore')) {
      return new Response(JSON.stringify({ message: 'restored', version_number: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(row({})), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

function ordinaryFrame(): Uint8Array {
  const master = hexToBytes(V1.master_key_hex)
  const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
  return v1Frame(derived, new Uint8Array(UPPER_PLAINTEXT_LEN).fill(7))
}

function renameArgs(file: DriveFile) {
  const master = hexToBytes(V1.master_key_hex)
  const derived = () => loadWasm().derive_file_key(master, enc.encode(V1.file_id))
  return {
    fileId: file.id,
    file,
    newName: 'renamed.txt',
    viewerId: null,
    residentUserId: 'me',
    masterKey: master,
    getFileKey: async () => derived(),
    getFileKeyForFile: async () => derived(),
    readName: async () => undefined,
  }
}

describe('W4: inline rename (file list) goes through the write check', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a never-opened content-only upper_repair row is refused and nothing is PATCHed', async () => {
    const net = server(UPPER_FRAME)
    try {
      await expect(renameOwnerRow(renameArgs(contentOnlyUpperRow()))).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(net.writes()).toHaveLength(0)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    } finally {
      net.restore()
    }
  })

  test('an ordinary row is renamed: one PATCH carrying the new name', async () => {
    const net = server(ordinaryFrame())
    try {
      await renameOwnerRow(renameArgs(contentOnlyUpperRow()))
      const writes = net.writes()
      expect(writes).toHaveLength(1)
      expect(writes[0].method).toBe('PATCH')
      expect(writes[0].url).toEndWith(`/api/v1/files/${V1.file_id}`)
    } finally {
      net.restore()
    }
  })
})

describe('W4: note writes go through the write check', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  for (const text of ['a private note', '']) {
    test(`a never-opened content-only upper_repair row gets no note ${text ? 'write' : 'clear'}, and nothing is PATCHed`, async () => {
      const master = hexToBytes(V1.master_key_hex)
      const file = contentOnlyUpperRow()
      const net = server(UPPER_FRAME)
      try {
        await expect(
          writeFileNote({
            target: file,
            text,
            owner: { nameEncrypted: file.name_encrypted },
            masterKey: master,
            residentUserId: 'me',
            getFileKey: async () => loadWasm().derive_file_key(master, enc.encode(V1.file_id)),
          }),
        ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
        expect(net.writes()).toHaveLength(0)
      } finally {
        net.restore()
      }
    })
  }

  test('an ordinary row gets its note cleared: one PATCH', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const file = contentOnlyUpperRow()
    const net = server(ordinaryFrame())
    try {
      await expect(
        writeFileNote({
          target: file,
          text: '',
          owner: { nameEncrypted: file.name_encrypted },
          masterKey: master,
          residentUserId: 'me',
          getFileKey: async () => loadWasm().derive_file_key(master, enc.encode(V1.file_id)),
        }),
      ).resolves.toBeNull()
      expect(net.writes().map((w) => w.method)).toEqual(['PATCH'])
    } finally {
      net.restore()
    }
  })
})

describe('W4: version restore goes through the write check', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  const version = { id: VERSION_ID, size_bytes: UPPER_PLAINTEXT_LEN, chunk_count: 1 }

  test('a never-opened row whose CURRENT version is upper_repair is refused; nothing is POSTed', async () => {
    const net = server(UPPER_FRAME, ordinaryFrame())
    try {
      await expect(
        restoreOwnerVersion({ file: contentOnlyUpperRow(), version, masterKey: hexToBytes(V1.master_key_hex), residentUserId: 'me' }),
      ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(net.writes()).toHaveLength(0)
    } finally {
      net.restore()
    }
  })

  test('restoring an upper_repair VERSION to current is refused and marks the row; nothing is POSTed', async () => {
    const net = server(ordinaryFrame(), UPPER_FRAME)
    try {
      await expect(
        restoreOwnerVersion({ file: contentOnlyUpperRow(), version, masterKey: hexToBytes(V1.master_key_hex), residentUserId: 'me' }),
      ).rejects.toThrow(OWNER_REPAIR_READ_ONLY)
      expect(net.writes()).toHaveLength(0)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
    } finally {
      net.restore()
    }
  })

  test('an ordinary row and version restore: one POST', async () => {
    const net = server(ordinaryFrame(), ordinaryFrame())
    try {
      await restoreOwnerVersion({ file: contentOnlyUpperRow(), version, masterKey: hexToBytes(V1.master_key_hex), residentUserId: 'me' })
      expect(net.writes().map((w) => w.method)).toEqual(['POST'])
      expect(net.writes()[0].url).toEndWith(`/versions/${VERSION_ID}/restore`)
    } finally {
      net.restore()
    }
  })
})

// ── W5: server-busy retry, abort, and one probe per version ─────────────────

function ordinaryRow(over: Partial<DriveFile> = {}): DriveFile {
  return row({
    size_bytes: UPPER_PLAINTEXT_LEN,
    chunk_count: 1,
    acted_via_share_id: null,
    uploaded_by: 'me',
    version_number: 2,
    ...over,
  })
}

function frameResponse(frame: Uint8Array): Response {
  return new Response(frame, { status: 200, headers: { 'X-Chunk-Count': '1', 'X-Chunk-Size': String(frame.length - 28) } })
}

describe('W5: transient errors and repeated cost', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a 429 server_busy, then 200, is allowed after one retry', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const frame = ordinaryFrame()
    let n = 0
    const net = installFetch(() => {
      n++
      if (n === 1) {
        return new Response(JSON.stringify({ error: 'server_busy', retry_after: 0 }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        })
      }
      return frameResponse(frame)
    })
    try {
      await expect(assertCurrentVersionWritable(ordinaryRow(), master)).resolves.toBeUndefined()
      expect(net.downloads()).toHaveLength(2)
    } finally {
      net.restore()
    }
  })

  test('a 503 is not retried by the server-busy helper: refused with the retryable copy, never read-only', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const net = installFetch(() => new Response('unavailable', { status: 503 }))
    try {
      await expect(assertCurrentVersionWritable(ordinaryRow(), master)).rejects.toThrow(OWNER_WRITE_CHECK_FAILED)
      expect(net.downloads()).toHaveLength(1)
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
    } finally {
      net.restore()
    }
  })

  test('a second rename of the same row (same version) makes no /download request', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const frame = ordinaryFrame()
    const net = installFetch(() => frameResponse(frame))
    try {
      await assertCurrentVersionWritable(ordinaryRow(), master)
      // A rename changes updated_at but not the content version.
      await assertCurrentVersionWritable(ordinaryRow({ updated_at: '2026-10-31T01:00:00Z' }), master)
      expect(net.downloads()).toHaveLength(1)
      // A new content version is checked again.
      await assertCurrentVersionWritable(ordinaryRow({ version_number: 3 }), master)
      expect(net.downloads()).toHaveLength(2)
      // Locking the vault forgets every verdict.
      clearOwnerRepairReadOnly()
      await assertCurrentVersionWritable(ordinaryRow({ version_number: 3 }), master)
      expect(net.downloads()).toHaveLength(3)
    } finally {
      net.restore()
    }
  })

  test('an aborted check rejects as an abort, not as a verdict', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const frame = ordinaryFrame()
    const net = installFetch((_url, init) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
      return frameResponse(frame)
    })
    const ctl = new AbortController()
    ctl.abort()
    try {
      const err = await assertCurrentVersionWritable(ordinaryRow(), master, { signal: ctl.signal }).then(
        () => null,
        (e: unknown) => e,
      )
      expect((err as Error | null)?.name).toBe('AbortError')
      expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
      // Nothing was cached: the next check asks again.
      await assertCurrentVersionWritable(ordinaryRow(), master)
      expect(net.downloads()).toHaveLength(2)
    } finally {
      net.restore()
    }
  })
})

// ── W6: a split row (uppercase name, lowercase content) opens its content ───

const { decryptEncryptedBytes, pipeDecryptedChunks } = await import('../src/lib/encrypted-download')
const { rememberOwnerRepairKey } = await import('../src/lib/owner-repair')
const SPLIT = vectors.upper_repair_split_v1
const PIN_UNRECORDED = 0 as const

function splitRow(): DriveFile {
  return row({
    id: SPLIT.file_id,
    name_encrypted: SPLIT.name_encrypted,
    acted_via_share_id: null,
    uploaded_by: 'me',
  })
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

describe('W6 instrument: the worker hop detaches a pushed frame, as in the browser', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('a frame pushed into the decryptor is detached afterwards', async () => {
    const { startDecryptStream } = await import('../src/lib/crypto')
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const frame = v1Frame(derived, enc.encode('detach me'))
    const dec = await startDecryptStream(derived, V1.file_id, PIN_UNRECORDED)
    try {
      await dec.pushFrame(frame)
      expect(frame.byteLength).toBe(0)
    } finally {
      await dec.dispose()
    }
  })

  test('upper_repair_v1 (derived key, uppercase content) still opens: chunk 0 survives the failed push', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const plaintext = await decryptEncryptedBytes(
      derived,
      { fileId: V1.file_id, pin: PIN_UNRECORDED },
      hexToBytes(V1.content_frame_hex),
      1,
      UPPER_PLAINTEXT_LEN,
      undefined,
      master,
    )
    expect(hex(plaintext)).toBe(V1.content_plaintext_hex)
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(true)
  })
})

describe('W6: the content fallback follows the owner key the caller resolved', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('uppercase name + lowercase content: the name key the row resolved to opens the content (buffered)', async () => {
    const master = hexToBytes(SPLIT.master_key_hex)
    // The real resolver: the name only opens under the uppercase key.
    const nameKey = await resolveOwnerKeyForFile(master, splitRow(), 'me', null, async () => false)
    expect(hex(nameKey)).toBe(SPLIT.expected_name_key_hex)
    expect(isOwnerRepairReadOnly(SPLIT.file_id)).toBe(true)

    const plaintext = await decryptEncryptedBytes(
      nameKey,
      { fileId: SPLIT.file_id, pin: PIN_UNRECORDED },
      hexToBytes(SPLIT.content_v2_frame_hex),
      1,
      SPLIT.content_v2_plaintext_hex.length / 2,
      undefined,
      master,
    )
    expect(hex(plaintext)).toBe(SPLIT.content_v2_plaintext_hex)
  })

  test('uppercase name + lowercase content opens on the streamed path too', async () => {
    const master = hexToBytes(SPLIT.master_key_hex)
    const nameKey = await resolveOwnerKeyForFile(master, splitRow(), 'me', null, async () => false)
    const frame = hexToBytes(SPLIT.content_v2_frame_hex)
    const out: Uint8Array[] = []
    await pipeDecryptedChunks(
      streamOf(frame),
      nameKey,
      { fileId: SPLIT.file_id, pin: PIN_UNRECORDED },
      1,
      SPLIT.content_v2_plaintext_hex.length / 2,
      frame.length - 28,
      undefined,
      async (chunk) => {
        out.push(new Uint8Array(chunk))
      },
      undefined,
      master,
    )
    expect(hex(out[0])).toBe(SPLIT.content_v2_plaintext_hex)
  })

  test('a WRITABLE row (binary-convention name) is never switched to a different content key', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const binaryKey = loadWasm().derive_file_key(master, hexToBytes(V1.file_id.replace(/-/g, '')))
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    // The name resolved as binary (writable, cached); the content is string-sealed.
    rememberOwnerRepairKey(V1.file_id, { fileKey: binaryKey, convention: 'binary' })
    await expect(
      decryptEncryptedBytes(
        binaryKey,
        { fileId: V1.file_id, pin: PIN_UNRECORDED },
        v1Frame(derived, enc.encode('string content')),
        1,
        'string content'.length,
        undefined,
        master,
      ),
    ).rejects.toThrow()
    expect(isOwnerRepairReadOnly(V1.file_id)).toBe(false)
  })
})

// ── W7: the repaired content key is wiped once it seeds the decryptor ───────

describe('W7: repaired content keys are zeroized', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  const allZero = (k: Uint8Array) => k.length === 32 && k.every((b) => b === 0)

  test('buffered read (decryptEncryptedBytes)', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    mirror.contentRepairKeys.length = 0
    const plaintext = await decryptEncryptedBytes(
      derived,
      { fileId: V1.file_id, pin: PIN_UNRECORDED },
      hexToBytes(V1.content_frame_hex),
      1,
      UPPER_PLAINTEXT_LEN,
      undefined,
      master,
    )
    expect(hex(plaintext)).toBe(V1.content_plaintext_hex)
    expect(mirror.contentRepairKeys.length).toBeGreaterThan(0)
    expect(mirror.contentRepairKeys.every(allZero)).toBe(true)
  })

  test('streamed read (pipeDecryptedChunks)', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const derived = loadWasm().derive_file_key(master, enc.encode(V1.file_id))
    const frame = hexToBytes(V1.content_frame_hex)
    mirror.contentRepairKeys.length = 0
    const out: Uint8Array[] = []
    await pipeDecryptedChunks(
      streamOf(frame),
      derived,
      { fileId: V1.file_id, pin: PIN_UNRECORDED },
      1,
      UPPER_PLAINTEXT_LEN,
      frame.length - 28,
      undefined,
      async (chunk) => {
        out.push(new Uint8Array(chunk))
      },
      undefined,
      master,
    )
    expect(hex(out[0])).toBe(V1.content_plaintext_hex)
    expect(mirror.contentRepairKeys.length).toBeGreaterThan(0)
    expect(mirror.contentRepairKeys.every(allZero)).toBe(true)
  })
})

// ── W8: a share of a repaired row wraps the key that opens it ───────────────

const { shareFileKey } = await import('../src/lib/share-file-key')
const { wrapKeyForShare, unwrapKeyFromShare } = await import('../src/lib/crypto')

describe('W8: share links and invites of a repaired row', () => {
  beforeEach(() => clearOwnerRepairReadOnly())

  test('the link wraps the repair key: the recipient opens the name and the content', async () => {
    const master = hexToBytes(V1.master_key_hex)
    const file = row({ acted_via_share_id: null, uploaded_by: 'me' })
    const key = await shareFileKey(V1.file_id, {
      file,
      // What the dialog used before: the plain lowercase derivation.
      getFileKey: async () => loadWasm().derive_file_key(master, enc.encode(V1.file_id)),
      getFileKeyForFile: (f) => resolveOwnerKeyForFile(master, f, 'me', null, async () => false),
    })
    expect(hex(key)).toBe(V1.expected_key_hex)

    // The recipient: unwrap from the URL-fragment key, then open the row.
    const clientKey = crypto.getRandomValues(new Uint8Array(32))
    const opened = await unwrapKeyFromShare(clientKey, await wrapKeyForShare(clientKey, key))
    const name = loadWasm().decrypt_name_metadata_with_key(opened, V1.name_encrypted) as { name: string }
    expect(name.name).toBe('uppercase-repair.pdf')
    const frame = hexToBytes(V1.content_frame_hex)
    const content = loadWasm().decrypt_chunk(opened, frame.slice(0, 12), frame.slice(12))
    expect(hex(content)).toBe(V1.content_plaintext_hex)
  })

  test('without a row (forwarding a received file) the dialog keeps its previous key', async () => {
    const plain = new Uint8Array(32).fill(3)
    const key = await shareFileKey(V1.file_id, {
      getFileKey: async () => plain,
      getFileKeyForFile: async () => {
        throw new Error('not asked')
      },
    })
    expect(key).toBe(plain)
  })
})
