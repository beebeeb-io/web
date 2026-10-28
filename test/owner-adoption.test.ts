/**
 * Task 2237b — owner adoption of guest-added files.
 *
 * Runs the real crypto (core WASM) behind a worker-free mirror: only the four
 * worker crossings are replaced, everything else (base64, folder-key unwrap,
 * child-key unwrap) is the shipped code.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { createContentOps } from '../src/lib/content-crypto'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const FOLDER_ID = '11111111-1111-4111-8111-111111111111'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FILE_KEY = new Uint8Array(32).fill(0x11)

let inviteFolderKey: { folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null = null
await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, (r) => ({
  ...r,
  findExistingFolderKey: async () => inviteFolderKey,
}))

/** Every POST /files/{id}/owner-key this file's fake API saw. */
const adoptCalls: Array<{ fileId: string; wrapped: string }> = []
let adoptResult: { adopted: boolean } = { adopted: true }
let custody: { owner_wrapped_folder_key: string } | null = null

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  // L6 custody and L7 child wraps: core, in process.
  unwrapFolderCustody: ownedFolderCrypto().unwrapFolderCustody,
  unwrapFolderChild: ownedFolderCrypto().unwrapFolderChild,
  readFileMetadata: async (key: Uint8Array, name: string) => createContentOps(wasm).readFileMetadata(key, name),
  deriveFileKey: async (masterKey: Uint8Array, fileId: string) =>
    wasm.derive_file_key(masterKey, encoder.encode(fileId)),
  encryptChunk: async (key: Uint8Array, plaintext: Uint8Array) => {
    const out = wasm.encrypt_chunk(key, plaintext)
    return { nonce: out.nonce as Uint8Array, ciphertext: out.ciphertext as Uint8Array }
  },
  decryptChunk: async (key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array) =>
    wasm.decrypt_chunk(key, nonce, ciphertext),
}))

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSharedFolder: async () => {
    if (!custody) throw new Error('not_found')
    return {
      folder_id: FOLDER_ID,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: custody.owner_wrapped_folder_key,
      wrapped_folder_key: null,
    }
  },
  adoptOwnerFileKey: async (fileId: string, wrapped: string) => {
    adoptCalls.push({ fileId, wrapped })
    return adoptResult
  },
})

/** Base64 of `nonce || ciphertext`, the wire form every wrap in this plan uses. */
function seal(key: Uint8Array, plaintext: Uint8Array): string {
  const out = wasm.encrypt_chunk(key, plaintext)
  const nonce = out.nonce as Uint8Array
  const ct = out.ciphertext as Uint8Array
  const bytes = new Uint8Array(nonce.length + ct.length)
  bytes.set(nonce, 0)
  bytes.set(ct, nonce.length)
  return real.toBase64(bytes as Uint8Array) as string
}

function derive(master: Uint8Array, id: string): Uint8Array {
  return wasm.derive_file_key(master, encoder.encode(id))
}

/** The owner's custody record for the folder (what the owner's device publishes): L6. */
function seedCustody() {
  custody = { owner_wrapped_folder_key: real.toBase64(wasm.wrapFolderCustody(MASTER, FOLDER_ID, FOLDER_KEY) as Uint8Array) as string }
}

/** A child wrap in a custody folder: L7, bound to (root, this file, file). */
function l7(fileId: string, key: Uint8Array = FILE_KEY): string {
  return real.toBase64(wasm.wrapFolderChild(FOLDER_KEY, FOLDER_ID, fileId, 1, key) as Uint8Array) as string
}

function seedFile() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    parent_id: FOLDER_ID,
    name_encrypted: wasm.encrypt_name_for(FILE_KEY, 'guest.txt', 'text/plain', 2),
    acted_via_share_id: 'share-1',
    uploaded_by: null,
  }
}

const { needsOwnership, adoptGuestFile, resolveSharedFileKey, openOwnerFile, unwrapOwnerFileKey, folderKeyForRoot, clearSharedFolderLookups } =
  await import(
  '../src/lib/owner-adoption'
)

// Every test starts from no custody record, no invite and an empty lookup
// cache: a custody record is cached for the session, so without this a test
// saw whatever an earlier test (in bun's --randomize order) had seeded.
const { clearCustodyMemory } = await import('../src/lib/custody-memory')

beforeEach(() => {
  clearCustodyMemory()
  custody = null
  inviteFolderKey = null
  adoptCalls.length = 0
  adoptResult = { adopted: true }
  clearSharedFolderLookups()
})

describe('folderKeyForRoot', () => {
  // Decision L1 (plan C review): the folder key is random and never derived
  // from the master key. This test used to pin the derived fallback; with no
  // custody record and no invite there is now no key at all, never a guess.
  test('no custody record and no invite: null, never the master-derived key (L1)', async () => {
    custody = null
    const key = await folderKeyForRoot(MASTER, FOLDER_ID)
    expect(key).toBeNull()
  })

  test('an invite-only folder opens with the key the sent invite carries', async () => {
    custody = null
    inviteFolderKey = { folderKey: FOLDER_KEY, encryptedOwnerFolderKeyB64: 'x' }
    try {
      const key = await folderKeyForRoot(MASTER, FOLDER_ID)
      expect(Array.from(key!)).toEqual(Array.from(FOLDER_KEY))
    } finally {
      inviteFolderKey = null
    }
  })
})

describe('needsOwnership', () => {
  test('a guest or member row needs owning, a plain row does not', () => {
    expect(needsOwnership({ id: 'a', parent_id: null, acted_via_share_id: 's' })).toBe(true)
    expect(needsOwnership({ id: 'a', parent_id: null, uploaded_by: 'u' })).toBe(true)
    expect(needsOwnership({ id: 'a', parent_id: null })).toBe(false)
    expect(needsOwnership({ id: 'a', parent_id: null, acted_via_share_id: null })).toBe(false)
  })
})

describe('adoptGuestFile', () => {
  test('unwraps with the folder key and posts a master-key wrap exactly once', async () => {
    seedCustody()
    adoptCalls.length = 0
    adoptResult = { adopted: true }
    const file = seedFile()
    const encryptedFileKey = l7(file.id)

    const first = await adoptGuestFile({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: { ...file },
      encryptedFileKeyB64: encryptedFileKey,
    })
    expect(first.adopted).toBe(true)
    expect(Array.from(first.fileKey)).toEqual(Array.from(FILE_KEY))
    expect(adoptCalls).toHaveLength(1)
    expect(adoptCalls[0].fileId).toBe(file.id)

    // The posted wrap really is the file key sealed to the owner's master key.
    const reopened = await unwrapOwnerFileKey(MASTER, file.id, adoptCalls[0].wrapped)
    expect(reopened && Array.from(reopened)).toEqual(Array.from(FILE_KEY))

    // Second sighting: the server says nothing changed and we post no more.
    adoptResult = { adopted: false }
    const second = await adoptGuestFile({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: { ...file },
      encryptedFileKeyB64: encryptedFileKey,
    })
    expect(second.adopted).toBe(false)
    expect(Array.from(second.fileKey)).toEqual(Array.from(FILE_KEY))
    expect(adoptCalls).toHaveLength(1)
  })

  test('a row that already carries an owner wrap is not posted again', async () => {
    seedCustody()
    adoptCalls.length = 0
    const file = { ...seedFile(), owner_wrapped_file_key: seal(derive(MASTER, seedFile().id), FILE_KEY) }
    const res = await adoptGuestFile({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file,
      encryptedFileKeyB64: l7(file.id),
    })
    expect(res.adopted).toBe(false)
    expect(adoptCalls).toHaveLength(0)
  })
})

describe('resolveSharedFileKey', () => {
  test('a key absent from the index resolves to null', async () => {
    seedCustody()
    const key = await resolveSharedFileKey({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: seedFile(),
      keyIndexPromise: Promise.resolve(new Map<string, string>()),
    })
    expect(key).toBeNull()
  })

  test('a key in the index unwraps with the folder key', async () => {
    seedCustody()
    const file = seedFile()
    const key = await resolveSharedFileKey({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file,
      keyIndexPromise: Promise.resolve(new Map([[file.id, l7(file.id)]])),
    })
    expect(key && Array.from(key)).toEqual(Array.from(FILE_KEY))
  })

  test("a guest-created FOLDER opens with its folder-kind wrap; a file-kind wrap on it is refused (L7)", async () => {
    seedCustody()
    clearSharedFolderLookups()
    seedCustody()
    const folderRow = { ...seedFile(), id: '44444444-4444-4444-8444-444444444444', is_folder: true }
    const asFolder = real.toBase64(wasm.wrapFolderChild(FOLDER_KEY, FOLDER_ID, folderRow.id, 2, FILE_KEY) as Uint8Array) as string
    const opened = await resolveSharedFileKey({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: folderRow,
      keyIndexPromise: Promise.resolve(new Map([[folderRow.id, asFolder]])),
    })
    expect(opened && Array.from(opened)).toEqual(Array.from(FILE_KEY))
    const refused = await resolveSharedFileKey({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: folderRow,
      keyIndexPromise: Promise.resolve(new Map([[folderRow.id, l7(folderRow.id)]])),
    })
    expect(refused).toBeNull()
  })

  test('L7b: a custody folder refuses a legacy wrap and a wrap made for another row', async () => {
    seedCustody()
    const file = seedFile()
    for (const wrap of [seal(FOLDER_KEY, FILE_KEY), l7('33333333-3333-4333-8333-333333333333')]) {
      const key = await resolveSharedFileKey({
        masterKey: MASTER,
        folderId: FOLDER_ID,
        file,
        keyIndexPromise: Promise.resolve(new Map([[file.id, wrap]])),
      })
      expect(key).toBeNull()
    }
  })

  test('L7b: an invite-only folder (no custody record) opens its legacy wrap', async () => {
    custody = null
    clearSharedFolderLookups() // a custody record is cached for the session
    inviteFolderKey = { folderKey: FOLDER_KEY, encryptedOwnerFolderKeyB64: 'x' }
    try {
      const file = seedFile()
      const key = await resolveSharedFileKey({
        masterKey: MASTER,
        folderId: FOLDER_ID,
        file,
        keyIndexPromise: Promise.resolve(new Map([[file.id, seal(FOLDER_KEY, FILE_KEY)]])),
      })
      expect(key && Array.from(key)).toEqual(Array.from(FILE_KEY))
    } finally {
      inviteFolderKey = null
    }
  })
})

describe('openOwnerFile', () => {
  test('an unopenable row reports the link it came through', async () => {
    custody = null // no folder key on this device
    const res = await openOwnerFile({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file: seedFile(),
      keyIndexPromise: Promise.resolve(new Map<string, string>()),
      labelFor: async (id) => (id === 'share-1' ? 'Family WhatsApp' : null),
    })
    expect(res).toEqual({ kind: 'cannot_open', shareLabel: 'Family WhatsApp' })
  })

  test('a refused adoption still opens through the folder key', async () => {
    seedCustody()
    adoptCalls.length = 0
    adoptResult = { adopted: false }
    const file = { ...seedFile(), id: '33333333-3333-4333-8333-333333333333' }
    const res = await openOwnerFile({
      masterKey: MASTER,
      folderId: FOLDER_ID,
      file,
      keyIndexPromise: Promise.resolve(new Map([[file.id, l7(file.id)]])),
      labelFor: async () => 'Family WhatsApp',
    })
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(Array.from(res.fileKey)).toEqual(Array.from(FILE_KEY))
  })
})


test('B adoption verifies metadata with the candidate key before a write-once store', async () => {
  seedCustody()
  adoptCalls.length = 0
  await expect(adoptGuestFile({ masterKey: MASTER, folderId: FOLDER_ID,
    file: { ...seedFile(), id: '33333333-3333-4333-8333-333333333333' },
    encryptedFileKeyB64: l7('33333333-3333-4333-8333-333333333333', new Uint8Array(32).fill(77)) })).rejects.toThrow()
  expect(adoptCalls).toHaveLength(0)
})

test('B owner wrap read accepts the server byte-array representation', async () => {
  const wire = seal(derive(MASTER, seedFile().id), FILE_KEY)
  const bytes = Array.from(real.fromBase64(wire) as Uint8Array)
  expect(await unwrapOwnerFileKey(MASTER, seedFile().id, bytes as any)).toEqual(FILE_KEY)
})
