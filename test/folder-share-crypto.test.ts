import { describe, expect, mock, test } from 'bun:test'

// Stub ./crypto so importing folder-share-crypto doesn't pull in the worker/WASM.
// collectAllChildren only touches listFiles.
mock.module('../src/lib/crypto', () => ({
  encryptChunk: async () => new Uint8Array(),
  decryptChunk: async () => new Uint8Array(),
  deriveFileKey: async () => new Uint8Array(32),
  deriveX25519Private: async () => new Uint8Array(32),
  x25519SharedSecret: async () => new Uint8Array(32),
  deriveShareKey: async () => new Uint8Array(32),
  fromBase64: () => new Uint8Array(),
  toBase64: () => '',
  zeroize: () => {},
}))

// Controllable listFiles for the folder-enumeration tests.
let listFilesImpl: (
  parentId?: string,
  trashed?: unknown,
  opts?: { limit?: number },
) => Promise<Array<{ id: string; is_folder: boolean }>>
mock.module('../src/lib/api', () => ({
  listFiles: (parentId?: string, trashed?: unknown, opts?: { limit?: number }) =>
    listFilesImpl(parentId, trashed, opts),
}))

describe('collectAllChildren — folder-share completeness guard (0709; server cap → 0739)', () => {
  test('requests the server max page size (limit 500)', async () => {
    let seenLimit: number | undefined
    listFilesImpl = async (_p, _t, opts) => {
      seenLimit = opts?.limit
      return []
    }
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    await collectAllChildren('root')
    expect(seenLimit).toBe(500)
  })

  test('refuses (throws) on a full 500-item page — never silently half-shares a truncated folder', async () => {
    // The server clamps list_files to ≤500 and exposes no cursor, so a full page
    // means there may be more children we cannot reach. Refuse loudly.
    listFilesImpl = async () =>
      Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, is_folder: false }))
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    await expect(collectAllChildren('root')).rejects.toThrow(/too large to share/i)
  })

  test('collects a complete sub-500 tree, recursing into subfolders', async () => {
    listFilesImpl = async (parentId) => {
      if (parentId === 'root') return [{ id: 'a', is_folder: false }, { id: 'sub', is_folder: true }]
      if (parentId === 'sub') return [{ id: 'b', is_folder: false }]
      return []
    }
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    const ids = await collectAllChildren('root')
    expect([...ids].sort()).toEqual(['a', 'b', 'sub'])
  })
})
