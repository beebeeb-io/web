import { describe, expect, test } from 'bun:test'
import { installMocks } from './helpers/upload-share-mocks'

// Task 2133: a later folder invite reuses the folder's existing key. The
// browser proof is e2e/2133-folder-second-invite.spec.ts; these pin the
// selection rules with injected ports (the WASM crypto worker is not loadable
// under bun test).
await installMocks()

const NOW = Date.parse('2026-10-22T12:00:00Z')
const inv = (o: Record<string, unknown>) =>
  ({ id: 'i', file_id: 'F', status: 'approved', created_at: '2026-10-22T10:00:00Z', is_folder_share: true, ...o }) as never

// Fake blob: 12 filler chars + the key name, e.g. "000000000000K1". A key
// named bad* "does not open". A child wrap "wrap:K1" is opened only by key K1.
const blob = (k: string) => '0'.repeat(12) + k
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

function makePorts(invites: unknown[], wraps: Record<string, { file_id: string; encrypted_file_key: string }[]> = {}) {
  const calls: string[] = []
  const zeroized: Uint8Array[] = []
  const derives: number[] = []
  const ports = {
    getSentInvites: async () => invites as never,
    // The real endpoint answers 400 "invite not approved" for any other status.
    getFolderKeys: async (id: string) => {
      calls.push(id)
      const row = (invites as { id: string; status: string }[]).find((i) => i.id === id)
      if (row?.status !== 'approved') throw new Error('400 invite not approved')
      return wraps[id] ?? []
    },
    deriveFileKey: async () => {
      derives.push(1)
      return enc('wrapping')
    },
    decryptChunk: async (_k: Uint8Array, _n: Uint8Array, ct: Uint8Array) => {
      if (dec(ct).startsWith('bad')) throw new Error('auth')
      return enc(dec(ct))
    },
    fromBase64: (s: string) => enc(s),
    decryptChildFileKey: async (fk: Uint8Array, w: string) => {
      if (w !== `wrap:${dec(fk)}`) throw new Error('wrap does not open')
      return enc('child')
    },
    zeroize: (b: Uint8Array) => {
      zeroized.push(b)
    },
    now: () => NOW,
  }
  return { ports, zeroized, derives, calls }
}

describe('ownerFolderKeyBlobs: active rows only', () => {
  test('keeps active (invited/claimed/approved, unexpired) rows of this folder, newest first', async () => {
    const { ownerFolderKeyBlobs } = await import('../src/lib/folder-share-crypto')
    const blobs = ownerFolderKeyBlobs(
      [
        inv({ encrypted_owner_folder_key: 'old', created_at: '2026-10-22T09:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'new', created_at: '2026-10-22T11:00:00Z', status: 'claimed' }),
        inv({ encrypted_owner_folder_key: 'pending', created_at: '2026-10-22T08:00:00Z', status: 'invited' }),
        inv({ encrypted_owner_folder_key: 'denied', status: 'denied' }),
        inv({ encrypted_owner_folder_key: 'expired', expires_at: '2026-10-22T11:59:00Z' }),
        inv({ encrypted_owner_folder_key: 'future', expires_at: '2026-10-23T00:00:00Z', created_at: '2026-10-22T07:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'other-folder', file_id: 'G' }),
        inv({ encrypted_owner_folder_key: 'file-share', is_folder_share: false }),
        inv({ encrypted_owner_folder_key: '' }),
        inv({}),
      ],
      'F',
      NOW,
    )
    expect(blobs).toEqual(['new', 'old', 'pending', 'future'])
  })
})

describe('findExistingFolderKey', () => {
  test('no invite at all: null (the caller mints)', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([inv({ file_id: 'G', encrypted_owner_folder_key: blob('K1') })])
    expect(await findExistingFolderKey(new Uint8Array(32), 'F', ports)).toBeNull()
  })

  test('only denied/expired rows remain (no active member): null, a fresh key is minted', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ encrypted_owner_folder_key: blob('K1'), status: 'denied' }),
      inv({ encrypted_owner_folder_key: blob('K1'), expires_at: '2026-10-01T00:00:00Z' }),
    ])
    expect(await findExistingFolderKey(new Uint8Array(32), 'F', ports)).toBeNull()
  })

  test('verify step: a key that opens but not the stored wraps is skipped; falls back newest-first to the one that does', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts(
      [
        inv({ id: 'new', encrypted_owner_folder_key: blob('K2'), created_at: '2026-10-22T11:00:00Z' }),
        inv({ id: 'old', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
      ],
      { new: [{ file_id: 'F', encrypted_file_key: 'wrap:K1' }] },
    )
    const r = await findExistingFolderKey(new Uint8Array(32), 'F', ports)
    expect(dec(r!.folderKey)).toBe('K1')
    expect(r!.encryptedOwnerFolderKeyB64).toBe(blob('K1'))
  })

  test('newest-first: both verify, the newest wins; a newest blob that does not open falls back', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const both = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('K1x'), created_at: '2026-10-22T09:00:00Z' }),
    ])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', both.ports))!.folderKey)).toBe('K1')
    const fallback = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('bad'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
    ])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', fallback.ports))!.folderKey)).toBe('K1')
  })

  test('no stored wraps at all: the newest openable key is accepted', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([inv({ id: 'a', encrypted_owner_folder_key: blob('K7') })])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', ports))!.folderKey)).toBe('K7')
  })

  test('abort: active rows exist but no candidate verifies -> throws a short message, never null', async () => {
    const { findExistingFolderKey, FOLDER_KEY_UNVERIFIED } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts(
      [inv({ id: 'a', encrypted_owner_folder_key: blob('K2') })],
      { a: [{ file_id: 'F', encrypted_file_key: 'wrap:K1' }] },
    )
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', ports)).rejects.toThrow(FOLDER_KEY_UNVERIFIED)
    expect(FOLDER_KEY_UNVERIFIED.length).toBeLessThanOrEqual(80)
    const none = makePorts([inv({ id: 'a', encrypted_owner_folder_key: blob('bad1') })])
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', none.ports)).rejects.toThrow(FOLDER_KEY_UNVERIFIED)
  })

  test('the wrapping key is derived once and zeroized on success, failed opens and abort', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const ok = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('bad1'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('bad2'), created_at: '2026-10-22T10:00:00Z' }),
      inv({ id: 'c', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
    ])
    await findExistingFolderKey(new Uint8Array(32), 'F', ok.ports)
    expect(ok.derives.length).toBe(1)
    expect(ok.zeroized.filter((z) => dec(z) === 'wrapping').length).toBe(1)

    const bad = makePorts([inv({ id: 'a', encrypted_owner_folder_key: blob('bad1') })])
    await findExistingFolderKey(new Uint8Array(32), 'F', bad.ports).catch(() => {})
    expect(bad.derives.length).toBe(1)
    expect(bad.zeroized.filter((z) => dec(z) === 'wrapping').length).toBe(1)
  })

  test('a newer invited/claimed row never gets its wraps fetched (server 400s); the newest APPROVED one verifies, once', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const m = makePorts(
      [
        inv({ id: 'pend', status: 'invited', encrypted_owner_folder_key: blob('K2'), created_at: '2026-10-22T11:00:00Z' }),
        inv({ id: 'claim', status: 'claimed', encrypted_owner_folder_key: blob('K2'), created_at: '2026-10-22T10:30:00Z' }),
        inv({ id: 'appr', status: 'approved', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
      ],
      { appr: [{ file_id: 'C', encrypted_file_key: 'wrap:K1' }] },
    )
    const r = await findExistingFolderKey(new Uint8Array(32), 'F', m.ports)
    expect(dec(r!.folderKey)).toBe('K1')
    expect(m.calls).toEqual(['appr'])
  })

  test('only pending rows (no approved invite): nothing to verify against, newest openable key accepted, no wrap fetch', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const m = makePorts([inv({ id: 'pend', status: 'invited', encrypted_owner_folder_key: blob('K3') })])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', m.ports))!.folderKey)).toBe('K3')
    expect(m.calls).toEqual([])
  })
})
