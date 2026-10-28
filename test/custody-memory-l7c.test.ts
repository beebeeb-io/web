/**
 * Decision L7c (plan C, from the desktop #173 review): custody is monotonic
 * per client.
 *
 * The server is untrusted. Once this client has seen a VALID custody record
 * for a folder (a 200 whose owner copy opens under the L6 key, or a member's
 * 200), a later 404 / 405 / 501 must not flip the folder to the legacy unbound
 * reader: a replayed unbound wrap would then publish item A's plaintext as
 * item B. It is an error ("This folder's keys are unavailable"). A folder this
 * client has never seen custody for keeps the L7b rule: no record means a
 * flag-off invite-only share, read with the legacy reader.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const PRESEEN = '99999999-9999-4999-8999-999999999999'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FILE_KEY = new Uint8Array(32).fill(0x11)

// A durable store that outlives the module: seeded BEFORE the module under
// test is imported, as a previous page load would have left it.
const storage = new Map<string, string>()
preserveGlobals('localStorage')
setGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size
  },
})
storage.set('beebeeb.custodySeen.v1', JSON.stringify([PRESEEN]))

type CustodyAnswer = { kind: 'record' } | { kind: 'status'; status: number }
let answer: CustodyAnswer = { kind: 'record' }
let inviteKey: { folderKey: Uint8Array; encryptedOwnerFolderKeyB64: string } | null = null

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (masterKey: Uint8Array, fileId: string) => wasm.derive_file_key(masterKey, encoder.encode(fileId)),
}))

await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  getSharedFolder: async (folderId: string) => {
    if (answer.kind === 'status') {
      const ErrorClass = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new ErrorClass(`status ${answer.status}`, answer.status)
    }
    return {
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: real.toBase64(wasm.wrapFolderCustody(MASTER, folderId, FOLDER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }
  },
  getSentInvites: async () => [],
  getFile: async (id: string) => ({ id, parent_id: null }),
}))

await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, (r) => ({
  ...r,
  findExistingFolderKey: async () => inviteKey,
}))

const memory = await import('../src/lib/custody-memory')
const adoption = await import('../src/lib/owner-adoption')
const share = await import('../src/lib/folder-share-crypto')

function legacyIndex(): Promise<Map<string, string>> {
  return share.legacyInviteChildWrap(FOLDER_KEY, FILE_KEY).then((wrap) => new Map([[FILE_ID, wrap]]))
}

beforeEach(() => {
  answer = { kind: 'record' }
  inviteKey = null
  adoption.clearSharedFolderLookups()
})

describe('L7c: custody is monotonic per client', () => {
  test('the memory survives a reload: an entry written by an earlier page load is honoured', () => {
    // What an earlier page load left in the durable store (the module keeps
    // no in-memory copy, so this is exactly what a reload sees).
    storage.set('beebeeb.custodySeen.v1', JSON.stringify([PRESEEN]))
    expect(memory.hasSeenCustody(PRESEEN)).toBe(true)
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('a valid custody record (its owner copy opens under the L6 key) is remembered durably', async () => {
    memory.clearCustodyMemory()
    const root = await adoption.rootKeyAndFormat(MASTER, ROOT)
    expect(root?.format).toBe('l7')
    expect(memory.hasSeenCustody(ROOT)).toBe(true)
    expect(JSON.parse(storage.get('beebeeb.custodySeen.v1') ?? '[]')).toContain(ROOT)
  })

  test('seen, then the server answers 404 / 405 / 501: an error, never the legacy reader, and nothing opens', async () => {
    memory.clearCustodyMemory()
    await adoption.rootKeyAndFormat(MASTER, ROOT) // seen
    // The invite's legacy copy and an unbound wrap are what a downgrade would use.
    inviteKey = { folderKey: new Uint8Array(FOLDER_KEY), encryptedOwnerFolderKeyB64: 'invite' }
    for (const status of [404, 405, 501]) {
      answer = { kind: 'status', status }
      adoption.clearSharedFolderLookups()
      await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow("This folder's keys are unavailable")
      await expect(share.custodyFolderKey(MASTER, ROOT)).rejects.toThrow("This folder's keys are unavailable")
      expect(await adoption.rootKeyAndFormat(MASTER, ROOT)).toBeNull()
      const opened = await adoption.resolveSharedFileKey({
        masterKey: MASTER,
        folderId: ROOT,
        file: { id: FILE_ID, parent_id: ROOT, acted_via_share_id: 'share' },
        keyIndexPromise: legacyIndex(),
      })
      expect(opened).toBeNull()
    }
  })

  test('never seen, 501 (flag off): the folder is a legacy invite-only share and its legacy rows still read', async () => {
    memory.clearCustodyMemory()
    answer = { kind: 'status', status: 501 }
    inviteKey = { folderKey: new Uint8Array(FOLDER_KEY), encryptedOwnerFolderKeyB64: 'invite' }
    expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
    expect(await share.custodyFolderKey(MASTER, ROOT)).toBeNull()
    const opened = await adoption.resolveSharedFileKey({
      masterKey: MASTER,
      folderId: ROOT,
      file: { id: FILE_ID, parent_id: ROOT, acted_via_share_id: 'share' },
      keyIndexPromise: legacyIndex(),
    })
    expect(opened && Array.from(opened)).toEqual(Array.from(FILE_KEY))
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('a record whose owner copy does NOT open under the L6 key is not remembered', async () => {
    memory.clearCustodyMemory()
    // Another account's master key: the 200 is not a valid custody record for us.
    expect(await adoption.rootKeyAndFormat(new Uint8Array(32).fill(9), ROOT)).toBeNull()
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('clearCustodyMemory forgets every folder (sign-out, account switch)', () => {
    storage.set('beebeeb.custodySeen.v1', JSON.stringify([PRESEEN]))
    memory.markCustodySeen(ROOT)
    memory.clearCustodyMemory()
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
    expect(memory.hasSeenCustody(PRESEEN)).toBe(false)
    expect(storage.has('beebeeb.custodySeen.v1')).toBe(false)
  })
})
