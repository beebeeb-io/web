/**
 * SF-0001 / contract 2275 L13 — the owner writes on web only under an id the
 * client chose.
 *
 * Every create proposes its own id, and every answer that names an item (init,
 * create, completion) is compared with that id before anything is sealed,
 * renamed, published or used as a destination. A substituted id aborts with
 * `ServerChangedItemIdError` — including a server dedup/replace-by-name answer,
 * which is never applied silently. A persisted session is resumed only when
 * this client minted its id; a legacy record is abandoned and restarted under
 * a fresh own id.
 *
 * Rows A7 (per site), A7c (persisted sessions) and A8 (folder create, with and
 * without a parent) from the design's §7 table.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures, resetEchoes } from './helpers/upload-share-mocks'

await installMocks()
// owner-adoption is the shared-root reader the publish path asks (real WASM in
// a worker; the straight mirror is enough to say "not a shared root" here).
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } = await import('../src/lib/item-id-echo')
const { encryptedUpload } = await import('../src/lib/encrypted-upload')
const { createOwnerFolder } = await import('../src/lib/owner-upload-key')

const MK = new Uint8Array([9])
const FILE_KEY = new Uint8Array([1])

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (e: unknown) => e)
}

function expectSubstitutionAbort(err: unknown) {
  expect(err).toBeInstanceOf(ServerChangedItemIdError)
  expect((err as ServerChangedItemIdError).code).toBe('server_changed_item_id')
  expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
}

/**
 * Nothing was PUT, recorded, renamed, published or moved. (The name blob is
 * sealed before init, always with the CLIENT's key for the CLIENT's id, and is
 * never written under the answer.)
 */
function expectNothingWritten() {
  expect(cap.uploadedChunks).toEqual([])
  expect(cap.savedStates).toEqual([])
  expect(cap.updatedFiles).toEqual([])
  expect(cap.movedItems).toEqual([])
  expect(cap.ownerKeys).toEqual([])
  expect(cap.addFolderKeysCalls).toEqual([])
}

beforeEach(() => {
  resetCaptures()
  resetEchoes()
})

// ── A7: every owner create/write site ────────────────────────────────────────

/**
 * The sites that funnel through `encryptedUpload`, each with the exact call
 * shape it uses today (file:line in `site`). Every one proposes a client id;
 * each must abort when init answers another.
 */
const UPLOAD_SITES: Array<{
  site: string
  run: (id: string) => Promise<unknown>
}> = [
  {
    site: 'drive.tsx:1514 doEncryptedUpload (create / replace)',
    run: (id) => encryptedUpload(new File(['a'], 'a.txt'), id, FILE_KEY, MK, 'parent-1', () => {},
      undefined, undefined, undefined, { conflictCreated: false }),
  },
  {
    site: 'drive.tsx:1796 folder upload (file inside the new folder)',
    run: (id) => encryptedUpload(new File(['b'], 'b.txt'), id, FILE_KEY, MK, 'new-folder', () => {},
      undefined, undefined, undefined),
  },
  {
    site: 'drive.tsx:1973 new document',
    run: (id) => encryptedUpload(new File(['c'], 'c.md'), id, FILE_KEY, MK, null, undefined,
      undefined, undefined, undefined),
  },
  {
    site: 'settings/import.tsx:1012 import worker',
    run: (id) => encryptedUpload(new File(['d'], 'd.txt'), id, FILE_KEY, MK, 'parent-1', () => {},
      undefined, undefined, undefined),
  },
  {
    site: 'receive.tsx:278 save to vault',
    run: (id) => encryptedUpload(new File(['e'], 'e.txt'), id, FILE_KEY, MK, undefined, undefined,
      undefined, undefined),
  },
  {
    site: 'shared.tsx:383 save a copy',
    run: (id) => encryptedUpload(new File(['f'], 'f.txt'), id, FILE_KEY, MK, undefined, () => {},
      undefined, undefined),
  },
  {
    site: 'photos.tsx:352 photo upload',
    run: (id) => encryptedUpload(new File(['g'], 'g.png'), id, FILE_KEY, MK, 'parent-1', () => {},
      undefined, undefined, undefined),
  },
  {
    site: 'scan.tsx:315 scan save',
    run: (id) => encryptedUpload(new File(['h'], 'h.pdf'), id, FILE_KEY, MK, undefined, () => {}),
  },
  {
    site: 'welcome-file-upload.ts:17 welcome file',
    run: (id) => encryptedUpload(new File(['i'], 'i.md'), id, FILE_KEY, MK, undefined, undefined,
      undefined, undefined),
  },
  {
    site: 'file-editor.tsx:215 save as new / keep-both',
    run: (id) => encryptedUpload(new File(['j'], 'j.txt'), id, FILE_KEY, MK, undefined, () => {},
      undefined, undefined, undefined, { conflictCreated: true }),
  },
  {
    site: 'office-editor.tsx:660 new office document',
    run: (id) => encryptedUpload(new File(['k'], 'k.odt'), id, FILE_KEY, MK, undefined, () => {},
      undefined, undefined, undefined, { conflictCreated: false }),
  },
]

describe('A7: a create whose init answers a different id aborts at every upload site', () => {
  for (const site of UPLOAD_SITES) {
    test(site.site, async () => {
      echo.init = () => 'server-chosen-id'
      expectSubstitutionAbort(await caught(() => site.run('client-chosen-id')))
      expectNothingWritten()
    })
  }

  test('encrypted-upload.ts v1 init branch (legacy route) aborts too', async () => {
    echo.protocol = 'v1'
    echo.init = () => 'server-chosen-id'
    expectSubstitutionAbort(await caught(() => UPLOAD_SITES[0].run('client-chosen-id')))
    expect(cap.uploadedChunks).toEqual([])
    expect(cap.savedStates).toEqual([])
    expect(cap.updatedFiles).toEqual([])
  })

  test('a dedup answer to a create is an abort, never a silent replace of the other file', async () => {
    // The server answers the new upload with an EXISTING file's id (its
    // replace-by-name/dedup path). The client must not seal its name or key
    // under it, and must not updateFile that row.
    echo.init = () => 'existing-file-id'
    expectSubstitutionAbort(await caught(() => UPLOAD_SITES[0].run('my-new-id')))
    expectNothingWritten()
  })

  test('a replace keeps targeting the listed row id: init echoing it writes under it', async () => {
    const { encryptedUpload: real } = await import('../src/lib/encrypted-upload')
    const uploaded = await real(new File(['x'], 'x.txt'), 'listed-row-id', FILE_KEY, MK, 'parent-1',
      undefined, undefined, undefined, undefined, { conflictCreated: false })
    expect(uploaded.id).toBe('listed-row-id')
    expect(cap.updatedFiles).toEqual([])
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual(['listed-row-id'])
    expect(cap.removedStates).toEqual(['listed-row-id'])
  })

  test('an ordinary create still works end to end under the client id', async () => {
    const uploaded = await encryptedUpload(new File(['y'], 'y.txt'), 'own-id', FILE_KEY, MK, 'parent-1')
    expect(uploaded.id).toBe('own-id')
    expect(cap.encryptedMetadataKeys).toEqual([1])
    expect(cap.uploadedChunks).toEqual([
      { fileId: 'own-id', index: 0, firstByte: 9, uploadSessionId: 'upload-session-id' },
    ])
  })

  test('member-write.ts:99 never re-derives for a substituted id; the upload counts as failed', async () => {
    const { memberUploadFiles } = await import('../src/lib/member-write')
    echo.init = () => 'server-chosen-id'
    const result = await memberUploadFiles(
      {
        folderId: 'folder-1', inviteId: 'inv-1', folderKey: new Uint8Array(32).fill(7),
        format: 'l7', level: 'add', displayName: 'M', masterKey: new Uint8Array(32).fill(3),
        fileKeys: {},
      },
      null,
      [new File(['z'], 'z.txt')],
      () => {},
    )
    expect(result).toEqual({ added: 0, failed: 1 })
    expectNothingWritten()
  })
})

// ── A8: folders ──────────────────────────────────────────────────────────────

describe('A8: a folder create answered with a different id aborts, with and without a parent', () => {
  test('with a parent (drive handleCreateFolder / folder upload / move-modal): no wrap published, nothing moved in', async () => {
    echo.createFolder = () => 'server-chosen-folder-id'
    expectSubstitutionAbort(await caught(() => createOwnerFolder({
      nameEncrypted: 'sealed-name',
      parentId: 'parent-1',
      folderId: 'my-folder-id',
      nameKey: new Uint8Array([5]),
      masterKey: MK,
    })))
    expect(cap.createdFolders).toEqual([{ nameEncrypted: 'sealed-name', parentId: 'parent-1', folderId: 'my-folder-id' }])
    expect(cap.ownerKeys).toEqual([])
    expect(cap.addFolderKeysCalls).toEqual([])
    expect(cap.movedItems).toEqual([])
  })

  test('without a parent (drive.tsx:2080 accept-suggestion): aborts before the items move into it', async () => {
    const { moveOwnerItems } = await import('../src/lib/owner-upload-key')
    echo.createFolder = () => 'server-chosen-folder-id'
    const run = async () => {
      const result = await createOwnerFolder({ nameEncrypted: 'sealed-name', folderId: 'my-folder-id' })
      // Today drive.tsx moves the selected items into `result.id` right after.
      await moveOwnerItems({ ids: ['item-1', 'item-2'], destinationId: result.id, masterKey: MK })
    }
    expectSubstitutionAbort(await caught(run))
    expect(cap.movedItems).toEqual([])
    expect(cap.updatedFiles).toEqual([])
  })

  test('a normal folder create still works with the client id, publishing under it', async () => {
    const created = await createOwnerFolder({
      nameEncrypted: 'sealed-name',
      parentId: 'parent-1',
      folderId: 'my-folder-id',
      nameKey: new Uint8Array([5]),
      masterKey: MK,
    })
    expect(created.id).toBe('my-folder-id')
    // No custody record in this mock, so the legacy publish path runs; either
    // way nothing is published under any other id.
    expect(cap.ownerKeys.every((k) => JSON.stringify(k.keys).includes('my-folder-id'))).toBe(true)
  })
})

// ── A7c: persisted sessions ──────────────────────────────────────────────────

describe('A7c: a persisted session is resumed only when this client minted its id', () => {
  const legacy = { fileId: 'server-chosen-id' }
  const own = { fileId: 'own-session-id', selfMinted: true as const }

  test('planResume: a record without the marker is abandoned and restarted under a fresh own id', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const plan = planResume(legacy, () => 'fresh-own-id')
    expect(plan).toEqual({ resumeId: 'fresh-own-id', abandonId: 'server-chosen-id' })
  })

  test('planResume: a record with the marker and its own id resumes that id', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    expect(planResume(own, () => 'fresh-own-id')).toEqual({ resumeId: 'own-session-id', abandonId: null })
  })

  test('prepareResume abandons the legacy id server-side (POST …/upload/abandon) and drops its record', async () => {
    const { prepareResume } = await import('../src/lib/resume-under-own-id')
    const plan = await prepareResume(legacy, () => 'fresh-own-id')
    expect(plan).toMatchObject({ resumeId: 'fresh-own-id', abandonId: 'server-chosen-id', restarted: true })
    expect(cap.abandons).toEqual(['server-chosen-id'])
    expect(cap.removedStates).toEqual(['server-chosen-id'])
  })

  test('prepareResume resumes a self-minted record without abandoning anything', async () => {
    const { prepareResume } = await import('../src/lib/resume-under-own-id')
    const plan = await prepareResume(own, () => 'fresh-own-id')
    expect(plan).toMatchObject({ resumeId: 'own-session-id', abandonId: null, restarted: false })
    expect(cap.abandons).toEqual([])
    expect(cap.removedStates).toEqual([])
  })

  test('the restarted upload writes under the fresh id and resumes its own session next time', async () => {
    const { prepareResume } = await import('../src/lib/resume-under-own-id')
    const plan = await prepareResume(legacy, () => 'fresh-own-id')
    const uploaded = await encryptedUpload(new File(['r'], 'r.txt'), plan.resumeId, FILE_KEY, MK)
    expect(uploaded.id).toBe('fresh-own-id')
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual(['fresh-own-id'])
    // The new record carries the marker, so the next resume keeps this id.
    expect(cap.savedStates.every((s) => (s as { selfMinted?: boolean }).selfMinted === true)).toBe(true)
    expect(cap.abandons).toEqual(['server-chosen-id'])
  })

  test('a new session always records the selfMinted marker', async () => {
    await encryptedUpload(new File(['s'], 's.txt'), 'own-id', FILE_KEY, MK)
    expect(cap.savedStates.length).toBeGreaterThan(0)
    for (const state of cap.savedStates) {
      expect(state).toMatchObject({ fileId: 'own-id', selfMinted: true })
    }
  })
})
