import { describe, expect, test } from 'bun:test'
import { installMocks } from './helpers/upload-share-mocks'

// Task 2133: a later folder invite reuses the folder's existing key. The
// browser proof is e2e/2133-folder-second-invite.spec.ts; these pin the
// selection rules with injected ports (the WASM crypto worker is not loadable
// under bun test).
await installMocks()

const inv = (o: Record<string, unknown>) =>
  ({ id: 'i', file_id: 'F', status: 'approved', created_at: '2026-10-22T10:00:00Z', is_folder_share: true, ...o }) as never

// Fake blob: 12 filler chars + the key name, e.g. "000000000000K1". A key
// named bad* "does not open".
const blob = (k: string) => '0'.repeat(12) + k
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

function makePorts(invites: unknown[]) {
  const zeroized: Uint8Array[] = []
  const derives: number[] = []
  const ports = {
    getSentInvites: async () => invites as never,
    deriveFileKey: async () => {
      derives.push(1)
      return enc('wrapping')
    },
    decryptChunk: async (_k: Uint8Array, _n: Uint8Array, ct: Uint8Array) => {
      if (dec(ct).startsWith('bad')) throw new Error('auth')
      return enc(dec(ct))
    },
    fromBase64: (s: string) => enc(s),
    zeroize: (b: Uint8Array) => {
      zeroized.push(b)
    },
  }
  return { ports, zeroized, derives }
}

describe('ownerFolderKeyBlobs: active by status only', () => {
  test('keeps invited/claimed/approved rows of this folder newest first; the expiry date does not matter', async () => {
    const { ownerFolderKeyBlobs } = await import('../src/lib/folder-share-crypto')
    const blobs = ownerFolderKeyBlobs(
      [
        inv({ encrypted_owner_folder_key: 'old', created_at: '2026-10-22T09:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'new', created_at: '2026-10-22T11:00:00Z', status: 'claimed' }),
        inv({ encrypted_owner_folder_key: 'pending', created_at: '2026-10-22T08:00:00Z', status: 'invited' }),
        inv({ encrypted_owner_folder_key: 'denied', status: 'denied' }),
        inv({ encrypted_owner_folder_key: 'past-expiry', expires_at: '2026-10-22T11:59:00Z', created_at: '2026-10-22T07:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'other-folder', file_id: 'G' }),
        inv({ encrypted_owner_folder_key: 'file-share', is_folder_share: false }),
        inv({ encrypted_owner_folder_key: '' }),
        inv({}),
      ],
      'F',
    )
    expect(blobs).toEqual(['new', 'old', 'pending', 'past-expiry'])
  })
})

describe('findExistingFolderKey', () => {
  test('no invite at all: null (the caller mints)', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([inv({ file_id: 'G', encrypted_owner_folder_key: blob('K1') })])
    expect(await findExistingFolderKey(new Uint8Array(32), 'F', ports)).toBeNull()
  })

  test('denied-only: no active member, null, a fresh key is minted', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ encrypted_owner_folder_key: blob('K1'), status: 'denied' }),
      inv({ encrypted_owner_folder_key: blob('K2'), status: 'denied' }),
    ])
    expect(await findExistingFolderKey(new Uint8Array(32), 'F', ports)).toBeNull()
  })

  test('newest active blob wins over an older one (leftover wrap rows play no part)', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ id: 'new', encrypted_owner_folder_key: blob('K2'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'old', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
    ])
    const r = await findExistingFolderKey(new Uint8Array(32), 'F', ports)
    expect(dec(r!.folderKey)).toBe('K2')
    expect(r!.encryptedOwnerFolderKeyB64).toBe(blob('K2'))
  })

  test('an approved invite past its expires_at is still a reuse candidate (client clock never decides)', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('K5'), expires_at: '2026-10-01T00:00:00Z' }),
    ])
    const r = await findExistingFolderKey(new Uint8Array(32), 'F', ports)
    expect(dec(r!.folderKey)).toBe('K5')
  })

  test('abort: active blobs exist but none opens -> throws a short message, never null', async () => {
    const { findExistingFolderKey, FOLDER_KEY_UNVERIFIED } = await import('../src/lib/folder-share-crypto')
    expect(FOLDER_KEY_UNVERIFIED.length).toBeLessThanOrEqual(80)
    const none = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('bad1') }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('bad2'), status: 'claimed' }),
    ])
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', none.ports)).rejects.toThrow(FOLDER_KEY_UNVERIFIED)
  })

  test('newest-first fallback: the newest blob does not open, the next one does', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('bad'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
      inv({ id: 'c', encrypted_owner_folder_key: blob('K0'), created_at: '2026-10-22T08:00:00Z' }),
    ])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', ports))!.folderKey)).toBe('K1')
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
})
