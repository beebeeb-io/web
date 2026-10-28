/**
 * Decision L7b — a folder's wrap format follows its custody record.
 *
 * With custody: strictly L7, no fallback. Without custody (a flag-off
 * invite-only share): the legacy format, only through the named functions
 * legacyInviteChildWrap / legacyInviteChildKey (and the legacy owner copy),
 * used only by the flag-off path. These tests prove:
 *   1. the format oracle answers from the custody record and NEVER guesses
 *      (a failure that is not "no record" throws);
 *   2. every custody-folder path (owner open, owner upload publish, member
 *      read and write, member upload, invite build) seals and opens L7 only,
 *      and a legacy wrap planted on a custody folder's row is refused;
 *   3. statically, the legacy names are referenced only where L7b allows.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

// shared_folders_v1 ON for this file (the paths under test are flag-on ones).
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, { sharedFoldersEnabled: async () => true })


const wasm = loadWasm()
const encoder = new TextEncoder()

const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FILE_KEY = new Uint8Array(32).fill(0x11)

type CustodyAnswer = { kind: 'record'; wrapped: string } | { kind: 'status'; status: number }
let custodyAnswer: CustodyAnswer = { kind: 'status', status: 404 }
const published: Array<{ folderId: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (masterKey: Uint8Array, fileId: string) => wasm.derive_file_key(masterKey, encoder.encode(fileId)),
}))

let sentInvites: unknown[] = []

const apiReal = await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  getSharedFolder: async (folderId: string) => {
    if (custodyAnswer.kind === 'status') {
      // The real client throws ApiError; keep its class so instanceof holds.
      const ErrorClass = r.ApiError as unknown as new (message: string, status: number) => Error
      throw new ErrorClass(`status ${custodyAnswer.status}`, custodyAnswer.status)
    }
    return {
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: custodyAnswer.wrapped,
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => ({ id, parent_id: id === ROOT ? null : ROOT }),
  getSentInvites: async () => sentInvites,
  publishSharedFolderKeys: async (folderId: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    published.push({ folderId, keys })
    return { published: keys.length }
  },
}))
void apiReal

const share = await import('../src/lib/folder-share-crypto')
const { clearCustodyMemory } = await import('../src/lib/custody-memory')
const adoption = await import('../src/lib/owner-adoption')
const { publishOwnerUploadKey } = await import('../src/lib/owner-upload-key')

function custodyRecord(): CustodyAnswer {
  const wrapped = wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array
  return { kind: 'record', wrapped: real.toBase64(wrapped) as string }
}

async function legacyWrapOfFileKey(): Promise<string> {
  return share.legacyInviteChildWrap(FOLDER_KEY, FILE_KEY)
}

function reset(answer: CustodyAnswer) {
  clearCustodyMemory()
  custodyAnswer = answer
  published.length = 0
  sentInvites = []
  adoption.clearSharedFolderLookups()
}

describe('L7b: the format oracle reads the custody record and never guesses', () => {
  test('a record is l7; 404, 405 and 501 (flag off) are legacy; any other failure throws', async () => {
    reset(custodyRecord())
    expect(await adoption.folderWrapFormat(ROOT)).toBe('l7')
    for (const status of [404, 405, 501]) {
      reset({ kind: 'status', status })
      expect(await adoption.folderWrapFormat(ROOT)).toBe('legacy_invite')
    }
    for (const status of [500, 502, 429, 403]) {
      reset({ kind: 'status', status })
      await expect(adoption.folderWrapFormat(ROOT)).rejects.toThrow()
    }
  })

  test('noCustodyRecord is exactly 404, 405 and 501', () => {
    for (const status of [404, 405, 501]) expect(share.noCustodyRecord({ status })).toBe(true)
    for (const status of [400, 401, 403, 409, 429, 500, 502, 503]) expect(share.noCustodyRecord({ status })).toBe(false)
    expect(share.noCustodyRecord(new Error('offline'))).toBe(false)
  })
})

describe('L7b: a custody folder is strictly L7 on every path', () => {
  test('owner open: an L7 wrap opens; a legacy wrap planted on the row is refused', async () => {
    reset(custodyRecord())
    const file = { id: FILE_ID, parent_id: ROOT, acted_via_share_id: 'share' }
    const l7 = await share.sealChildKey(FOLDER_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, FILE_KEY)
    const opened = await adoption.resolveSharedFileKey({
      masterKey: MASTER,
      folderId: ROOT,
      file,
      keyIndexPromise: Promise.resolve(new Map([[FILE_ID, l7]])),
    })
    expect(Array.from(opened ?? [])).toEqual(Array.from(FILE_KEY))

    const planted = await adoption.resolveSharedFileKey({
      masterKey: MASTER,
      folderId: ROOT,
      file,
      keyIndexPromise: Promise.resolve(new Map([[FILE_ID, await legacyWrapOfFileKey()]])),
    })
    expect(planted).toBeNull()
  })

  test('owner upload: the published wrap is L7 for (root, file, file) and not a legacy seal', async () => {
    reset(custodyRecord())
    await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, FILE_KEY)
    expect(published).toHaveLength(1)
    const wrap = published[0].keys[0].encrypted_file_key
    const opened = await share.openChildKey(FOLDER_KEY, { rootId: ROOT, itemId: FILE_ID, isFolder: false }, wrap)
    expect(Array.from(opened)).toEqual(Array.from(FILE_KEY))
    await expect(share.legacyInviteChildKey(FOLDER_KEY, wrap)).rejects.toThrow()
  })

  test('owner upload into a folder WITHOUT custody publishes nothing (no legacy write here)', async () => {
    reset({ kind: 'status', status: 501 })
    // A flag-off invite-only share: the root is found through its invite.
    sentInvites = [{ id: 'inv', is_folder_share: true, file_id: ROOT, status: 'approved', created_at: '2026-10-01T00:00:00Z' }]
    await publishOwnerUploadKey(MASTER, ROOT, FILE_ID, FILE_KEY)
    expect(published).toHaveLength(0)
  })

  test('member read and write dispatch: l7 refuses a legacy wrap; legacy_invite opens only legacy', async () => {
    const ref = { rootId: ROOT, itemId: FILE_ID, isFolder: false }
    const legacy = await legacyWrapOfFileKey()
    const l7 = await share.sealFolderChild('l7', FOLDER_KEY, ref, FILE_KEY)
    await expect(share.openFolderChild('l7', FOLDER_KEY, ref, legacy)).rejects.toThrow()
    expect(Array.from(await share.openFolderChild('l7', FOLDER_KEY, ref, l7))).toEqual(Array.from(FILE_KEY))
    // The legacy reader cannot open an L7 wrap either: a server that hid a
    // custody record to force the legacy path gains nothing on L7 rows.
    await expect(share.openFolderChild('legacy_invite', FOLDER_KEY, ref, l7)).rejects.toThrow()
    expect(Array.from(await share.openFolderChild('legacy_invite', FOLDER_KEY, ref, legacy))).toEqual(Array.from(FILE_KEY))
  })

  test('invite build on a custody folder: L7 children, the root name-key wrap, and no legacy owner copy', async () => {
    let legacyOwnerCalls = 0
    const custody = custodyRecord() as { kind: 'record'; wrapped: string }
    const { payload, folderKey } = await share.buildFolderInvite(MASTER, ROOT, undefined, {
      custodyFolderKey: async () => ({ folderKey: new Uint8Array(FOLDER_KEY), encryptedOwnerFolderKeyB64: custody.wrapped }),
      findExistingFolderKey: async () => {
        throw new Error('a custody folder must not read the legacy invite copy')
      },
      generateFolderKey: async () => {
        throw new Error('a custody folder must not mint')
      },
      encryptAllChildrenKeys: async (masterKey, key, folderId, format) => {
        expect(format).toBe('l7')
        return [{ file_id: FILE_ID, encrypted_file_key: await share.sealFolderChild(format, key, { rootId: folderId, itemId: FILE_ID, isFolder: false }, FILE_KEY) }]
      },
      legacyInviteOwnerWrap: async () => {
        legacyOwnerCalls += 1
        return new Uint8Array(60)
      },
      deriveFileKey: async (masterKey, id) => wasm.derive_file_key(masterKey, encoder.encode(id)),
      sealChildKey: share.sealChildKey,
      folderKeyId: async () => 'id',
    })
    folderKey.fill(0)
    expect(legacyOwnerCalls).toBe(0)
    expect(payload.encrypted_owner_folder_key).toBe(custody.wrapped)
    const root = payload.folder_keys.find((k) => k.file_id === ROOT)
    expect(root).toBeDefined()
    const rootNameKey = await share.openChildKey(FOLDER_KEY, { rootId: ROOT, itemId: ROOT, isFolder: true }, root!.encrypted_file_key)
    expect(Array.from(rootNameKey)).toEqual(Array.from(wasm.derive_file_key(MASTER, encoder.encode(ROOT)) as Uint8Array))
    const child = payload.folder_keys.find((k) => k.file_id === FILE_ID)!
    await expect(share.legacyInviteChildKey(FOLDER_KEY, child.encrypted_file_key)).rejects.toThrow()
  })

  test('invite build on a folder WITHOUT custody stays legacy (the flag-off path)', async () => {
    let format: string | null = null
    const { folderKey } = await share.buildFolderInvite(MASTER, ROOT, undefined, {
      custodyFolderKey: async () => null,
      findExistingFolderKey: async () => null,
      generateFolderKey: async () => new Uint8Array(FOLDER_KEY),
      encryptAllChildrenKeys: async (_m, _k, _f, f) => {
        format = f
        return []
      },
      legacyInviteOwnerWrap: async () => new Uint8Array(60),
      deriveFileKey: async () => {
        throw new Error('the legacy path publishes no root name-key wrap')
      },
      sealChildKey: async () => {
        throw new Error('the legacy path seals no L7 wrap')
      },
      folderKeyId: async () => 'id',
    })
    folderKey.fill(0)
    expect(format).toBe('legacy_invite')
  })
})

describe('L7b: the legacy names are referenced only where it allows', () => {
  // Where each legacy name may appear in src/ (definitions, the format
  // dispatcher, the flag-off invite build, and the approval of a folder that
  // has no custody record).
  const ALLOWED: Record<string, string[]> = {
    legacyInviteChildWrap: ['src/lib/folder-share-crypto.ts'],
    legacyInviteChildKey: ['src/lib/folder-share-crypto.ts'],
    legacyInviteOwnerWrap: ['src/lib/folder-share-crypto.ts'],
    legacyInviteOwnerKey: ['src/lib/folder-share-crypto.ts', 'src/lib/approve-invite-crypto.ts'],
  }

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  test('no other module names a legacy function', () => {
    const root = join(import.meta.dir, '..')
    const offenders: string[] = []
    for (const file of sources(join(root, 'src'))) {
      const relative = file.slice(root.length + 1)
      const text = readFileSync(file, 'utf8')
      for (const [name, allowed] of Object.entries(ALLOWED)) {
        if (text.includes(name) && !allowed.includes(relative)) offenders.push(`${relative}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
