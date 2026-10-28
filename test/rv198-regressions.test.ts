/**
 * Regression tests adopted from the rv-web198c review probe
 * (~/code/bb-gate-logs/fullspeed/rv-web198c-findings.md). The probe asserted
 * the bugs; these assert the fixes.
 *
 *  P1-1  a custody folder never reaches the legacy reader on a 5xx / 429 /
 *        offline answer: the error surfaces, nothing opens;
 *  P1-2  custody is never seeded from a legacy invite owner copy (the folder's
 *        own name blob passed as one would otherwise become the folder key);
 *  P1-3  a folder with active flag-off invites is not given custody (its
 *        existing children would become unreadable): a plain refusal;
 *  P2-1  with the flag OFF an owner upload or folder create makes 0 custody
 *        requests and cannot fail after commit because of one.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { legacyOwnerCopy, ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FILE_KEY = new Uint8Array(32).fill(0x11)

let custodyStatus: number | 'record' | 'offline' = 404
let custodyCalls = 0
let sentInvites: unknown[] = []
let flagOn = true
const registered: string[] = []

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => flagOn,
  sharedFoldersEnabledForWrite: async () => flagOn,
}))
const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, encoder.encode(id)),
}))
await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  getSharedFolder: async (folderId: string) => {
    custodyCalls += 1
    if (custodyStatus === 'offline') throw new TypeError('Failed to fetch')
    if (custodyStatus !== 'record') {
      const E = r.ApiError as unknown as new (m: string, s: number) => Error
      throw new E(`status ${custodyStatus}`, custodyStatus)
    }
    return {
      folder_id: folderId, role: 'owner', access_level: 'edit', key_version: 1,
      owner_wrapped_folder_key: real.toBase64(wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => ({ id, parent_id: id === ROOT ? null : ROOT }),
  getSentInvites: async () => sentInvites,
  publishSharedFolderKeys: async () => ({ written: 1, skipped: 0 }),
  createFolder: async (_name: string, parentId?: string, folderId?: string) => ({ id: folderId, parent_id: parentId ?? null, is_folder: true }),
  registerSharedFolderKey: async (_f: string, body: { owner_wrapped_folder_key: string }) => {
    registered.push(body.owner_wrapped_folder_key)
    return { created: true, key_version: 1 }
  },
}))

const share = await import('../src/lib/folder-share-crypto')
const adoption = await import('../src/lib/owner-adoption')
const { publishOwnerUploadKey, createOwnerFolder } = await import('../src/lib/owner-upload-key')
const { ensureOwnerFolderKey, FOLDER_NEEDS_UPGRADE } = await import('../src/lib/folder-link-create')
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')
const { forgetFeatureFlags } = await import('../src/lib/use-feature-flag')

async function legacyInvite(status = 'approved') {
  const legacyOwner = real.toBase64(legacyOwnerCopy(MASTER, ROOT, FOLDER_KEY))
  return [{ id: 'inv', is_folder_share: true, file_id: ROOT, status, created_at: '2026-10-01T00:00:00Z', encrypted_owner_folder_key: legacyOwner }]
}

beforeEach(() => {
  adoption.clearSharedFolderLookups()
  resetCustodyMemoryForTests()
  forgetFeatureFlags()
  flagOn = true
  custodyCalls = 0
  sentInvites = []
  registered.length = 0
})

describe('P1-1: a non-definitive custody answer is an error, never "no custody"', () => {
  for (const status of [500, 503, 429, 'offline'] as const) {
    test(`custody ${status}: rootKeyAndFormat throws and a planted unbound wrap opens for nobody`, async () => {
      custodyStatus = status
      sentInvites = await legacyInvite()
      await expect(adoption.rootKeyAndFormat(MASTER, ROOT)).rejects.toThrow()
      const legacyWrap = await share.legacyInviteChildWrap(FOLDER_KEY, FILE_KEY)
      const opened = await adoption
        .resolveSharedFileKey({
          masterKey: MASTER,
          folderId: ROOT,
          file: { id: FILE_ID, parent_id: ROOT, acted_via_share_id: 's' },
          keyIndexPromise: Promise.resolve(new Map([[FILE_ID, legacyWrap]])),
        })
        .catch(() => null)
      expect(opened).toBeNull()
      await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow()
      await expect(adoption.sharedRootFor(ROOT, FILE_ID)).rejects.toThrow()
    })
  }

  test('a definitive "no record" (404) is still the legacy answer for a folder never seen with custody', async () => {
    custodyStatus = 404
    sentInvites = await legacyInvite()
    expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
    // rv-web198d R1: but the owner has no legacy read (task 2255 brings a
    // verified one), so there is no owner-side key for it.
    expect(await adoption.rootKeyAndFormat(MASTER, ROOT)).toBeNull()
  })
})

describe('P1-2 / P1-3: custody is never seeded from a legacy invite copy', () => {
  test('the folder NAME blob forged as an invite owner copy never becomes the custody key', async () => {
    custodyStatus = 404
    const nameKey = wasm.derive_file_key(MASTER, encoder.encode(ROOT)) as Uint8Array
    const nameBlob = wasm.encrypt_metadata(nameKey, JSON.stringify({ name: 'Docs', mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const forged = real.toBase64(new Uint8Array([...nameBlob.nonce, ...nameBlob.ciphertext]))
    sentInvites = [{ id: 'fake', is_folder_share: true, file_id: ROOT, status: 'invited', created_at: '2026-10-28T00:00:00Z', encrypted_owner_folder_key: forged }]
    await expect(ensureOwnerFolderKey(ROOT, MASTER)).rejects.toThrow(FOLDER_NEEDS_UPGRADE)
    expect(registered).toHaveLength(0)
  })

  test('a folder with an active flag-off invite is refused with the typed upgrade error; nothing registered', async () => {
    custodyStatus = 404
    sentInvites = await legacyInvite()
    const { FolderNeedsUpgradeError } = await import('../src/lib/folder-upgrade')
    const err = await ensureOwnerFolderKey(ROOT, MASTER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FolderNeedsUpgradeError)
    expect((err as Error).message).toBe(FOLDER_NEEDS_UPGRADE)
    expect(registered).toHaveLength(0)
  })

  test('with no custody and no active invite, a fresh RANDOM key is minted and registered (never the legacy copy)', async () => {
    custodyStatus = 404
    sentInvites = await legacyInvite('denied') // an inactive invite never counts
    const key = await ensureOwnerFolderKey(ROOT, MASTER)
    expect(registered).toHaveLength(1)
    expect(Array.from(key)).not.toEqual(Array.from(FOLDER_KEY))
    const custodyKey = wasm.unwrapFolderCustody(MASTER, ROOT, real.fromBase64(registered[0])) as Uint8Array
    expect(Array.from(custodyKey)).toEqual(Array.from(key))
  })
})

describe('P2-1: with the flag OFF, owner uploads and folder creates never ask for custody', () => {
  test('5 uploads and a folder create into an invite-only folder: 0 custody requests, no throw', async () => {
    flagOn = false
    custodyStatus = 500 // even a failing custody route cannot fail the committed upload
    sentInvites = await legacyInvite()
    for (let i = 0; i < 5; i++) await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, FILE_KEY)
    await createOwnerFolder({ nameEncrypted: '{}', parentId: ROOT, folderId: FILE_ID, nameKey: FILE_KEY, masterKey: MASTER })
    expect(custodyCalls).toBe(0)
  })

  test('with the flag OFF the wrap oracle answers legacy without a request, and caches nothing it did not ask', async () => {
    flagOn = false
    custodyStatus = 'record'
    expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
    expect(await share.custodyFolderKey(MASTER, ROOT)).toBeNull()
    expect(custodyCalls).toBe(0)
  })

  test('with the flag ON a definitive legacy answer is cached: 5 publishes make 1 custody request', async () => {
    custodyStatus = 404
    sentInvites = await legacyInvite()
    for (let i = 0; i < 5; i++) await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, FILE_KEY)
    expect(custodyCalls).toBe(1)
  })
})
