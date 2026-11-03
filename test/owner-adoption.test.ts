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

// shared_folders_v1 ON for this file (the paths under test are flag-on ones).
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, { sharedFoldersEnabled: async () => true, sharedFoldersEnabledForWrite: async () => true })


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
/** What the server stores instead of the posted wrap (F13 read-back tests). */
let storedWrapOverride: string | null = null
let custody: { owner_wrapped_folder_key: string } | null = null

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  // L6 custody, L7 child wraps and L8 owner wraps: core, in process.
  unwrapFolderCustody: ownedFolderCrypto().unwrapFolderCustody,
  unwrapFolderChild: ownedFolderCrypto().unwrapFolderChild,
  wrapOwnerFileKey: ownedFolderCrypto().wrapOwnerFileKey,
  unwrapOwnerFileKey: ownedFolderCrypto().unwrapOwnerFileKey,
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

// The id class and resolver are core's (L12); run them in process here.
const { createOwnedItemOps } = await import('../src/lib/owned-item')
await mockModuleScoped('../src/lib/owned-item', import.meta.dir, {
  ownedItem: createOwnedItemOps(wasm),
})

let keyIndex: Map<string, string> = new Map()
let files: Map<string, { id: string; parent_id: string | null; is_folder?: boolean; name_encrypted?: string; owner_wrapped_file_key?: string | null }> = new Map()
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getFile: async (id: string) => {
    const row = files.get(id)
    if (!row) throw Object.assign(new Error('not found'), { status: 404 })
    return row
  },
  getSharedFolder: async () => {
    // A definitive "no custody record" is the server's 404 (anything else is
    // an error the client must not read as "not shared": rv-web198c P1-1).
    if (!custody) throw Object.assign(new Error('not found'), { status: 404 })
    return {
      folder_id: FOLDER_ID,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: custody.owner_wrapped_folder_key,
      wrapped_folder_key: null,
    }
  },
  listFilesPage: async ({ parentId, limit, cursor }: { parentId?: string | null; limit?: number; cursor?: string }) => {
    const rows = [...files.values()].filter((row) => row.parent_id === parentId)
    const start = cursor ? Number(cursor) : 0
    const size = limit ?? rows.length
    return {
      files: rows.slice(start, start + size),
      next_cursor: start + size < rows.length ? String(start + size) : null,
    }
  },
  adoptOwnerFileKey: async (fileId: string, wrapped: string) => {
    adoptCalls.push({ fileId, wrapped })
    const row = files.get(fileId)
    // Write-once on the server: the first accepted wrap is the stored one.
    if (adoptResult.adopted && row && !row.owner_wrapped_file_key) {
      row.owner_wrapped_file_key = storedWrapOverride ?? wrapped
    }
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

/** The owner's own copy of a file key: L8, bound to the item id. */
function l8(fileId: string, key: Uint8Array = FILE_KEY): string {
  return real.toBase64(wasm.wrapOwnerFileKey(MASTER, fileId, key) as Uint8Array) as string
}

/** A child wrap in a custody folder: L7, bound to (root, this file, file). */
function l7(fileId: string, key: Uint8Array = FILE_KEY): string {
  return real.toBase64(wasm.wrapFolderChild(FOLDER_KEY, FOLDER_ID, fileId, 1, key) as Uint8Array) as string
}

function seedFile() {
  return {
    // An F id (UUIDv8): what a guest's or member's create mints (L12).
    id: '22222222-2222-8222-8222-222222222222',
    parent_id: FOLDER_ID,
    name_encrypted: wasm.encrypt_name_for(FILE_KEY, 'guest.txt', 'text/plain', 2),
    acted_via_share_id: 'share-1',
    uploaded_by: null,
  }
}

// A19 needs the root's key index; serve it from this file's map.
await mockModuleScoped('../src/lib/api-folder-links', import.meta.dir, {
  listSharedFolderKeys: async () => ({ keys: Array.from(keyIndex, ([file_id, encrypted_file_key]) => ({ file_id, encrypted_file_key })), next_cursor: null }),
})

const { needsOwnership, classifyItemIds, adoptGuestFile, resolveSharedFileKey, openOwnerFile, unwrapOwnerFileKey, folderKeyForRoot, clearSharedFolderLookups } =
  await import(
  '../src/lib/owner-adoption'
)

// Every test starts from no custody record, no invite and an empty lookup
// cache: a custody record is cached for the session, so without this a test
// saw whatever an earlier test (in bun's --randomize order) had seeded.
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')

beforeEach(() => {
  resetCustodyMemoryForTests()
  custody = null
  inviteFolderKey = null
  adoptCalls.length = 0
  adoptResult = { adopted: true }
  storedWrapOverride = null
  keyIndex = new Map()
  files = new Map()
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

  // rv-web198d R1: this test used to open an invite-only folder through its
  // invite's legacy owner copy. That copy opens under the folder-NAME key, so a
  // server can forge one; the owner has no legacy read until task 2255 lands a
  // verified one. Main never had an owner-side legacy read either.
  test('an invite-only folder has no owner-side key, even when an invite carries one (R1)', async () => {
    custody = null
    inviteFolderKey = { folderKey: FOLDER_KEY, encryptedOwnerFolderKeyB64: 'x' }
    try {
      expect(await folderKeyForRoot(MASTER, FOLDER_ID)).toBeNull()
    } finally {
      inviteFolderKey = null
    }
  })
})

describe('needsOwnership', () => {
  // L12 (2275): the id class decides the key path; attribution columns are a
  // server-supplied hint and must lose to the class once it is known.
  test('the id class wins over the attribution hint', async () => {
    const o = '55555555-5555-4555-8555-555555555555'
    const f = '55555555-5555-8555-8555-555555555555'
    await classifyItemIds([o, f])
    expect(needsOwnership({ id: f })).toBe(true)
    expect(needsOwnership({ id: o, acted_via_share_id: 's' })).toBe(false)
    expect(needsOwnership({ id: o, uploaded_by: 'someone-else' })).toBe(false)
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
    const file = { ...seedFile(), owner_wrapped_file_key: l8(seedFile().id) }
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

  test('L7b + R1: an invite-only folder (no custody record) does not open its legacy wrap for the owner', async () => {
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
      expect(key).toBeNull()
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
  const wire = l8(seedFile().id)
  const bytes = Array.from(real.fromBase64(wire) as Uint8Array)
  expect(await unwrapOwnerFileKey(MASTER, seedFile().id, bytes as any)).toEqual(FILE_KEY)
})

describe('L8: an owner wrap is core\'s purpose-bound record, and nothing else opens as one', () => {
  test("the folder's own name blob is REJECTED as owner_wrapped_file_key", async () => {
    const folderId = '55555555-5555-4555-8555-555555555555'
    const json = JSON.stringify({ name: 'Docs', mime_type: null }) // exactly 32 bytes
    expect(new TextEncoder().encode(json).length).toBe(32)
    const nameBlob = wasm.encrypt_metadata(derive(MASTER, folderId), json) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const forged = real.toBase64(new Uint8Array([...nameBlob.nonce, ...nameBlob.ciphertext])) as string
    expect(await unwrapOwnerFileKey(MASTER, folderId, forged)).toBeNull()
  })

  test("an item's v1 content frame (32 plaintext bytes under its derived key) is REJECTED", async () => {
    const fileId = seedFile().id
    const frame = seal(derive(MASTER, fileId), new Uint8Array(32).fill(0x33))
    expect(await unwrapOwnerFileKey(MASTER, fileId, frame)).toBeNull()
  })

  test('the adoption record written is L8: it opens for this item, not for another', async () => {
    adoptCalls.length = 0
    seedCustody()
    const file = seedFile()
    await adoptGuestFile({ masterKey: MASTER, folderId: FOLDER_ID, file: { ...file }, encryptedFileKeyB64: l7(file.id) })
    expect(adoptCalls).toHaveLength(1)
    const bytes = real.fromBase64(adoptCalls[0].wrapped) as Uint8Array
    expect(Array.from(wasm.unwrapOwnerFileKey(MASTER, file.id, bytes) as Uint8Array)).toEqual(Array.from(FILE_KEY))
    expect(() => wasm.unwrapOwnerFileKey(MASTER, '66666666-6666-4666-8666-666666666666', bytes)).toThrow()
  })
})


describe('A19: F descendants are adopted before a move out of the root (L12)', () => {
  test('an F child with a root wrap is adopted and read back before the move', async () => {
    seedCustody()
    const file = seedFile()
    keyIndex.set(file.id, l7(file.id))
    files.set(file.id, { id: file.id, parent_id: FOLDER_ID, name_encrypted: file.name_encrypted })
    const { adoptForeignTreeBeforeMove } = await import('../src/lib/owner-adoption')
    // The server stores what was posted, so the read-back finds the wrap.
    adoptResult = { adopted: true }
    const res = await adoptForeignTreeBeforeMove({ masterKey: MASTER, rootId: FOLDER_ID, itemIds: [file.id] })
    expect(res.adopted).toBe(1)
    expect(adoptCalls.map((c) => c.fileId)).toEqual([file.id])
  })

  test('a moved FOLDER of guest uploads adopts every file inside it', async () => {
    seedCustody()
    adoptResult = { adopted: true }
    // An owner-created folder (a v4 id, so not foreign) holding two guest
    // uploads (v8 F ids). Only the row's is_folder reaches its contents.
    const guestFolder = { id: '33333333-3333-4333-8333-333333333333', parent_id: FOLDER_ID, is_folder: true }
    files.set(guestFolder.id, guestFolder)
    const a = { ...seedFile(), id: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa', parent_id: guestFolder.id }
    const b = { ...seedFile(), id: 'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb', parent_id: guestFolder.id }
    for (const child of [a, b]) {
      files.set(child.id, { id: child.id, parent_id: child.parent_id, name_encrypted: child.name_encrypted })
      keyIndex.set(child.id, l7(child.id))
    }
    const { adoptForeignTreeBeforeMove } = await import('../src/lib/owner-adoption')
    const res = await adoptForeignTreeBeforeMove({
      masterKey: MASTER,
      rootId: FOLDER_ID,
      itemIds: [guestFolder.id],
      items: [{ id: guestFolder.id, is_folder: true }],
    })
    expect(res.adopted).toBe(2)
    expect(adoptCalls.map((c) => c.fileId).sort()).toEqual([a.id, b.id].sort())
  })

  test('a read-back wrap that opens but holds a different key refuses the move', async () => {
    seedCustody()
    const file = seedFile()
    keyIndex.set(file.id, l7(file.id))
    files.set(file.id, { id: file.id, parent_id: FOLDER_ID, name_encrypted: file.name_encrypted })
    // The server accepts the adoption but stores a wrap of its own making: it
    // opens for this item under the owner's master, so "it opens" is not proof
    // that it holds the key this client adopted.
    storedWrapOverride = l8(file.id, new Uint8Array(32).fill(0x77))
    const { adoptForeignTreeBeforeMove, MoveNeedsAdoptionError } = await import('../src/lib/owner-adoption')
    await expect(
      adoptForeignTreeBeforeMove({ masterKey: MASTER, rootId: FOLDER_ID, itemIds: [file.id] }),
    ).rejects.toBeInstanceOf(MoveNeedsAdoptionError)
  })

  test('F13: the cap counts only F items and is checked before any adoption write', async () => {
    seedCustody()
    adoptResult = { adopted: true }
    // The moved folder holds one F file and one owner folder whose own children
    // are all owner items. Counting every item trips the cap mid-walk, after
    // the F file was already adopted; only F items may count, and the check
    // must happen before the first write.
    const moved = { id: '33333333-3333-4333-8333-333333333333', parent_id: FOLDER_ID, is_folder: true }
    const nested = { id: '44444444-4444-4444-8444-444444444444', parent_id: moved.id, is_folder: true }
    files.set(moved.id, moved)
    files.set(nested.id, nested)
    const file = seedFile()
    files.set(file.id, { id: file.id, parent_id: moved.id, name_encrypted: file.name_encrypted })
    keyIndex.set(file.id, l7(file.id))
    for (let i = 0; i < 10_001; i += 1) {
      const id = `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`
      files.set(id, { id, parent_id: nested.id })
    }
    const { adoptForeignTreeBeforeMove } = await import('../src/lib/owner-adoption')
    const res = await adoptForeignTreeBeforeMove({
      masterKey: MASTER,
      rootId: FOLDER_ID,
      itemIds: [moved.id],
      items: [{ id: moved.id, is_folder: true }],
    })
    expect(res.adopted).toBe(1)
    expect(adoptCalls.map((c) => c.fileId)).toEqual([file.id])
  })

  test('more than 10,000 F items refuses the move before adopting anything', async () => {
    seedCustody()
    const ids = Array.from({ length: 10_001 }, (_, i) => `aaaaaaaa-aaaa-8aaa-8aaa-${String(i).padStart(12, '0')}`)
    const { adoptForeignTreeBeforeMove, ADOPTION_MAX_ITEMS, AdoptionTooLargeError } = await import('../src/lib/owner-adoption')
    expect(ADOPTION_MAX_ITEMS).toBe(10_000)
    await expect(
      adoptForeignTreeBeforeMove({
        masterKey: MASTER,
        rootId: FOLDER_ID,
        itemIds: ids,
        items: ids.map((id) => ({ id, is_folder: false })),
      }),
    ).rejects.toBeInstanceOf(AdoptionTooLargeError)
    expect(adoptCalls).toHaveLength(0)
  })

  test('an F child with no key row refuses the whole move, and posts nothing', async () => {
    seedCustody()
    const file = seedFile()
    files.set(file.id, { id: file.id, parent_id: FOLDER_ID, name_encrypted: file.name_encrypted })
    const { adoptForeignTreeBeforeMove, MoveNeedsAdoptionError } = await import('../src/lib/owner-adoption')
    await expect(adoptForeignTreeBeforeMove({ masterKey: MASTER, rootId: FOLDER_ID, itemIds: [file.id] }))
      .rejects.toBeInstanceOf(MoveNeedsAdoptionError)
    expect(adoptCalls).toHaveLength(0)
  })
})
