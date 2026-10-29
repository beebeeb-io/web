import { describe, test, expect, mock } from 'bun:test'
import {
  resolveRecipientFolderKey,
  type RecipientFolderKeyPorts,
  type RecipientFolderKeyInvite,
} from '../src/lib/recipient-folder-key'

/**
 * P0 (flow web-core, 2026-09-25) — folder-invite recipient cannot decrypt
 * anything. Auto-approved folder invites were stored with an EMPTY
 * `encrypted_folder_key` and the recipient-sealed folder key in
 * `encrypted_file_key`. resolveRecipientFolderKey must open both the fixed
 * shape and the legacy shape, and must refuse a blob that decrypts to the
 * wrong key (pre-1545 manual approvals) instead of using it.
 *
 * Fake crypto: a "sealed" blob is the byte 0xAA followed by the key bytes; a
 * child wrapping "opens" only under the key whose first byte it names.
 */
const masterKey = new Uint8Array(32).fill(7)
const senderPubB64 = 'c2VuZGVyLXB1Yg=='
const folderId = 'folder-1'
const REAL = 42
const WRONG = 13

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')
const sealed = (keyByte: number) => b64([0xaa, ...new Array(32).fill(keyByte)])

type Opened = { format: string; rootId: string; itemId: string; isFolder: boolean }

function ports(): RecipientFolderKeyPorts & { zeroized: Uint8Array[]; opened: Opened[] } {
  const zeroized: Uint8Array[] = []
  const opened: Opened[] = []
  return {
    zeroized,
    opened,
    fromBase64: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
    zeroize: (b: Uint8Array) => {
      zeroized.push(b)
      b.fill(0)
    },
    decryptFolderKey: mock(async (_mk, _pub, fid: string, blob: Uint8Array) => {
      expect(fid).toBe(folderId)
      if (blob[0] !== 0xaa) throw new Error('aead: authentication failed')
      return blob.slice(1)
    }) as RecipientFolderKeyPorts['decryptFolderKey'],
    // A wrap "opens" only under the key whose first byte it names; an
    // `l7:<byte>:<kind>` wrap also only as that kind (folder or file).
    openFolderChild: mock(async (format: string, fk: Uint8Array, ref: { rootId: string; itemId: string; isFolder: boolean }, wrapped: string) => {
      opened.push({ format, ...ref })
      const [shape, byte, kind] = wrapped.split(':')
      if (fk[0] !== Number(byte)) throw new Error('aead: authentication failed')
      if (shape === 'l7' && (format !== 'l7' || (kind === 'folder') !== ref.isFolder)) throw new Error('decryption failed')
      if (shape !== 'l7' && format === 'l7') throw new Error('decryption failed')
      return new Uint8Array(32).fill(1)
    }) as RecipientFolderKeyPorts['openFolderChild'],
  }
}

const childKeys = [
  { file_id: 'child-a', encrypted_file_key: `wrap:${REAL}` },
  { file_id: folderId, encrypted_file_key: `wrap:${REAL}` },
]

const invite = (over: Partial<RecipientFolderKeyInvite>): RecipientFolderKeyInvite => ({
  file_id: folderId,
  is_folder_share: true,
  sender_public_key: senderPubB64,
  ...over,
})

describe('resolveRecipientFolderKey', () => {
  test('fixed server shape: encrypted_folder_key holds the sealed folder key', async () => {
    const r = await resolveRecipientFolderKey(
      invite({ encrypted_folder_key: sealed(REAL), encrypted_file_key: undefined }),
      masterKey,
      childKeys,
      'legacy_invite',
      ports(),
    )
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.source).toBe('encrypted_folder_key')
    expect(r.folderKey[0]).toBe(REAL)
  })

  test('legacy auto-approved shape: EMPTY encrypted_folder_key, sealed key in encrypted_file_key', async () => {
    const r = await resolveRecipientFolderKey(
      invite({ encrypted_folder_key: '', encrypted_file_key: sealed(REAL) }),
      masterKey,
      childKeys,
      'legacy_invite',
      ports(),
    )
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.source).toBe('encrypted_file_key')
    expect(r.folderKey[0]).toBe(REAL)
  })

  test('legacy manual approval (wrong key in encrypted_file_key) is rejected by the child-key check and zeroized', async () => {
    const p = ports()
    const r = await resolveRecipientFolderKey(
      invite({ encrypted_folder_key: '', encrypted_file_key: sealed(WRONG) }),
      masterKey,
      childKeys,
      'legacy_invite',
      p,
    )
    expect(r.status).toBe('missing')
    expect(p.zeroized.some(z => z.length === 32 && z.every(x => x === 0))).toBe(true)
  })

  test('a file (non-folder) invite never treats encrypted_file_key as a folder key', async () => {
    const r = await resolveRecipientFolderKey(
      invite({ is_folder_share: false, encrypted_folder_key: undefined, encrypted_file_key: sealed(REAL) }),
      masterKey,
      childKeys,
      'legacy_invite',
      ports(),
    )
    expect(r.status).toBe('missing')
  })

  test('falls through a bad encrypted_folder_key to a good encrypted_file_key', async () => {
    const r = await resolveRecipientFolderKey(
      invite({ encrypted_folder_key: sealed(WRONG), encrypted_file_key: sealed(REAL) }),
      masterKey,
      childKeys,
      'legacy_invite',
      ports(),
    )
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.source).toBe('encrypted_file_key')
  })

  test('no sender public key, or no blobs at all → missing', async () => {
    expect(
      (await resolveRecipientFolderKey(invite({ sender_public_key: undefined, encrypted_folder_key: sealed(REAL) }), masterKey, childKeys, 'legacy_invite', ports())).status,
    ).toBe('missing')
    expect(
      (await resolveRecipientFolderKey(invite({ encrypted_folder_key: '', encrypted_file_key: '' }), masterKey, childKeys, 'legacy_invite', ports())).status,
    ).toBe('missing')
  })

  test('empty folder (no child keys): first blob that decrypts is accepted', async () => {
    const r = await resolveRecipientFolderKey(
      invite({ encrypted_folder_key: '', encrypted_file_key: sealed(REAL) }),
      masterKey,
      [],
      'legacy_invite',
      ports(),
    )
    expect(r.status).toBe('ok')
  })
})

describe('resolveRecipientFolderKey — L7b, a folder with a custody record', () => {
  const l7Keys = [
    { file_id: 'child-a', encrypted_file_key: `l7:${REAL}:file` },
    { file_id: folderId, encrypted_file_key: `l7:${REAL}:folder` },
  ]

  test('the root entry verifies as a folder wrap bound to (root, root)', async () => {
    const p = ports()
    const r = await resolveRecipientFolderKey(invite({ encrypted_folder_key: sealed(REAL) }), masterKey, l7Keys, 'l7', p)
    expect(r.status).toBe('ok')
    expect(p.opened).toEqual([{ format: 'l7', rootId: folderId, itemId: folderId, isFolder: true }])
  })

  test('without a root entry, a child is tried as both kinds, each bound to its own row', async () => {
    const p = ports()
    const r = await resolveRecipientFolderKey(invite({ encrypted_folder_key: sealed(REAL) }), masterKey, [l7Keys[0]], 'l7', p)
    expect(r.status).toBe('ok')
    expect(p.opened.map((o) => [o.itemId, o.isFolder])).toEqual([['child-a', false]])
  })

  test('a legacy wrap on a custody folder never verifies a key (no fallback)', async () => {
    const p = ports()
    const r = await resolveRecipientFolderKey(invite({ encrypted_folder_key: sealed(REAL) }), masterKey, childKeys, 'l7', p)
    expect(r.status).toBe('missing')
    expect(p.opened.every((o) => o.format === 'l7')).toBe(true)
  })
})
