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

// shared_folders_v1 ON for this file (the paths under test are flag-on ones).
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, { sharedFoldersEnabled: async () => true, sharedFoldersEnabledForWrite: async () => true })


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
  getItem: (key: string) => {
    if (getItemThrows) throw new Error('SecurityError')
    return storage.get(key) ?? null
  },
  setItem: (key: string, value: string) => {
    if (setItemThrows) throw new Error('QuotaExceededError')
    storage.set(key, String(value))
  },
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size
  },
})
// L7d (lead, 2026-10-28): the memory belongs to the DEVICE, not to an account.
// One key, a monotonic set of canonical folder UUIDs, seeded before the module
// under test is imported, as a previous page load (of any account) left it.
const KEY = 'beebeeb.custodySeen.v1'
storage.set(KEY, JSON.stringify([PRESEEN]))
/** When set, localStorage.setItem throws (storage full, private mode). */
let setItemThrows = false
/** When set, localStorage.getItem throws (storage blocked). */
let getItemThrows = false

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
  setItemThrows = false
  getItemThrows = false
  adoption.clearSharedFolderLookups()
})

describe('L7c: custody is monotonic per client', () => {
  test('the memory survives a reload: an entry written by an earlier page load is honoured', () => {
    // What an earlier page load left in the durable store (the module keeps
    // no in-memory copy, so this is exactly what a reload sees).
    storage.set(KEY, JSON.stringify([PRESEEN]))
    expect(memory.hasSeenCustody(PRESEEN)).toBe(true)
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('a valid custody record (its owner copy opens under the L6 key) is remembered durably', async () => {
    memory.resetCustodyMemoryForTests()
    const root = await adoption.rootKeyAndFormat(MASTER, ROOT)
    expect(root?.format).toBe('l7')
    expect(memory.hasSeenCustody(ROOT)).toBe(true)
    expect(JSON.parse(storage.get(KEY) ?? '[]')).toContain(ROOT)
  })

  test('seen, then the server answers 404 / 405 / 501: an error, never the legacy reader, and nothing opens', async () => {
    memory.resetCustodyMemoryForTests()
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
    memory.resetCustodyMemoryForTests()
    answer = { kind: 'status', status: 501 }
    inviteKey = { folderKey: new Uint8Array(FOLDER_KEY), encryptedOwnerFolderKeyB64: 'invite' }
    const format = await adoption.folderWrapFormat(ROOT)
    expect(format).toBe('legacy_invite')
    expect(await share.custodyFolderKey(MASTER, ROOT)).toBeNull()
    // The member reader (shared-folder page, sidebar) opens a legacy row in
    // that format with the key its invite carries.
    const [, wrap] = [...(await legacyIndex())][0]
    const opened = await share.openFolderChild(format, FOLDER_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, wrap)
    expect(Array.from(opened)).toEqual(Array.from(FILE_KEY))
    // rv-web198d R1: the OWNER has no legacy read (task 2255 brings a verified
    // one); its open of the same row is null, not the legacy key.
    const ownerOpen = await adoption.resolveSharedFileKey({
      masterKey: MASTER,
      folderId: ROOT,
      file: { id: FILE_ID, parent_id: ROOT, acted_via_share_id: 'share' },
      keyIndexPromise: legacyIndex(),
    })
    expect(ownerOpen).toBeNull()
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('a record whose owner copy does NOT open under the L6 key is not remembered', async () => {
    memory.resetCustodyMemoryForTests()
    // Another account's master key: the 200 is not a valid custody record for us.
    expect(await adoption.rootKeyAndFormat(new Uint8Array(32).fill(9), ROOT)).toBeNull()
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
  })

  test('the test reset forgets every folder (product code has no way to)', () => {
    storage.set(KEY, JSON.stringify([PRESEEN]))
    memory.markCustodySeen(ROOT)
    memory.resetCustodyMemoryForTests()
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
    expect(memory.hasSeenCustody(PRESEEN)).toBe(false)
    expect(storage.has(KEY)).toBe(false)
  })
})

describe('L7d: the memory belongs to the device and only grows', () => {
  test('one key, no account in it: a JSON array of canonical (lower-case) folder UUIDs', () => {
    memory.resetCustodyMemoryForTests()
    memory.markCustodySeen(ROOT.toUpperCase())
    memory.markCustodySeen(PRESEEN)
    expect([...storage.keys()].filter((k) => k.startsWith('beebeeb.custodySeen'))).toEqual([KEY])
    expect(JSON.parse(storage.get(KEY)!).sort()).toEqual([ROOT, PRESEEN].sort())
    // Looked up the same way, whatever the case the server sends.
    expect(memory.hasSeenCustody(ROOT.toUpperCase())).toBe(true)
  })

  test('seen, then sign-out, then sign-in as the same or another account: a custody 404 still refuses', async () => {
    memory.resetCustodyMemoryForTests()
    await adoption.rootKeyAndFormat(MASTER, ROOT) // seen
    // What fullLogout, a lock, a sign-in and an account switch run (key-context).
    adoption.forgetSharedFolderSession() // sign-out
    adoption.forgetSharedFolderSession() // sign-in as the same account
    adoption.forgetSharedFolderSession() // sign-in as another account
    memory.forgetPageMemoryForTests() // and a reload: only the durable set is left
    answer = { kind: 'status', status: 404 }
    inviteKey = { folderKey: new Uint8Array(FOLDER_KEY), encryptedOwnerFolderKeyB64: 'invite' }
    await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow("This folder's keys are unavailable")
    await expect(share.custodyFolderKey(MASTER, ROOT)).rejects.toThrow("This folder's keys are unavailable")
    expect(JSON.parse(storage.get(KEY) ?? '[]')).toContain(ROOT)
  })

  test('no product module can shrink it: key-context clears nothing, and only the test hook resets', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dir, '..', 'src')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
      })
    const offenders: string[] = []
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8')
      if (file.endsWith('custody-memory.ts')) continue
      if (/resetCustodyMemoryForTests|forgetPageMemoryForTests|clearCustodyMemory|removeItem\(['"]beebeeb\.custodySeen/.test(text)) offenders.push(file.slice(root.length + 1))
    }
    expect(offenders).toEqual([])
    expect('clearCustodyMemory' in memory).toBe(false)
    // Sign-out, lock and an account switch forget the session, never the memory.
    expect(readFileSync(join(root, 'lib/key-context.tsx'), 'utf8')).toContain('forgetSharedFolderSession()')
  })

  test('an unreadable stored value refuses legacy for every folder, and is never overwritten', async () => {
    for (const raw of ['{not json', '"x"', '[1, 2]', '["not-a-uuid"]', '{}']) {
      memory.resetCustodyMemoryForTests()
      storage.set(KEY, raw)
      expect(memory.hasSeenCustody(ROOT)).toBe(true)
      answer = { kind: 'status', status: 404 }
      adoption.clearSharedFolderLookups()
      await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow("This folder's keys are unavailable")
      // Recording a folder never overwrites it: the id goes to memory only,
      // and its custody key can still be used (L7 is the safe direction).
      memory.markCustodySeen(PRESEEN)
      expect(storage.get(KEY)).toBe(raw)
    }
  })

  // L7d on web (lead clarification, 2026-10-28): storage that can't be used
  // (blocked, private mode, quota) means no DURABLE memory, the new-device
  // residual. The id is recorded in memory, the key is used, nothing refuses.
  // Only a stored value that exists but is not a canonical set refuses.
  test('setItem throws (quota, private mode): recorded in memory, the custody key works, legacy stays refused this page load', async () => {
    memory.resetCustodyMemoryForTests()
    setItemThrows = true
    expect((await adoption.rootKeyAndFormat(MASTER, ROOT))?.format).toBe('l7')
    expect(await share.custodyFolderKey(MASTER, ROOT)).not.toBeNull()
    expect(storage.has(KEY)).toBe(false)
    expect(memory.hasSeenCustody(ROOT)).toBe(true)
    answer = { kind: 'status', status: 404 }
    adoption.clearSharedFolderLookups()
    await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow("This folder's keys are unavailable")
  })

  test('getItem throws (storage blocked): a legacy read is allowed, the custody key works, and the page remembers it', async () => {
    memory.resetCustodyMemoryForTests()
    getItemThrows = true
    // Nothing seen on this page: a "no record" folder reads legacy, as on a new device.
    answer = { kind: 'status', status: 404 }
    expect(memory.hasSeenCustody(ROOT)).toBe(false)
    expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
    // A custody record opens and is used.
    answer = { kind: 'record' }
    adoption.clearSharedFolderLookups()
    expect((await adoption.rootKeyAndFormat(MASTER, ROOT))?.format).toBe('l7')
    // ...and for the rest of this page load that folder refuses legacy.
    answer = { kind: 'status', status: 404 }
    adoption.clearSharedFolderLookups()
    await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow("This folder's keys are unavailable")
  })

  // A server that sends a seen folder's id in another form (its UUID parser
  // accepts them all) must not miss the set: every id is parsed to the
  // canonical lower-case hyphenated form. An id that is no UUID refuses.
  test('every form of a seen id reads as seen: hyphen-less, braced, upper-case and urn', async () => {
    memory.resetCustodyMemoryForTests()
    memory.markCustodySeen(ROOT)
    const hex = ROOT.replace(/-/g, '')
    for (const form of [hex, `{${ROOT}}`, ROOT.toUpperCase(), `urn:uuid:${ROOT}`, hex.toUpperCase()]) {
      expect(memory.hasSeenCustody(form)).toBe(true)
      expect(() => memory.assertNeverSawCustody(form)).toThrow("This folder's keys are unavailable")
      await expect(memory.assertNoSeenAncestor(form, async () => null)).rejects.toThrow("This folder's keys are unavailable")
    }
    // ...and every form of a folder never seen parses, so it reads as NOT seen
    // (an unparsed form would count as seen, which would hide a broken parser).
    const other = PRESEEN.replace(/-/g, '')
    for (const form of [other, `{${PRESEEN}}`, PRESEEN.toUpperCase(), `urn:uuid:${PRESEEN}`, `URN:UUID:${PRESEEN}`]) {
      expect(memory.hasSeenCustody(form)).toBe(false)
    }
  })

  test('a seen id marked in another form is stored canonical', () => {
    memory.resetCustodyMemoryForTests()
    memory.markCustodySeen(`{${ROOT.toUpperCase()}}`)
    expect(JSON.parse(storage.get(KEY)!)).toEqual([ROOT])
    expect(memory.hasSeenCustody(ROOT)).toBe(true)
  })

  test('an id that is no UUID counts as seen (refuses) and is never stored', async () => {
    memory.resetCustodyMemoryForTests()
    for (const garbage of ['folder-1', '', 'not-a-uuid', `${ROOT}0`, ROOT.slice(1)]) {
      expect(memory.hasSeenCustody(garbage)).toBe(true)
      expect(() => memory.markCustodySeen(garbage)).toThrow()
      // Even with nothing in the set, a walk from it refuses.
      await expect(memory.assertNoSeenAncestor(garbage, async () => null)).rejects.toThrow("This folder's keys are unavailable")
    }
    expect(storage.has(KEY)).toBe(false)
    // ...and once anything is in the set (the walk runs only then), a parent
    // that is no UUID refuses mid-walk.
    memory.markCustodySeen(ROOT)
    await expect(memory.assertNoSeenAncestor(PRESEEN, async () => 'garbage')).rejects.toThrow("This folder's keys are unavailable")
  })
})
