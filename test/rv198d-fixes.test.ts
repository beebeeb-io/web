/**
 * rv-web198d (re-review of web #198 at 2283a4b): the reviewer's probes
 * (`rv-web198d/zz-rv198d-new.test.ts`), adopted as tests. Each probe asserted
 * the behaviour the review reported; here each asserts the fixed behaviour,
 * next to the control the probe already had.
 *
 *  - N1 / contract §2: a folder with legacy rows gets no fresh custody. The
 *    server answers 409 `upgrade_required` (rows from cancelled or denied
 *    invites count); the client reports "this folder needs the upgrade" as a
 *    typed error and never falls back to a legacy write.
 *  - N2: a failed flag read is not cached, and a folder this client has seen
 *    with custody never has its key publish silently skipped.
 *  - N3 / R1: the owner never reads a legacy owner copy to open a row (that
 *    copy opens under the folder-name key, so a server can forge one). No
 *    owner-side legacy read until task 2255 brings a verified one.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { createContentOps } from '../src/lib/content-crypto'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const encoder = new TextEncoder()
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const SUB = '33333333-3333-4333-8333-333333333333'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const LEGACY_KEY = new Uint8Array(32).fill(0x5a)
const CUSTODY_KEY = new Uint8Array(32).fill(0x77)
const CHILD_KEY = new Uint8Array(32).fill(0x11)
const SERVER_FILE_KEY = new Uint8Array(32).fill(0x66)

const storage = new Map<string, string>()
preserveGlobals('localStorage')
setGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size },
})

let flagOn = true
let custody: 'record' | number = 404
let custodyCalls = 0
let parentCalls = 0
let sentInvites: unknown[] = []
let sentInviteReads = 0
/** How many shared_folder_keys rows the server holds for ROOT (contract §2). */
let serverRows = 0
const registered: string[] = []
const published: string[] = []
const adopted: { id: string; wrap: string }[] = []

/** A write's flag read that failed (rv-web198e P3); reads still see `flagOn`. */
let flagReadFails = false
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => (flagReadFails ? false : flagOn),
  sharedFoldersEnabledForWrite: async () => {
    if (flagReadFails) throw new (r.FeatureFlagsUnavailableError as new () => Error)()
    return flagOn
  },
}))
const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, encoder.encode(id)),
  readFileMetadata: async (k: Uint8Array, n: string) => ops.readFileMetadata(k, n),
}))
const api = await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => {
  const ApiErrorClass = r.ApiError as unknown as new (m: string, s: number, code?: string) => Error
  return {
    getSharedFolder: async (folderId: string) => {
      custodyCalls += 1
      if (custody !== 'record') throw new ApiErrorClass(`status ${custody}`, custody)
      return {
        folder_id: folderId, role: 'owner', access_level: 'edit', key_version: 1,
        owner_wrapped_folder_key: Buffer.from(wasm.wrapFolderCustody(MASTER, folderId, CUSTODY_KEY) as Uint8Array).toString('base64'),
        wrapped_folder_key: null,
      }
    },
    getFile: async (id: string) => {
      parentCalls += 1
      return { id, parent_id: id === ROOT ? null : id === SUB ? ROOT : SUB }
    },
    getSentInvites: async () => {
      sentInviteReads += 1
      return sentInvites
    },
    publishSharedFolderKeys: async (_root: string, entries: { file_id: string }[]) => {
      for (const e of entries) published.push(e.file_id)
      return { written: entries.length, skipped: 0 }
    },
    registerSharedFolderKey: async (_f: string, body: { owner_wrapped_folder_key: string }) => {
      // Contract §2: a folder with rows and no custody record is refused under
      // the owner lock, whatever its invites' status.
      if (serverRows > 0) throw new ApiErrorClass('upgrade required', 409, 'upgrade_required')
      registered.push(body.owner_wrapped_folder_key)
      return { created: true, key_version: 1 }
    },
    adoptOwnerFileKey: async (id: string, wrap: string) => {
      adopted.push({ id, wrap })
      return { adopted: true }
    },
    updateFile: async (id: string, body: Record<string, unknown>) => ({ id, ...body }),
    listFilesPage: async () => ({ files: [], next_cursor: null }),
  }
})

const share = await import('../src/lib/folder-share-crypto')
const adoption = await import('../src/lib/owner-adoption')
const { publishOwnerUploadKey, moveOwnerItems, MOVED_BUT_UNPUBLISHED } = await import('../src/lib/owner-upload-key')
const { ensureOwnerFolderKey, REAL_FOLDER_LINK_PORTS } = await import('../src/lib/folder-link-create')
const { FolderNeedsUpgradeError, FOLDER_NEEDS_UPGRADE } = await import('../src/lib/folder-upgrade')
const { userFriendlyError } = await import('../src/lib/user-friendly-error')
const { resetCustodyMemoryForTests, hasSeenCustody, markCustodySeen } = await import('../src/lib/custody-memory')


const b64 = (b: Uint8Array) => real.toBase64(b) as string
async function legacyInviteRows(status: string) {
  return [{ id: 'inv', is_folder_share: true, file_id: ROOT, status, created_at: '2026-10-01T00:00:00Z',
    encrypted_owner_folder_key: b64(await share.legacyInviteOwnerWrap(MASTER, ROOT, LEGACY_KEY)) }]
}

beforeEach(() => {
  adoption.clearSharedFolderLookups()
  resetCustodyMemoryForTests()
  flagOn = true; flagReadFails = false; custody = 404; custodyCalls = 0; parentCalls = 0; sentInvites = []
  serverRows = 0; sentInviteReads = 0
  registered.length = 0; published.length = 0; adopted.length = 0
})

describe('rv198d N1 / contract §2: a folder with legacy rows needs the upgrade, as a typed answer', () => {
  test('control: an approved flag-off invite is refused before anything is minted, with the typed error', async () => {
    sentInvites = await legacyInviteRows('approved')
    serverRows = 1
    const err = await ensureOwnerFolderKey(ROOT, MASTER, REAL_FOLDER_LINK_PORTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FolderNeedsUpgradeError)
    expect((err as Error).message).toBe(FOLDER_NEEDS_UPGRADE)
    expect(registered.length).toBe(0)
  })

  for (const label of ['denied', 'cancelled (row deleted)']) {
    test(`flag-off invites ${label}: the server's 409 upgrade_required is "needs the upgrade", and nothing is written`, async () => {
      sentInvites = label === 'denied' ? await legacyInviteRows('denied') : []
      // Cancel and deny never delete the rows (server invites.rs).
      serverRows = 1
      const err = await ensureOwnerFolderKey(ROOT, MASTER, REAL_FOLDER_LINK_PORTS).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(FolderNeedsUpgradeError)
      expect(registered.length).toBe(0)
      // Never a legacy fallback: no key published, no custody remembered.
      expect(published.length).toBe(0)
      expect(hasSeenCustody(ROOT)).toBe(false)
    })
  }

  test('the copy is the upgrade notice: never generic, never "remove its pending invites"', () => {
    const ApiErrorClass = api.ApiError as unknown as new (m: string, s: number, code?: string) => Error
    expect(userFriendlyError(new FolderNeedsUpgradeError(ROOT))).toBe(FOLDER_NEEDS_UPGRADE)
    expect(userFriendlyError(new ApiErrorClass('conflict', 409, 'upgrade_required'))).toBe(FOLDER_NEEDS_UPGRADE)
    expect(FOLDER_NEEDS_UPGRADE).not.toMatch(/pending invites|Upgrade it first/)
    expect(share.FOLDER_KEY_UNVERIFIED).not.toMatch(/pending invites|share again/)
  })

  test('a typed hook runs the upgrade when one is wired (web #199), and nothing else is registered here', async () => {
    serverRows = 1
    const upgraded: string[] = []
    const key = await ensureOwnerFolderKey(ROOT, MASTER, {
      ...REAL_FOLDER_LINK_PORTS,
      upgradeLegacyFolder: async (folderId) => {
        upgraded.push(folderId)
        return new Uint8Array(CUSTODY_KEY)
      },
    })
    expect(upgraded).toEqual([ROOT])
    expect(Array.from(key)).toEqual(Array.from(CUSTODY_KEY))
    expect(registered.length).toBe(0)
  })
})

describe('rv198d N2: a flag read that says off never skips a publish for a folder seen with custody', () => {
  test('control: flag on, an upload into a custody folder publishes its L7 wrap', async () => {
    custody = 'record'
    await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, CHILD_KEY)
    expect(published).toEqual([FILE_ID])
  })

  test('flag read off, folder seen with custody: the publish throws instead of resolving with nothing sent', async () => {
    custody = 'record'; markCustodySeen(ROOT); flagOn = false
    await expect(publishOwnerUploadKey(MASTER, ROOT, FILE_ID, CHILD_KEY)).rejects.toThrow("This folder's keys are unavailable")
    expect(published).toEqual([])
    expect(custodyCalls).toBe(0)
  })

  test('flag read off, a subfolder of a folder seen with custody: also refused (the walk finds the root)', async () => {
    markCustodySeen(ROOT); flagOn = false
    await expect(publishOwnerUploadKey(MASTER, SUB, FILE_ID, CHILD_KEY)).rejects.toThrow("This folder's keys are unavailable")
    expect(custodyCalls).toBe(0)
  })

  test('flag read off, a move into a folder seen with custody: the move stands and says it is not readable yet', async () => {
    markCustodySeen(ROOT); flagOn = false
    await expect(moveOwnerItems({ ids: [FILE_ID], destinationId: ROOT, rows: [{ id: FILE_ID }], masterKey: MASTER, viewerId: null }))
      .rejects.toThrow(MOVED_BUT_UNPUBLISHED)
    expect(published).toEqual([])
  })

  test('flag off and nothing seen with custody (all of prod today): no request at all, no throw', async () => {
    flagOn = false
    for (let i = 0; i < 3; i += 1) await publishOwnerUploadKey(MASTER, SUB, FILE_ID, CHILD_KEY)
    expect(custodyCalls).toBe(0)
    expect(parentCalls).toBe(0)
    expect(published).toEqual([])
  })
})

describe('rv198d N3 / R1: the owner never opens a row through a legacy owner copy', () => {
  async function forgedNameBlobScenario() {
    const nameKey = wasm.derive_file_key(MASTER, encoder.encode(ROOT)) as Uint8Array
    const json = JSON.stringify({ name: 'Docs', mime_type: null })
    const nb = wasm.encrypt_metadata(nameKey, json) as { nonce: Uint8Array; ciphertext: Uint8Array }
    sentInvites = [{ id: 'fake', is_folder_share: true, file_id: ROOT, status: 'invited', created_at: '2026-10-28T00:00:00Z',
      encrypted_owner_folder_key: b64(new Uint8Array([...nb.nonce, ...nb.ciphertext])) }]
    // Everything below is computable by the server: the "folder key" is the folder's name JSON.
    const forgedRow = await share.legacyInviteChildWrap(encoder.encode(json), SERVER_FILE_KEY)
    const fn = wasm.encrypt_metadata(SERVER_FILE_KEY, JSON.stringify({ name: 'invoice.pdf', mime_type: 'application/pdf' })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const file = { id: FILE_ID, parent_id: ROOT, uploaded_by: MEMBER, name_encrypted: real.serializeEncryptedBlob(fn.nonce, fn.ciphertext) as string }
    return { file, forgedRow }
  }

  for (const flag of [true, false]) {
    test(`flag ${flag ? 'on' : 'off'}: a folder NAME blob as owner copy opens nothing and adopts nothing`, async () => {
      flagOn = flag
      const { file, forgedRow } = await forgedNameBlobScenario()
      const res = await adoption.openOwnerFile({ masterKey: MASTER, folderId: ROOT, file,
        keyIndexPromise: Promise.resolve(new Map([[FILE_ID, forgedRow]])), labelFor: async () => null })
      expect(res.kind).not.toBe('ok')
      expect(adopted.length).toBe(0)
    })
  }

  test('a genuine legacy invite-only folder: rootKeyAndFormat has no owner-side key for it (no legacy read until task 2255)', async () => {
    sentInvites = await legacyInviteRows('approved')
    expect(await adoption.rootKeyAndFormat(MASTER, ROOT)).toBeNull()
    expect(await adoption.folderKeyForRoot(MASTER, ROOT)).toBeNull()
    // The format oracle still names it legacy (the member reader and the
    // flag-off invite build need that); only the owner open is gone.
    expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
  })

  test('control: a custody folder still opens and adopts (flag on)', async () => {
    custody = 'record'
    const fn = wasm.encrypt_metadata(CHILD_KEY, JSON.stringify({ name: 'a.txt', mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const file = { id: FILE_ID, parent_id: ROOT, uploaded_by: MEMBER, name_encrypted: real.serializeEncryptedBlob(fn.nonce, fn.ciphertext) as string }
    const row = await share.sealChildKey(CUSTODY_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, CHILD_KEY)
    const res = await adoption.openOwnerFile({ masterKey: MASTER, folderId: ROOT, file,
      keyIndexPromise: Promise.resolve(new Map([[FILE_ID, row]])), labelFor: async () => null })
    expect(res.kind).toBe('ok')
    expect(adopted.map((a) => a.id)).toEqual([FILE_ID])
  })

  test('flag off: an owner open makes no adoption POST (outcome; the POST itself is flag-gated too)', async () => {
    custody = 'record'
    flagOn = false
    const fn = wasm.encrypt_metadata(CHILD_KEY, JSON.stringify({ name: 'a.txt', mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const file = { id: FILE_ID, parent_id: ROOT, uploaded_by: MEMBER, name_encrypted: real.serializeEncryptedBlob(fn.nonce, fn.ciphertext) as string }
    const row = await share.sealChildKey(CUSTODY_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, CHILD_KEY)
    await adoption.openOwnerFile({ masterKey: MASTER, folderId: ROOT, file,
      keyIndexPromise: Promise.resolve(new Map([[FILE_ID, row]])), labelFor: async () => null })
    expect(adopted.length).toBe(0)
  })
})

describe("R1: getFileKeyForFile's foreign-row branch is flag-gated (foreignRowKey)", () => {
  const memberRow = { id: FILE_ID, parent_id: SUB, uploaded_by: MEMBER }
  const keyIndexFor = async () => new Map<string, string>()

  test('flag off: no shared-folder request at all and no key (the caller derives, as main does)', async () => {
    flagOn = false
    sentInvites = await legacyInviteRows('approved')
    expect(await adoption.foreignRowKey({ masterKey: MASTER, file: memberRow, viewerId: 'acct-owner', keyIndexFor })).toBeNull()
    expect(custodyCalls).toBe(0)
    expect(parentCalls).toBe(0)
    expect(sentInviteReads).toBe(0)
  })

  test("the owner's own row is never foreign: null without a request, flag on", async () => {
    const own = { id: FILE_ID, parent_id: SUB, uploaded_by: 'acct-owner' }
    expect(await adoption.foreignRowKey({ masterKey: MASTER, file: own, viewerId: 'acct-owner', keyIndexFor })).toBeNull()
    expect(custodyCalls + parentCalls + sentInviteReads).toBe(0)
  })

  test('flag on, custody folder: the row opens through its L7 wrap', async () => {
    custody = 'record'
    const row = await share.sealChildKey(CUSTODY_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, CHILD_KEY)
    const fn = wasm.encrypt_metadata(CHILD_KEY, JSON.stringify({ name: 'a.txt', mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const file = { ...memberRow, parent_id: ROOT, name_encrypted: real.serializeEncryptedBlob(fn.nonce, fn.ciphertext) as string }
    const key = await adoption.foreignRowKey({ masterKey: MASTER, file, viewerId: 'acct-owner',
      keyIndexFor: async () => new Map([[FILE_ID, row]]) })
    expect(Array.from(key ?? [])).toEqual(Array.from(CHILD_KEY))
  })

  test('flag on, legacy invite-only folder: no owner-side legacy read (R1)', async () => {
    sentInvites = await legacyInviteRows('approved')
    const legacyRow = await share.legacyInviteChildWrap(LEGACY_KEY, CHILD_KEY)
    const key = await adoption.foreignRowKey({ masterKey: MASTER, file: { ...memberRow, parent_id: ROOT }, viewerId: 'acct-owner',
      keyIndexFor: async () => new Map([[FILE_ID, legacyRow]]) })
    expect(key).toBeNull()
  })
})

describe('R1: the legacy owner-copy reader is reachable only from the invite build', () => {
  test('owner-adoption.ts names neither findExistingFolderKey nor legacyInviteOwnerKey', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(import.meta.dir, '..', 'src/lib/owner-adoption.ts'), 'utf8')
    expect(text).not.toContain('findExistingFolderKey')
    expect(text).not.toContain('legacyInviteOwnerKey')
  })
})

describe('R1: no owner-side shared-folder walk with the flag off, anywhere in src/', () => {
  test('the preview reads the flag before it walks to a shared root (flag off: the derived key, as main does)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(import.meta.dir, '..', 'src/components/preview/file-preview.tsx'), 'utf8')
    const body = text.slice(text.indexOf('const resolveFileKey'), text.indexOf('sharedRootFor(folderId'))
    expect(body.length).toBeGreaterThan(0)
    expect(body).toContain('await sharedFoldersEnabled()')
  })
})

describe('L7d: legacy is refused when ANY ancestor is in the set, not only the root the walk found', () => {
  // The server answers "no custody" for SUB and offers an active invite ON SUB,
  // so the root walk stops at SUB. ROOT, above it, was seen with custody.
  async function subInvite() {
    return [{ id: 'sub-inv', is_folder_share: true, file_id: SUB, status: 'approved', created_at: '2026-10-01T00:00:00Z',
      encrypted_owner_folder_key: b64(await share.legacyInviteOwnerWrap(MASTER, SUB, LEGACY_KEY)) }]
  }

  test('control: with nothing seen above it, SUB is a legacy invite-only folder as before', async () => {
    sentInvites = await subInvite()
    expect(await adoption.folderWrapFormat(SUB)).toBe('legacy_invite')
  })

  test('the format oracle for SUB refuses', async () => {
    markCustodySeen(ROOT)
    sentInvites = await subInvite()
    await expect(adoption.folderWrapFormat(SUB)).rejects.toThrow("This folder's keys are unavailable")
  })

  test('an owner upload into SUB throws instead of skipping its publish (flag on)', async () => {
    markCustodySeen(ROOT)
    sentInvites = await subInvite()
    await expect(publishOwnerUploadKey(MASTER, SUB, FILE_ID, CHILD_KEY)).rejects.toThrow("This folder's keys are unavailable")
    expect(published).toEqual([])
  })

  test('an invite of SUB, or its approval, refuses (custodyFolderKey)', async () => {
    markCustodySeen(ROOT)
    await expect(share.custodyFolderKey(MASTER, SUB)).rejects.toThrow("This folder's keys are unavailable")
  })

  test('the member page for SUB, browsing inside it, refuses', async () => {
    markCustodySeen(ROOT)
    await expect(share.memberFolderCustody(SUB, FILE_ID)).rejects.toThrow("This folder's keys are unavailable")
    // ...and with nothing seen it is the legacy answer as before.
    resetCustodyMemoryForTests()
    expect(await share.memberFolderCustody(SUB, FILE_ID)).toEqual({ shared: null, flagOn: true })
  })
})

describe('rv-web198e P3: on a write, a failed flag read aborts; it is never "off"', () => {
  // Two failed reads (the invite's custody-first check, then buildFolderInvite's
  // custody read) used to turn a flag-on custody-folder invite into a legacy one.
  test('a folder invite build aborts: no payload, so no legacy invite', async () => {
    flagReadFails = true
    await expect(share.buildFolderInvite(MASTER, ROOT)).rejects.toThrow("Couldn't check this account's sharing settings")
    expect(custodyCalls).toBe(0)
  })

  test("an approval's custody read aborts the same way", async () => {
    flagReadFails = true
    await expect(share.custodyFolderKey(MASTER, ROOT)).rejects.toThrow("Couldn't check this account's sharing settings")
  })

  test('an owner upload or move publish aborts instead of skipping', async () => {
    flagReadFails = true
    await expect(publishOwnerUploadKey(MASTER, ROOT, FILE_ID, CHILD_KEY)).rejects.toThrow("Couldn't check this account's sharing settings")
    await expect(moveOwnerItems({ ids: [FILE_ID], destinationId: ROOT, rows: [{ id: FILE_ID }], masterKey: MASTER, viewerId: null }))
      .rejects.toThrow(MOVED_BUT_UNPUBLISHED)
    expect(published).toEqual([])
  })

  test('control: a real "off" answer is still off for writes (nothing asked, legacy invite build as on main)', async () => {
    flagOn = false
    expect(await share.custodyFolderKey(MASTER, ROOT)).toBeNull()
    await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, CHILD_KEY)
    expect(custodyCalls).toBe(0)
  })

  test("the invite form asks the write read before it decides custody-first (share-dialog)", async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(import.meta.dir, '..', 'src/components/share-dialog.tsx'), 'utf8')
    const body = text.slice(text.indexOf('const handleInvite'), text.indexOf('ensureOwnerFolderKey(fileId'))
    expect(body).toContain('await sharedFoldersEnabledForWrite()')
    expect(body).not.toContain('await sharedFoldersEnabled()')
  })
})
