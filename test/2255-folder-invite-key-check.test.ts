import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'

// Real vendored local-core WASM; only transport and the worker hop are injected.
const wasm = loadWasm()
const enc = new TextEncoder()
const master = new Uint8Array(32).fill(7)
const trueKey = new Uint8Array(32).fill(8)
const fresh = new Uint8Array(32).fill(9)
const folder = 'folder-2255'
const child = 'owner-child-2255'
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
const derive = async (m: Uint8Array, id: string) => wasm.derive_file_key(m, enc.encode(id))
const seal = (key: Uint8Array, plaintext: Uint8Array) => {
  const r = wasm.encrypt_chunk(key, plaintext)
  return new Uint8Array([...r.nonce, ...r.ciphertext])
}
const legacyCopy = (key: Uint8Array) => seal(wasm.derive_file_key(master, enc.encode(folder)), key)
const childWrap = (key: Uint8Array, content = wasm.derive_file_key(master, enc.encode(child))) => seal(key, content)
const name = enc.encode('{"name":"Docs","mime_type":null}')

function fixture(copy: Uint8Array, wraps = [{ file_id: child, encrypted_file_key: b64(childWrap(trueKey)) }]) {
  const calls = { proofs: 0, minted: 0, sealed: 0, rows: 0 }
  const children = [{ id: child, is_folder: false, is_trashed: false, parent_id: folder }] as any[]
  const ports = {
    getSentInvites: async () => [{ id: 'invite-2255', file_id: folder, is_folder_share: true, status: 'approved', created_at: '2026-10-28', encrypted_owner_folder_key: b64(copy) }] as any,
    getFolderKeys: async () => { calls.rows++; return wraps },
    listFilesPage: async () => ({ files: children, next_cursor: null }),
    deriveFileKey: derive,
    decryptChunk: async (k: Uint8Array, n: Uint8Array, c: Uint8Array) => wasm.decrypt_chunk(k, n, c),
    unwrapInviteOwnerCopy: async (m: Uint8Array, f: string, b: Uint8Array) => wasm.unwrapInviteOwnerCopy(m, f, b),
    verifyLegacyFolderKey: async (m: Uint8Array, f: string, k: Uint8Array, c: string, w: Uint8Array) => {
      calls.proofs++
      return wasm.verifyLegacyFolderKey(m, f, k, c, w)
    },
    fromBase64: unb64,
    zeroize: (b: Uint8Array) => { b.fill(0) },
  }
  return { ports, calls, children }
}

async function build(f: ReturnType<typeof fixture>) {
  const { buildFolderInvite, findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
  return buildFolderInvite(master, folder, undefined, {
    findExistingFolderKey: (m, id) => findExistingFolderKey(m, id, f.ports),
    generateFolderKey: async () => { f.calls.minted++; return fresh.slice() },
    encryptAllChildrenKeys: async (_m, k) => [{ file_id: child, encrypted_file_key: b64(childWrap(k)) }],
    encryptOwnerFolderKey: async (m, id, k) => { f.calls.sealed++; return wasm.wrapInviteOwnerCopy(m, id, k) },
    folderKeyId: async k => b64(wasm.folder_key_id(k)),
  })
}

describe('2255: owner proof before legacy folder key reuse', () => {
  test('the folder name blob is not reused; the invite mints a fresh key', async () => {
    expect(name.length).toBe(32)
    const f = fixture(legacyCopy(name))
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(fresh))
    expect(f.calls.minted).toBe(1)
    expect(f.calls.proofs).toBe(1)
  })

  test('an authentic wrap of a server-chosen child key still cannot prove possession', async () => {
    const f = fixture(legacyCopy(name), [{ file_id: child, encrypted_file_key: b64(childWrap(name, fresh)) }])
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(fresh))
    expect(f.calls.minted).toBe(1)
  })

  test('a legitimate legacy folder with an owner file reuses its real key', async () => {
    const f = fixture(legacyCopy(trueKey))
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.minted).toBe(0)
    expect(f.calls.proofs).toBe(1)
  })

  test('no owner-derived child means no legacy reuse', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.children.length = 0
    const r = await build(f)
    expect(f.calls.minted).toBe(1)
    expect(Array.from(r.folderKey)).toEqual(Array.from(fresh))
    expect(f.calls.proofs).toBe(0)
  })

  test('request uploads are not owner-derived proof children', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.children[0].file_request_id = 'request-2255'
    const r = await build(f)
    expect(f.calls.minted).toBe(1)
    expect(f.calls.proofs).toBe(0)
  })

  test('a stale wrap for a moved child is not proof', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.children[0].id = 'other-child'
    const r = await build(f)
    expect(f.calls.minted).toBe(1)
  })

  test('a new purpose-bound copy opens even for an empty folder', async () => {
    const f = fixture(wasm.wrapInviteOwnerCopy(master, folder, trueKey))
    f.children.length = 0
    const r = await build(f)
    expect(Array.from(r.folderKey)).toEqual(Array.from(trueKey))
    expect(f.calls.minted).toBe(0)
    expect(f.calls.rows).toBe(0)
    expect(f.calls.proofs).toBe(0)
  })

  test('a reused legacy key is written back with the new purpose-bound format', async () => {
    const f = fixture(legacyCopy(trueKey))
    const r = await build(f)
    expect(f.calls.sealed).toBe(1)
    expect(Array.from(wasm.unwrapInviteOwnerCopy(master, folder, unb64(r.payload.encrypted_owner_folder_key)))).toEqual(Array.from(trueKey))
  })

  test('non-key legacy plaintext is rejected and wiped', async () => {
    const f = fixture(legacyCopy(new Uint8Array(31)))
    const r = await build(f)
    expect(f.calls.minted).toBe(1)
    expect(r.folderKey.length).toBe(32)
  })

  test('proof transport failure aborts instead of minting', async () => {
    const f = fixture(legacyCopy(trueKey))
    f.ports.getFolderKeys = async () => { throw new Error('proof transport failed') }
    await expect(build(f)).rejects.toThrow('proof transport failed')
    expect(f.calls.minted).toBe(0)
  })
})
