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
// named new:* is a purpose-bound copy that opens on its own; any other name is
// a LEGACY copy that core opens with proof, except bad*, which core refuses.
// Task 2255 moved the legacy open and its proof into core (one call over the
// folder's rows), so web derives no wrapping key and holds no candidate.
const blob = (k: string) => '0'.repeat(12) + k
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const AUTH_FAILURE = 'decryption failed: ciphertext is invalid or key is wrong'

function makePorts(invites: unknown[], rows: unknown[] = [{ file_id: 'C', encrypted_file_key: 'proof' }]) {
  const calls = { rowFetches: [] as string[], legacyOpens: [] as { key: string; rows: number }[] }
  const ports = {
    getSentInvites: async () => invites as never,
    getFolderKeys: async (inviteId: string) => {
      calls.rowFetches.push(inviteId)
      return rows as never
    },
    unwrapInviteOwnerCopy: async (_m: Uint8Array, _f: string, b: Uint8Array) => {
      const k = dec(b).slice(12)
      if (k.startsWith('new:')) return enc(k.slice(4))
      throw new Error(AUTH_FAILURE)
    },
    openLegacyInviteOwnerCopy: async (_m: Uint8Array, _f: string, b: Uint8Array, r: unknown[]) => {
      const k = dec(b).slice(12)
      calls.legacyOpens.push({ key: k, rows: r.length })
      return k.startsWith('bad') ? null : enc(k)
    },
    fromBase64: (s: string) => enc(s),
  }
  return { ports, calls }
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

  test('abort: active blobs exist but none opens with proof -> throws a short message, never null (2255: never a split key)', async () => {
    const { findExistingFolderKey, FOLDER_KEY_UNVERIFIED } = await import('../src/lib/folder-share-crypto')
    expect(FOLDER_KEY_UNVERIFIED.length).toBeLessThanOrEqual(80)
    const none = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('bad1') }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('bad2'), status: 'claimed' }),
    ])
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', none.ports)).rejects.toThrow(FOLDER_KEY_UNVERIFIED)
    expect(none.calls.legacyOpens.map((o) => o.key)).toEqual(['bad1', 'bad2'])
  })

  test('P3-1: active invites exist but NONE has an owner blob -> abort, never mint', async () => {
    const { findExistingFolderKey, FOLDER_KEY_UNVERIFIED } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makePorts([inv({ id: 'a' }), inv({ id: 'b', status: 'claimed', encrypted_owner_folder_key: '' })])
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', ports)).rejects.toThrow(FOLDER_KEY_UNVERIFIED)
    // nothing to open: no rows fetched, no core call
    expect(calls.rowFetches.length).toBe(0)
    expect(calls.legacyOpens.length).toBe(0)
  })

  test('P3-2: only an authentication failure skips a blob; any other error aborts', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports } = makePorts([
      inv({ id: 'a', encrypted_owner_folder_key: blob('K2'), created_at: '2026-10-22T11:00:00Z' }),
      inv({ id: 'b', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
    ])
    const crashing = {
      ...ports,
      unwrapInviteOwnerCopy: async () => {
        throw new Error('worker crashed')
      },
    }
    // The older blob K1 would open, but a crash on the newest must not fall back to it.
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', crashing)).rejects.toThrow('worker crashed')
  })

  test('a crash in the legacy open aborts too', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const m = makePorts([inv({ id: 'a', encrypted_owner_folder_key: blob('K1') })])
    const crashing = { ...m.ports, openLegacyInviteOwnerCopy: async () => { throw new Error('worker crashed') } }
    await expect(findExistingFolderKey(new Uint8Array(32), 'F', crashing)).rejects.toThrow('worker crashed')
  })

  test('P3-4: the abort message tells the owner what to do, within 80 characters', async () => {
    const { FOLDER_KEY_UNVERIFIED } = await import('../src/lib/folder-share-crypto')
    expect(FOLDER_KEY_UNVERIFIED.length).toBeLessThanOrEqual(80)
    expect(FOLDER_KEY_UNVERIFIED).toMatch(/Remove its pending invites/)
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

  test('a purpose-bound copy opens without fetching rows or a legacy open', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makePorts([inv({ id: 'a', encrypted_owner_folder_key: blob('new:K3') })])
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', ports))!.folderKey)).toBe('K3')
    expect(calls.rowFetches.length).toBe(0)
    expect(calls.legacyOpens.length).toBe(0)
  })

  test('2255: rows are fetched once, from the newest active invite, and every legacy blob gets ALL of them', async () => {
    const { findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    const rows = [
      { file_id: 'C1', encrypted_file_key: 'w1' },
      { file_id: 'C2', encrypted_file_key: 'w2' },
      { file_id: 'C3', encrypted_file_key: 'w3' },
    ]
    const { ports, calls } = makePorts(
      [
        inv({ id: 'a', encrypted_owner_folder_key: blob('bad1'), created_at: '2026-10-22T11:00:00Z' }),
        inv({ id: 'b', encrypted_owner_folder_key: blob('bad2'), created_at: '2026-10-22T10:00:00Z' }),
        inv({ id: 'c', encrypted_owner_folder_key: blob('K1'), created_at: '2026-10-22T09:00:00Z' }),
      ],
      rows,
    )
    expect(dec((await findExistingFolderKey(new Uint8Array(32), 'F', ports))!.folderKey)).toBe('K1')
    expect(calls.rowFetches).toEqual(['a'])
    expect(calls.legacyOpens).toEqual([
      { key: 'bad1', rows: 3 },
      { key: 'bad2', rows: 3 },
      { key: 'K1', rows: 3 },
    ])
  })
})
