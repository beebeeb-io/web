import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { ApiError } from '../src/lib/api'

// Task 2255, decision L9 as corrected on 2026-10-28 (task file "L9 correction").
// Real vendored core WASM; only the network and the worker hop are injected.
// A legacy owner copy is reused ONLY when core proves it in one bounded call
// over the folder's rows; when it can't, the invite is refused with
// FOLDER_KEY_UNVERIFIED and NO second key is minted (that would split the
// folder between old and new members, review finding P2-1).
const wasm = loadWasm() as any
const enc = new TextEncoder()
const master = new Uint8Array(32).fill(7)
// A random-looking key: 0x80 cannot start a UTF-8 sequence.
const trueKey = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i)
const fresh = new Uint8Array(32).fill(0xf9)
const folder = '11111111-1111-4111-8111-111111111111'
const child = '22222222-2222-4222-8222-222222222222'
// {"name":"Docs","mime_type":null} is exactly 32 bytes: the folder's own name blob.
const name = enc.encode('{"name":"Docs","mime_type":null}')
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
const derive = (id: string): Uint8Array => wasm.derive_file_key(master, enc.encode(id))
const seal = (key: Uint8Array, plaintext: Uint8Array) => {
  const r = wasm.encrypt_chunk(key, plaintext)
  return new Uint8Array([...r.nonce, ...r.ciphertext])
}
/** The legacy owner copy flag-off invites wrote: sealed under the folder's name key, no AAD. */
const legacyCopy = (key: Uint8Array) => seal(derive(folder), key)
/** A row the owner wrote: `id`'s owner-derived key under `under`. */
const ownerRow = (id: string, under = trueKey, inner = derive(id)) => ({ file_id: id, encrypted_file_key: b64(seal(under, inner)) })
/** A row the owner's derived key does not open to: a member or request upload. */
const foreignRow = (id: string) => ({ file_id: id, encrypted_file_key: b64(seal(trueKey, new Uint8Array(32).fill(0x5a))) })

type Row = { file_id: string; encrypted_file_key: string }

function fixture(copy: Uint8Array, rows: Row[] = [ownerRow(child)]) {
  const calls = { minted: 0, sealed: 0, rowFetches: 0, coreProofs: 0, perRowProofs: 0, proofRows: [] as number[] }
  // Direct children as the owner lists them. The pre-correction code used this
  // listing to filter rows; the corrected rule takes ANY row, so it is unused.
  const children = [{ id: child, is_folder: false, is_trashed: false, parent_id: folder }] as any[]
  const invite = { id: 'invite-2255', file_id: folder, is_folder_share: true, status: 'approved', created_at: '2026-10-28T10:00:00Z' }
  const ports: any = {
    getSentInvites: async () => [{ ...invite, encrypted_owner_folder_key: b64(copy) }],
    getFolderKeys: async () => {
      calls.rowFetches++
      return rows
    },
    listFilesPage: async () => ({ files: children, next_cursor: null }),
    unwrapInviteOwnerCopy: async (m: Uint8Array, f: string, b: Uint8Array) => wasm.unwrapInviteOwnerCopy(m, f, b),
    openLegacyInviteOwnerCopy: async (m: Uint8Array, f: string, c: Uint8Array, r: Row[]) => {
      calls.coreProofs++
      calls.proofRows.push(r.length)
      return wasm.openLegacyInviteOwnerCopy(m, f, c, r) ?? null
    },
    // Pre-correction ports (a worker hop per row); the corrected code never calls them.
    verifyLegacyFolderKey: async (m: Uint8Array, f: string, k: Uint8Array, c: string, w: Uint8Array) => {
      calls.perRowProofs++
      return wasm.verifyLegacyFolderKey(m, f, k, c, w)
    },
    deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, enc.encode(id)),
    decryptChunk: async (k: Uint8Array, n: Uint8Array, c: Uint8Array) => wasm.decrypt_chunk(k, n, c),
    fromBase64: unb64,
    zeroize: (b: Uint8Array) => {
      b.fill(0)
    },
  }
  return { ports, calls, children, invite }
}

async function build(f: ReturnType<typeof fixture>) {
  const { buildFolderInvite, findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
  return buildFolderInvite(master, folder, undefined, {
    findExistingFolderKey: (m, id) => findExistingFolderKey(m, id, f.ports),
    generateFolderKey: async () => {
      f.calls.minted++
      return fresh.slice()
    },
    encryptAllChildrenKeys: async (_m, k) => [{ file_id: child, encrypted_file_key: b64(seal(k, derive(child))) }],
    encryptOwnerFolderKey: async (m, id, k) => {
      f.calls.sealed++
      return wasm.wrapInviteOwnerCopy(m, id, k)
    },
    folderKeyId: async (k) => b64(wasm.folder_key_id(k)),
  })
}

// One copy for both callers (web #198 / #199): read from the module, never hard-coded.
const { FOLDER_KEY_UNVERIFIED: UNVERIFIED } = await import('../src/lib/folder-share-crypto')

describe('2255: a legacy owner copy is reused only when core proves it', () => {
  test('the folder name blob is refused, and no second key is minted', async () => {
    expect(name.length).toBe(32)
    const f = fixture(legacyCopy(name))
    await expect(build(f)).rejects.toThrow(UNVERIFIED)
    expect(f.calls.minted).toBe(0)
  })

  test('attack A: a leaked owner file key plus the name blob is still refused', async () => {
    // The server knows ONE owner-derived child key (a file link, a share
    // recipient) and builds a row that opens under the name JSON to exactly it.
    const f = fixture(legacyCopy(name), [ownerRow(child, name)])
    await expect(build(f)).rejects.toThrow(UNVERIFIED)
    expect(f.calls.minted).toBe(0)
  })

  test('a legitimate legacy folder reuses its real key, proven by ANY row (a nested descendant)', async () => {
    // Member and request uploads first; the proof is a grandchild the owner's
    // direct-child listing does not show.
    const f = fixture(legacyCopy(trueKey), [foreignRow('member-upload'), foreignRow('request-upload'), ownerRow('nested-grandchild')])
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.minted).toBe(0)
    // The reused key is written back in the purpose-bound format.
    expect(Array.from(wasm.unwrapInviteOwnerCopy(master, folder, unb64(r.payload.encrypted_owner_folder_key)))).toEqual(Array.from(trueKey))
  })

  test('all rows go to core in ONE call, not a worker hop per row', async () => {
    const rows = [foreignRow('a'), foreignRow('b'), foreignRow('c'), foreignRow('d'), ownerRow(child)]
    const f = fixture(legacyCopy(trueKey), rows)
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.coreProofs).toBe(1)
    expect(f.calls.proofRows).toEqual([5])
    expect(f.calls.perRowProofs).toBe(0)
    expect(f.calls.rowFetches).toBe(1)
  })

  test('an empty legacy folder (no row can prove it) is refused, never split', async () => {
    const f = fixture(legacyCopy(trueKey), [])
    f.children.length = 0
    await expect(build(f)).rejects.toThrow(UNVERIFIED)
    expect(f.calls.minted).toBe(0)
  })

  test('a purpose-bound copy opens without rows or a proof', async () => {
    const f = fixture(wasm.wrapInviteOwnerCopy(master, folder, trueKey), [])
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.minted).toBe(0)
    expect(f.calls.rowFetches).toBe(0)
    expect(f.calls.coreProofs + f.calls.perRowProofs).toBe(0)
  })

  test('a failure to fetch the rows aborts; nothing is minted', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.ports.getFolderKeys = async () => {
      throw new Error('rows transport failed')
    }
    await expect(build(f)).rejects.toThrow('rows transport failed')
    expect(f.calls.minted).toBe(0)
  })

  test('with no active invite the first invite mints, as before', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.ports.getSentInvites = async () => []
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(fresh))
    expect(f.calls.minted).toBe(1)
  })
})

describe('2255: approval reads only a purpose-bound or proven legacy copy', () => {
  test('opens a purpose-bound copy without any lookup', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = wasm.wrapInviteOwnerCopy(master, folder, trueKey)
    const f = fixture(copy)
    f.ports.getSentInvites = async () => {
      throw new Error('lookup forbidden')
    }
    expect(Array.from(await decryptOwnerFolderKey(master, folder, copy, f.ports))).toEqual(Array.from(trueKey))
  })

  test('opens a proven legitimate legacy copy', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(trueKey)
    const f = fixture(copy)
    expect(Array.from(await decryptOwnerFolderKey(master, folder, copy, f.ports))).toEqual(Array.from(trueKey))
  })

  test('refuses the name blob, even with a leaked owner file key row (attack A)', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(name)
    const f = fixture(copy, [ownerRow(child, name)])
    await expect(decryptOwnerFolderKey(master, folder, copy, f.ports)).rejects.toThrow(UNVERIFIED)
  })

  test("cannot substitute another invite's key for the copy being approved", async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(name)
    const f = fixture(wasm.wrapInviteOwnerCopy(master, folder, trueKey))
    await expect(decryptOwnerFolderKey(master, folder, copy, f.ports)).rejects.toThrow(UNVERIFIED)
  })
})

// Review of 2255 (P1-1): the honest server serves a folder's rows only through
// an APPROVED invite and answers 400 "invite not approved" for any other
// (server invites.rs, get_folder_keys). Proof rows must come from the newest
// approved invite; with none, or on that 400, the answer is FOLDER_KEY_UNVERIFIED.
describe('2255 review: proof rows come only through an approved invite', () => {
  const at = (h: number) => `2026-10-28T${String(h).padStart(2, '0')}:00:00Z`
  function honest(f: ReturnType<typeof fixture>, invites: { id: string; status: string; created_at: string; copy: Uint8Array }[]) {
    const fetched: string[] = []
    f.ports.getSentInvites = async () =>
      invites.map((i) => ({ ...f.invite, id: i.id, status: i.status, created_at: i.created_at, encrypted_owner_folder_key: b64(i.copy) }))
    f.ports.getFolderKeys = async (id: string) => {
      fetched.push(id)
      if (invites.find((i) => i.id === id)?.status !== 'approved') throw new ApiError('invite not approved', 400, 'invite not approved')
      return [ownerRow(child)]
    }
    return fetched
  }

  test('approving a pending legacy invite proves it through the newest APPROVED invite', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(trueKey)
    const f = fixture(copy)
    const fetched = honest(f, [
      { id: 'pending', status: 'claimed', created_at: at(12), copy },
      { id: 'approved-new', status: 'approved', created_at: at(11), copy },
      { id: 'approved-old', status: 'approved', created_at: at(10), copy },
    ])
    expect(Array.from(await decryptOwnerFolderKey(master, folder, copy, f.ports))).toEqual(Array.from(trueKey))
    expect(fetched).toEqual(['approved-new'])
  })

  test('a new invite while the newest one is still pending reuses the key through the approved one', async () => {
    const copy = legacyCopy(trueKey)
    const f = fixture(copy)
    const fetched = honest(f, [
      { id: 'pending', status: 'invited', created_at: at(12), copy },
      { id: 'approved', status: 'approved', created_at: at(10), copy },
    ])
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.minted).toBe(0)
    expect(fetched).toEqual(['approved'])
  })

  test('no approved invite: FOLDER_KEY_UNVERIFIED, and no rows are asked for', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(trueKey)
    const f = fixture(copy)
    const fetched = honest(f, [
      { id: 'pending', status: 'claimed', created_at: at(12), copy },
      { id: 'invited', status: 'invited', created_at: at(11), copy },
    ])
    await expect(decryptOwnerFolderKey(master, folder, copy, f.ports)).rejects.toThrow(UNVERIFIED)
    await expect(build(f)).rejects.toThrow(UNVERIFIED)
    expect(f.calls.minted).toBe(0)
    expect(fetched).toEqual([])
  })

  test('a 400 "invite not approved" from the server maps to FOLDER_KEY_UNVERIFIED', async () => {
    const { decryptOwnerFolderKey } = await import('../src/lib/folder-share-crypto')
    const copy = legacyCopy(trueKey)
    const f = fixture(copy)
    f.ports.getFolderKeys = async () => {
      throw new ApiError('invite not approved', 400, 'invite not approved')
    }
    await expect(decryptOwnerFolderKey(master, folder, copy, f.ports)).rejects.toThrow(UNVERIFIED)
    await expect(build(f)).rejects.toThrow(UNVERIFIED)
    expect(f.calls.minted).toBe(0)
  })
})

// Review of 2255 (P3): approval must wipe the key it unwrapped even when
// sealing it for the recipient fails.
describe('2255 review: approval zeroizes on failure', () => {
  const failingPorts = (key: Uint8Array) => ({
    // A folder without custody (web #198 reads custody first).
    custodyFolderKey: async () => null,
    decryptOwnerFolderKey: async () => key,
    encryptFolderKeyForRecipient: async () => {
      throw new Error('bad recipient key')
    },
    encryptFileKeyForSharing: async () => {
      throw new Error('bad recipient key')
    },
    fromBase64: unb64,
    zeroize: (b: Uint8Array) => {
      b.fill(0)
    },
  })

  test('the folder key is zeroized when the recipient wrap throws', async () => {
    const { buildApprovalKeyBlob } = await import('../src/lib/approve-invite-crypto')
    const key = trueKey.slice()
    const invite = { file_id: folder, is_folder_share: true, encrypted_owner_folder_key: b64(legacyCopy(trueKey)) }
    await expect(
      buildApprovalKeyBlob(invite as any, master, new Uint8Array(32), async () => new Uint8Array(32), failingPorts(key) as any),
    ).rejects.toThrow('bad recipient key')
    expect(Array.from(key)).toEqual(new Array(32).fill(0))
  })

  test('a single file key is zeroized when the recipient wrap throws', async () => {
    const { buildApprovalKeyBlob } = await import('../src/lib/approve-invite-crypto')
    const key = trueKey.slice()
    const invite = { file_id: child, is_folder_share: false, encrypted_owner_folder_key: null }
    await expect(
      buildApprovalKeyBlob(invite as any, master, new Uint8Array(32), async () => key, failingPorts(new Uint8Array(32)) as any),
    ).rejects.toThrow('bad recipient key')
    expect(Array.from(key)).toEqual(new Array(32).fill(0))
  })
})
