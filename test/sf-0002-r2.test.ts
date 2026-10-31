// SF-0002 review round 2 (2026-10-31, web #204): the write-time read-only
// check, the flag-off key path and the read/share keys of repaired rows.
// Driven through the real WASM build (core's own vectors) and the real guard.
import { beforeEach, describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import { hexToBytes, installWasmCryptoMirror, loadVectors } from './helpers/wasm-crypto-mirror'
import {
  OWNER_REPAIR_READ_ONLY,
  clearOwnerRepairReadOnly,
  isOwnerRepairReadOnly,
  markOwnerRepairReadOnly,
} from '../src/lib/owner-repair'

await installWasmCryptoMirror()
const { assertCurrentVersionWritable } = await import('../src/lib/owner-write-guard')

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
