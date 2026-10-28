import { describe, expect, test } from 'bun:test'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'

// Task 2133 part 2a (design K, web side): every request that carries folder
// key material also carries `folder_key_id` = base64(core folder_key_id(key)),
// for the key actually used. The WASM worker is not loadable under bun test,
// so the id derivation is injected (a recognisable fake) here; the real WASM
// export is pinned by the vector test in core-vectors-kat.test.ts.
await installMocks()

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
// Fake id: "id:" + the key text, base64. Differs for every key.
const fakeId = async (k: Uint8Array) => enc('id:' + dec(k))
const idB64 = (name: string) => btoa('id:' + name)

function makeInvitePorts(opts: { existing: { key: string; blob: string } | null; minted?: string }) {
  const calls = { minted: 0, sealed: [] as string[] }
  return {
    calls,
    ports: {
      findExistingFolderKey: async () =>
        opts.existing ? { folderKey: enc(opts.existing.key), encryptedOwnerFolderKeyB64: opts.existing.blob } : null,
      generateFolderKey: async () => {
        calls.minted++
        return enc(opts.minted ?? 'MINTED')
      },
      encryptAllChildrenKeys: async (_m: Uint8Array, key: Uint8Array, _f: string, format: string) => [
        { file_id: 'c1', encrypted_file_key: `${format}-wrapped-under-` + dec(key) },
      ],
      legacyInviteOwnerWrap: async (_m: Uint8Array, _f: string, key: Uint8Array) => {
        calls.sealed.push(dec(key))
        return enc('sealed-' + dec(key))
      },
      deriveFileKey: async () => enc('root-name-key'),
      sealChildKey: async (key: Uint8Array, ref: { rootId: string; itemId: string; isFolder: boolean }, child: Uint8Array) =>
        `l7-root-${ref.rootId}-${ref.itemId}-${ref.isFolder}-${dec(child)}-under-${dec(key)}`,
      folderKeyId: async (k: Uint8Array) => btoa(dec(await fakeId(k))),
    },
  }
}

describe('buildFolderInvite carries the id of the key it used', () => {
  test('first invite: the minted key, and its id', async () => {
    const { buildFolderInvite } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makeInvitePorts({ existing: null, minted: 'K-first' })
    const { folderKey, payload } = await buildFolderInvite(new Uint8Array(32), 'F', undefined, ports)
    expect(calls.minted).toBe(1)
    expect(dec(folderKey)).toBe('K-first')
    expect(payload.folder_key_id).toBe(idB64('K-first'))
    // No custody record: the legacy invite format (L7b), no root entry.
    expect(payload.folder_keys).toEqual([{ file_id: 'c1', encrypted_file_key: 'legacy_invite-wrapped-under-K-first' }])
    expect(calls.sealed).toEqual(['K-first'])
  })

  test('later invite: the REUSED key and its id, nothing minted, owner blob re-sent verbatim', async () => {
    const { buildFolderInvite } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makeInvitePorts({ existing: { key: 'K-reused', blob: 'blob-1' }, minted: 'K-other' })
    const { payload } = await buildFolderInvite(new Uint8Array(32), 'F', undefined, ports)
    expect(calls.minted).toBe(0)
    expect(payload.folder_key_id).toBe(idB64('K-reused'))
    expect(payload.folder_key_id).not.toBe(idB64('K-other'))
    expect(payload.encrypted_owner_folder_key).toBe('blob-1')
    expect(payload.is_folder_share).toBe(true)
  })

  test('a failure while wrapping zeroizes the key made here and rethrows', async () => {
    const { buildFolderInvite } = await import('../src/lib/folder-share-crypto')
    const { ports } = makeInvitePorts({ existing: null, minted: 'K-x' })
    let minted!: Uint8Array
    const failing = {
      ...ports,
      generateFolderKey: async () => (minted = enc('K-x')),
      encryptAllChildrenKeys: async () => {
        throw new Error('listing failed')
      },
    }
    await expect(buildFolderInvite(new Uint8Array(32), 'F', undefined, failing)).rejects.toThrow('listing failed')
    expect(Array.from(minted).every((b) => b === 0)).toBe(true)
  })
})

describe('folderKeyId: base64 of the 32 bytes from core', () => {
  test('standard base64 with padding of what the core port returns', async () => {
    const { folderKeyId } = await import('../src/lib/folder-share-crypto')
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => 0xe0 + (i % 16))
    let seen: Uint8Array | undefined
    const out = await folderKeyId(enc('the-key'), async (k) => {
      seen = k
      return bytes
    })
    expect(dec(seen!)).toBe('the-key')
    expect(out).toBe(btoa(String.fromCharCode(...bytes)))
    expect(out.endsWith('=')).toBe(true) // 32 bytes -> 44 chars, one pad
    expect(out.length).toBe(44)
  })
})

describe('the shared-folder upload registers its child key with the id of ITS folder key', () => {
  test('encryptedUpload -> addFolderKeys(inviteId, keys, id of sharedFolderContext.folderKey)', async () => {
    resetCaptures()
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'in-shared.txt', { type: 'text/plain' })
    await encryptedUpload(
      file, 'client-id', new Uint8Array([1]), new Uint8Array([9]), undefined, undefined, undefined,
      { folderKey: enc('K-ctx'), sharedFolderId: 'F', inviteId: 'inv-7' },
      undefined,
      async () => new Uint8Array([9]),
    )
    expect(cap.addFolderKeysCalls).toHaveLength(1)
    expect(cap.addFolderKeysCalls[0].inviteId).toBe('inv-7')
    // The mocked ./crypto folderKeyId returns the key bytes, so the id sent is
    // base64 of the context's key (the real derivation is core's, pinned by the KAT).
    expect(cap.addFolderKeysCalls[0].folderKeyId).toBe(btoa('K-ctx'))
  })
})

describe('L1: an invite after a link uses the custody record, the key\'s one source', () => {
  test('the custody key wins over an invite key and nothing is minted', async () => {
    const { buildFolderInvite } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makeInvitePorts({ existing: { key: 'K-invite', blob: 'blob-invite' }, minted: 'K-new' })
    let invitesAsked = 0
    const { payload } = await buildFolderInvite(new Uint8Array(32), 'F', undefined, {
      ...ports,
      custodyFolderKey: async () => ({ folderKey: enc('K-custody'), encryptedOwnerFolderKeyB64: 'blob-custody' }),
      findExistingFolderKey: async () => {
        invitesAsked++
        return { folderKey: enc('K-invite'), encryptedOwnerFolderKeyB64: 'blob-invite' }
      },
    })
    expect(calls.minted).toBe(0)
    expect(invitesAsked).toBe(0)
    expect(payload.folder_key_id).toBe(idB64('K-custody'))
    // A custody folder is L7 (L7b): the root's own name-key wrap first, then the children.
    expect(payload.folder_keys).toEqual([
      { file_id: 'F', encrypted_file_key: 'l7-root-F-F-true-root-name-key-under-K-custody' },
      { file_id: 'c1', encrypted_file_key: 'l7-wrapped-under-K-custody' },
    ])
    expect(payload.encrypted_owner_folder_key).toBe('blob-custody')
    expect(calls.sealed).toEqual([])
  })

  test('no custody record: the invite key is reused, as before', async () => {
    const { buildFolderInvite } = await import('../src/lib/folder-share-crypto')
    const { ports, calls } = makeInvitePorts({ existing: { key: 'K-invite', blob: 'blob-invite' } })
    const { payload } = await buildFolderInvite(new Uint8Array(32), 'F', undefined, {
      ...ports,
      custodyFolderKey: async () => null,
    })
    expect(calls.minted).toBe(0)
    expect(payload.folder_key_id).toBe(idB64('K-invite'))
  })
})
