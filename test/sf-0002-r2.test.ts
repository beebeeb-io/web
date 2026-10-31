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

await installWasmCryptoMirror()
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
