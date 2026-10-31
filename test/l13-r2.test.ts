/**
 * SF-0001 / contract 2275 L13, round 2 on web#206 — the rows the review found
 * still open after round 1.
 *
 * E1  the import mints its own folder ids (per folder, per run) and a failed
 *     create stops that subtree instead of falling back to a guessed id.
 * E2  a legacy REPLACE session restarts as a new version of THAT row (same id,
 *     same recorded pin), never as a new file under a fresh id.
 * E3  `uploadFile` itself never adopts a stored session this client did not
 *     mark as its own; `planResume` is the one rule (Drive + uploadFile).
 * E4  a stored session found by fingerprint is never abandoned file-wide (the
 *     only abandon the server offers ends whatever upload the row holds now).
 * E5  mismatch cleanup: an init mismatch abandons the id this client
 *     REQUESTED for a create (never the echoed one); a completion mismatch
 *     keeps the resume record and says the file may already be there. (The
 *     checks themselves live in api.ts: l13-api-echo-wire.test.ts.)
 * E6  a folder name never crosses the wire in plaintext: with the vault
 *     locked, Drive's New folder and the move dialog's new folder send nothing.
 * E7  the move dialog shows a failed folder create (the changed-id message
 *     included) as the other create paths do, instead of only logging it.
 *
 * Round 3:
 * R3-1 a version restart sends its row's OWN stored name (byte for byte) and
 *      reads the pin from it; if the row is gone, trashed or does not
 *      authenticate, nothing is uploaded.
 * R3-2 (narrowed by R4-2, see below).
 * R3-3 a transient folder-create failure is not cached for the run: the next
 *      attempt creates it under the SAME minted id (createOwnerFolder's own
 *      same-id retry is in owner-folder-create.test.ts).
 *
 * Round 4:
 * R4-1 (reverts R3-4) an import never reuses an existing folder: a same-named
 *      one may be shared, and imported files would land where recipients see
 *      them. Every import folder is a new private one under a minted id.
 * R4-2 (narrows R3-2) an unmarked record without a pin naming its own id
 *      restarts as a NEW file under a fresh id, never as a version of the row
 *      its id names (that id may be the server's, or a row the user can write
 *      but does not own). Only an own-pin replace record restarts as a version.
 * R4-4 only a real authentication failure makes a row "unverified"; a crypto
 *      worker error propagates, and the paused upload's record is kept.
 * R4-5 when the row check cannot answer (401 / 403 / 410, no connection, a
 *      worker error), the Drive banner says so honestly and keeps the record
 *      on the paused banner, where Dismiss removes it: no silent loop.
 *
 * Round 5:
 * F2   a folder that committed while every try of one import call failed is
 *      adopted by the next call: same minted id, same sealed name, and the
 *      exact-folder check (owner-folder-create.test.ts) runs on any failure.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures, setListPage } from './helpers/upload-share-mocks'

await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } = await import('../src/lib/item-id-echo')

const { encryptedUpload } = await import('../src/lib/encrypted-upload')

const MK = new Uint8Array([9])
const FILE_KEY = new Uint8Array([1])
/** A canonical lowercase v4 UUID, the only shape a client-minted id may have. */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (e: unknown) => e)
}

function expectSubstitutionAbort(err: unknown) {
  expect(err).toBeInstanceOf(ServerChangedItemIdError)
  expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
}

beforeEach(() => {
  resetCaptures()
})

// ── E1: settings/import.tsx folder creates ───────────────────────────────────

describe('E1: an import creates its folders under ids this run mints', () => {
  async function importOne(
    folders: { ensure(path: string): Promise<string | undefined> },
    parentPath: string,
    name = 'photo.jpg',
  ) {
    const { importFileInto } = await import('../src/lib/import-folders')
    return importFileInto({
      folders,
      parentPath,
      name,
      masterKey: MK,
      download: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      signal: new AbortController().signal,
      onStatus: () => {},
      onBytes: () => {},
    })
  }

  test('two imports of the same path propose different canonical v4 ids; one run reuses its own', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const first = createImportFolderTree(MK)
    const leaf1 = await first.ensure('/Photos/2024')
    // The run-local map: the same path in the same run is the same folder.
    expect(await first.ensure('/Photos/2024')).toBe(leaf1)
    const second = createImportFolderTree(MK)
    const leaf2 = await second.ensure('/Photos/2024')

    const ids = cap.createdFolders.map((f) => f.folderId)
    // Photos + 2024, once per run.
    expect(ids).toHaveLength(4)
    for (const id of ids) expect(id).toMatch(V4)
    expect(new Set(ids).size).toBe(4)
    expect(leaf2).not.toBe(leaf1)
    // Each 2024 hangs under the Photos minted in ITS run.
    expect(cap.createdFolders[1].parentId).toBe(cap.createdFolders[0].folderId)
    expect(cap.createdFolders[3].parentId).toBe(cap.createdFolders[2].folderId)
    // Each name is sealed under the key of the id that folder proposes.
    expect(cap.derivedKeyIds.slice(0, 2)).toEqual(ids.slice(0, 2))
  })

  test('a changed-id answer stops that subtree: the error surfaces and no file inits under it', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const failed: Array<{ path: string; error: unknown }> = []
    const folders = createImportFolderTree(MK, { onFolderFailed: (path, error) => failed.push({ path, error }) })
    echo.createFolder = () => 'server-chosen-folder-id'

    expectSubstitutionAbort(await caught(() => importOne(folders, '/Photos')))
    // A file deeper in the same subtree fails with the same error, without a
    // second create and without a guessed parent id.
    expectSubstitutionAbort(await caught(() => importOne(folders, '/Photos/2024')))
    expect(cap.createdFolders).toHaveLength(1)
    expect(cap.initCalls).toEqual([])
    expect(cap.uploadedChunks).toEqual([])
    // Surfaced once, for the folder that failed (the import shows it).
    expect(failed).toHaveLength(1)
    expect(failed[0].path).toBe('/Photos')
    expectSubstitutionAbort(failed[0].error)
  })

  // Round 3 (R3-3): a TRANSIENT failure no longer stops the subtree (see
  // below); a refusal still does, like the changed-id abort.
  test('a refused create (403) stops the subtree the same way; other folders still import', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const { ApiError } = await import('../src/lib/api')
    const folders = createImportFolderTree(MK)
    echo.createFolder = (requested) => {
      if (cap.createdFolders.length === 1) throw new ApiError('Not allowed here.', 403)
      return requested ?? ''
    }

    expect(await caught(() => importOne(folders, '/Photos'))).toMatchObject({ status: 403 })
    expect(await caught(() => importOne(folders, '/Photos/2024'))).toMatchObject({ status: 403 })
    expect(cap.initCalls).toEqual([])

    // An unrelated folder of the same run is unaffected and gets its own id.
    await importOne(folders, '/Docs', 'a.pdf')
    expect(cap.createdFolders).toHaveLength(2)
    const docs = cap.createdFolders[1].folderId!
    expect(docs).toMatch(V4)
    expect(cap.initCalls).toHaveLength(1)
    expect((cap.initCalls[0] as { parent_id: string }).parent_id).toBe(docs)
  })
})

// ── E4: no file-wide abandon from a fingerprint match ────────────────────────

describe('E4: a stored session found by fingerprint is never abandoned file-wide', () => {
  /** A record an older client wrote (no marker) for ANOTHER row, same content. */
  const legacyOtherRow = {
    fingerprint: 'fingerprint', fileId: 'other-row-id', fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'other-session', object_version_id: 'ov-other', chunk_size_bytes: 4, chunk_count: 1,
    parentId: null, createdAt: 1,
  }

  test('a matching legacy record for another row makes no abandon call; only its local record goes', async () => {
    echo.stored = legacyOtherRow
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'own-id', FILE_KEY, MK)
    expect(uploaded.id).toBe('own-id')
    expect(cap.abandons).toEqual([])
    expect(cap.removedStates).toContain('other-row-id')
    expect(cap.initCalls.map((c) => (c as { file_id: string }).file_id)).toEqual(['own-id'])
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['upload-session-id'])
  })

  test('a legacy record for the SAME row, restarted by uploadFile, makes no abandon call either', async () => {
    echo.stored = { ...legacyOtherRow, fileId: 'legacy-row-id' }
    await encryptedUpload(new File(['a'], 'a.txt'), 'legacy-row-id', FILE_KEY, MK, undefined, undefined, 'legacy-row-id')
    expect(cap.abandons).toEqual([])
  })
})

// ── E3: the rule lives in uploadFile ─────────────────────────────────────────

describe('E3: uploadFile never adopts a stored session this client did not mark as its own', () => {
  /** A create session an older client wrote: no marker, so its id may be the server's. */
  const legacyCreate = (fileId: string) => ({
    fingerprint: 'fingerprint', fileId, fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'legacy-session', object_version_id: 'ov-legacy', chunk_size_bytes: 4, chunk_count: 1,
    chunk_format: 1, parentId: null, createdAt: 1,
  })
  const initIds = () => cap.initCalls.map((c) => (c as { file_id: string }).file_id)
  const initName = (i: number) => JSON.parse((cap.initCalls[i] as { name_encrypted: string }).name_encrypted)

  function expectRestartedUnderOwnId(uploadedId: string) {
    const [fresh, ...more] = initIds()
    expect(more).toEqual([])
    expect(fresh).toMatch(V4)
    expect(fresh).not.toBe('legacy-id')
    expect(uploadedId).toBe(fresh)
    // Never into the stored session, never under the stored id.
    expect(cap.uploadedChunks).toEqual([{ fileId: fresh, index: 0, firstByte: 9, uploadSessionId: 'upload-session-id' }])
    // Its own key, derived for its own id, sealed the name the init sent.
    expect(cap.derivedKeyIds).toEqual([fresh])
    expect(initName(0).nonce).toEqual([0xd0])
    // The legacy record goes locally; nothing is abandoned server-side.
    expect(cap.removedStates).toContain('legacy-id')
    expect(cap.abandons).toEqual([])
    for (const state of cap.savedStates) expect(state).toMatchObject({ fileId: fresh, selfMinted: true })
  }

  test('a resumeFileId matching an unmarked create record does a fresh init under a fresh own id', async () => {
    echo.stored = legacyCreate('legacy-id')
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'legacy-id', FILE_KEY, MK,
      undefined, undefined, 'legacy-id')
    expectRestartedUnderOwnId(uploaded.id)
  })

  test('the same record found by fingerprint alone (no resumeFileId) is not adopted either', async () => {
    echo.stored = legacyCreate('legacy-id')
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'legacy-id', FILE_KEY, MK)
    expectRestartedUnderOwnId(uploaded.id)
  })

  test('a replace of that row as a listed row (replaceOf) gets a fresh session under the row, never the stored one', async () => {
    echo.stored = legacyCreate('legacy-id')
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'legacy-id', FILE_KEY, MK,
      undefined, undefined, undefined, undefined, undefined, { replaceOf: { nameEncrypted: 'listed-name' } })
    expect(uploaded.id).toBe('legacy-id')
    expect(initIds()).toEqual(['legacy-id'])
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['upload-session-id'])
    expect(cap.derivedKeyIds).toEqual([])
    expect(cap.abandons).toEqual([])
  })

  test('a record this client marked still resumes its own session: no init', async () => {
    echo.stored = { ...legacyCreate('own-id'), selfMinted: true }
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'own-id', FILE_KEY, MK,
      undefined, undefined, 'own-id')
    expect(uploaded.id).toBe('own-id')
    expect(initIds()).toEqual([])
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['legacy-session'])
  })

  test('a resume names the id it writes under: any other pairing is refused before anything is sent', async () => {
    echo.stored = { ...legacyCreate('own-id'), selfMinted: true }
    const err = await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'some-other-id', FILE_KEY, MK,
      undefined, undefined, 'own-id'))
    expect(err).toBeInstanceOf(Error)
    expect(cap.initCalls).toEqual([])
    expect(cap.uploadedChunks).toEqual([])
  })
})

// ── E2: legacy replace sessions ──────────────────────────────────────────────

describe('E2: a legacy REPLACE session restarts as a new version of the same row', () => {
  /**
   * A paused version upload an older client wrote: no marker, but its pin
   * names its own id, which only a replace of a listed row (an id this client
   * chose) ever recorded.
   */
  const legacyReplace = {
    fingerprint: 'fingerprint', fileId: 'listed-row-id', fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'legacy-session', object_version_id: 'ov-legacy', chunk_size_bytes: 4, chunk_count: 1,
    chunk_format: 1, replace_pin: 0, replace_pin_file_id: 'listed-row-id', parentId: 'parent-1', createdAt: 1,
  }
  const initIds = () => cap.initCalls.map((c) => (c as { file_id: string }).file_id)

  test('planResume: restart as a version of the record\'s own row, resumed by that id', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const plan = await planResume(legacyReplace, {
      mintId: () => 'fresh-own-id',
      lookupRow: async () => ({ state: 'live', nameEncrypted: 'row-own-name' }),
    })
    expect(plan).toMatchObject({ kind: 'restart-version', fileId: 'listed-row-id', resumeFileId: 'listed-row-id' })
  })

  test('the Drive resume path: one init under the row with its recorded pin, in a fresh session; no new file', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const { lookupOwnRow } = await import('../src/lib/stored-row')
    echo.stored = legacyReplace
    echo.rows['listed-row-id'] = { name_encrypted: 'row-own-name' }
    // Exactly what the Drive resume banner passes for this record.
    const plan = await planResume(legacyReplace, {
      mintId: () => crypto.randomUUID(),
      lookupRow: (id) => lookupOwnRow(id, FILE_KEY),
    })
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), plan.fileId, FILE_KEY, MK,
      legacyReplace.parentId, undefined, plan.resumeFileId, undefined, undefined,
      plan.kind === 'restart-version' ? { replaceOf: plan.replaceOf } : undefined)

    expect(uploaded.id).toBe('listed-row-id')
    // One init, under the row: a new version of it, so no second file and no
    // duplicate name next to it.
    expect(initIds()).toEqual(['listed-row-id'])
    // A fresh session: the legacy session's frames are never continued.
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['upload-session-id'])
    // The row's own key (the caller's) and its recorded pin.
    expect(cap.derivedKeyIds).toEqual([])
    expect(cap.appliedPins).toEqual([0])
    expect(cap.savedStates.at(-1)).toMatchObject({
      fileId: 'listed-row-id', selfMinted: true, replace_pin: 0, replace_pin_file_id: 'listed-row-id',
    })
    expect(cap.abandons).toEqual([])
  })

  test('a legacy record whose pin names ANOTHER id is no proof of a replace: it restarts under a fresh id', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const plan = await planResume({ ...legacyReplace, replace_pin_file_id: 'some-other-row' }, {
      mintId: () => 'fresh-own-id',
      lookupRow: async () => ({ state: 'gone' }),
    })
    expect(plan).toEqual({ kind: 'restart-new', fileId: 'fresh-own-id', resumeFileId: undefined })
  })
})

// ── E5: what an upload does after a mismatch ─────────────────────────────────

describe('E5: an upload cleans up after a mismatch only where it is safe', () => {
  test('init mismatch on a create: abandons the id it REQUESTED (only it holds that id), never the echoed one', async () => {
    echo.init = () => 'server-chosen-id'
    expectSubstitutionAbort(await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'client-chosen-id', FILE_KEY, MK)))
    expect(cap.abandons).toEqual(['client-chosen-id'])
    expect(cap.uploadedChunks).toEqual([])
    expect(cap.savedStates).toEqual([])
  })

  test('init mismatch on a replace: nothing is abandoned (the listed row may hold another device\'s live upload)', async () => {
    echo.init = () => 'server-chosen-id'
    expectSubstitutionAbort(await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'listed-row-id', FILE_KEY, MK,
      undefined, undefined, undefined, undefined, undefined, { replaceOf: { nameEncrypted: 'listed-name' } })))
    expect(cap.abandons).toEqual([])
    expect(cap.uploadedChunks).toEqual([])
  })

  test('completion mismatch: the resume record is kept and the error says the file may already be on the server', async () => {
    const { SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE } = await import('../src/lib/item-id-echo')
    const { userFriendlyError } = await import('../src/lib/user-friendly-error')
    echo.complete = () => 'server-chosen-id'
    const err = await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'own-id', FILE_KEY, MK, 'parent-1'))
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
    expect((err as Error).message).toContain('may already be on the server')
    // The chunks went under the own id; its record stays, so the next run of
    // this file resumes that id instead of uploading a second copy.
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual(['own-id'])
    expect(cap.savedStates.at(-1)).toMatchObject({ fileId: 'own-id', selfMinted: true })
    expect(cap.removedStates).toEqual([])
    // Nothing abandoned, nothing published under either id.
    expect(cap.abandons).toEqual([])
    expect(cap.ownerKeys).toEqual([])
    // The toast shows that sentence, not a generic fallback.
    expect(userFriendlyError(err)).toBe(SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
  })
})

// ── E6 / E7: folders named in the UI ─────────────────────────────────────────

const SRC = join(import.meta.dir, '..', 'src')
const source = (relative: string) => readFileSync(join(SRC, relative), 'utf8')
/** The body of `name`'s handler, from its declaration to the next blank-line-separated declaration. */
function handlerBody(text: string, name: string): string {
  const start = text.search(new RegExp(`(async function ${name}\\(|const ${name} = async)`))
  expect(start).toBeGreaterThan(-1)
  return text.slice(start, start + 2500)
}

/** The two UI sites that create a folder from a typed name, with the sealer each uses. */
const NAMED_FOLDER_SITES = [
  { site: 'drive.tsx handleCreateFolder', file: 'pages/drive.tsx', handler: 'handleCreateFolder', seal: 'encryptFileMetadata' },
  { site: 'move-modal.tsx handleNewFolder', file: 'components/move-modal.tsx', handler: 'handleNewFolder', seal: 'encryptFilename' },
] as const

describe('E6: a folder name never crosses the wire in plaintext', () => {
  for (const s of NAMED_FOLDER_SITES) {
    test(`${s.site}: vault locked -> refused with "Unlock your vault to create a folder.", no request`, async () => {
      const { createNamedOwnerFolder } = await import('../src/lib/new-folder')
      const crypto = await import('../src/lib/crypto')
      let keysAsked = 0
      const err = await caught(() => createNamedOwnerFolder({
        name: 'Tax returns 2026',
        parentId: 'parent-1',
        vaultReady: false,
        getFileKey: async () => { keysAsked++; return Uint8Array.of(5) },
        getMasterKey: () => MK,
        seal: crypto[s.seal],
      }))
      expect((err as Error).message).toBe('Unlock your vault to create a folder.')
      expect(cap.createdFolders).toEqual([])
      expect(keysAsked).toBe(0)
    })

    test(`${s.site}: vault open -> the name is sealed under the key of the id it proposes`, async () => {
      const { createNamedOwnerFolder } = await import('../src/lib/new-folder')
      const crypto = await import('../src/lib/crypto')
      const asked: string[] = []
      const created = await createNamedOwnerFolder({
        name: 'Tax returns 2026',
        parentId: 'parent-1',
        vaultReady: true,
        getFileKey: async (id) => { asked.push(id); return Uint8Array.of(5) },
        getMasterKey: () => MK,
        seal: crypto[s.seal],
      })
      expect(cap.createdFolders).toHaveLength(1)
      const sent = cap.createdFolders[0]
      expect(sent.folderId).toMatch(V4)
      expect(created.id).toBe(sent.folderId)
      expect(asked).toEqual([sent.folderId])
      expect(sent.nameEncrypted).not.toContain('Tax returns 2026')
      expect(JSON.parse(sent.nameEncrypted).nonce).toEqual([5])
    })

    test(`${s.site}: the site creates through createNamedOwnerFolder and never starts from the plain name`, () => {
      const body = handlerBody(source(s.file), s.handler)
      expect(body).toContain('createNamedOwnerFolder(')
      expect(body).toContain(`seal: ${s.seal}`)
      expect(body).not.toMatch(/nameEncrypted\s*=\s*name\b/)
    })
  }

  test('no module in src/ seeds a name_encrypted with a plain name', () => {
    const offenders: string[] = []
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const path = join(dir, n)
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(n) ? [path] : []
    })
    for (const file of walk(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/let nameEncrypted\s*=\s*name\b/.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('E7: the move dialog shows a failed folder create', () => {
  test('the changed-id abort gets its own message, as on the other create paths', async () => {
    const { folderCreateFailureToast } = await import('../src/lib/new-folder')
    expect(folderCreateFailureToast(new ServerChangedItemIdError())).toEqual({
      icon: 'folder', title: 'Failed to create folder', description: SERVER_CHANGED_ITEM_ID_MESSAGE, danger: true,
    })
  })

  test('a locked vault says how to fix it', async () => {
    const { folderCreateFailureToast, VaultLockedFolderError } = await import('../src/lib/new-folder')
    expect(folderCreateFailureToast(new VaultLockedFolderError())).toEqual({
      icon: 'lock', title: 'Vault is locked', description: 'Unlock your vault to create a folder.', danger: true,
    })
  })

  test('move-modal.tsx and drive.tsx both show it; the dialog no longer only logs', () => {
    for (const s of NAMED_FOLDER_SITES) {
      const body = handlerBody(source(s.file), s.handler)
      expect(body).toContain('showToast(folderCreateFailureToast(err))')
    }
    expect(handlerBody(source('components/move-modal.tsx'), 'handleNewFolder')).not.toContain('console.error')
  })
})

// ── R3-1: a version restart sends its row's own name, or nothing ─────────────

describe('R3-1: a legacy version restart writes under its row\'s own stored name, or not at all', () => {
  /** A paused version upload an older client wrote; its row is `row-1`. */
  const legacyVersion = {
    fingerprint: 'fingerprint', fileId: 'row-1', fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'legacy-session', object_version_id: 'ov-legacy', chunk_size_bytes: 4, chunk_count: 1,
    chunk_format: 1, replace_pin: 0, replace_pin_file_id: 'row-1', parentId: 'parent-1', createdAt: 1,
  }
  const initIds = () => cap.initCalls.map((c) => (c as { file_id: string }).file_id)
  const initNames = () => cap.initCalls.map((c) => (c as { name_encrypted: string }).name_encrypted)
  const lookup = (state: 'live' | 'gone' | 'unverified') => async () =>
    state === 'live' ? { state, nameEncrypted: 'row-own-name' } as const : { state } as const

  test('planResume: a live row -> restart-version carrying that row\'s own stored name', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    expect(await planResume(legacyVersion, { mintId: () => 'fresh', lookupRow: lookup('live') })).toEqual({
      kind: 'restart-version', fileId: 'row-1', resumeFileId: 'row-1', replaceOf: { nameEncrypted: 'row-own-name' },
    })
  })

  test('planResume: the row is gone or does not authenticate -> refuse, never a fresh id', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    expect(await planResume(legacyVersion, { mintId: () => 'fresh', lookupRow: lookup('gone') }))
      .toEqual({ kind: 'refuse', fileId: 'row-1', resumeFileId: undefined, reason: 'gone' })
    expect(await planResume(legacyVersion, { mintId: () => 'fresh', lookupRow: lookup('unverified') }))
      .toEqual({ kind: 'refuse', fileId: 'row-1', resumeFileId: undefined, reason: 'unverified' })
  })

  test('the Drive banner path, live row: the init sends the row\'s stored name byte for byte and reads the pin from it', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const { lookupOwnRow } = await import('../src/lib/stored-row')
    echo.stored = legacyVersion
    echo.rows['row-1'] = { name_encrypted: 'row-own-name' }
    const plan = await planResume(legacyVersion, { mintId: () => crypto.randomUUID(), lookupRow: (id) => lookupOwnRow(id, FILE_KEY) })
    await encryptedUpload(new File(['a'], 'a.txt'), plan.fileId, FILE_KEY, MK, 'parent-1', undefined,
      plan.resumeFileId, undefined, undefined, plan.kind === 'restart-version' ? { replaceOf: plan.replaceOf } : undefined)
    expect(initIds()).toEqual(['row-1'])
    expect(initNames()).toEqual(['row-own-name'])
    expect(cap.metadataReads).toContain('row-own-name')
    // Nothing freshly sealed: no name without the row's pin can reach the server.
    expect(cap.encryptedMetadataKeys).toEqual([])
  })

  test('uploadFile on its own (no replaceOf), live row: it looks the row up and does the same', async () => {
    echo.stored = legacyVersion
    echo.rows['row-1'] = { name_encrypted: 'row-own-name' }
    await encryptedUpload(new File(['a'], 'a.txt'), 'row-1', FILE_KEY, MK, 'parent-1', undefined, 'row-1')
    expect(cap.rowLookups).toEqual(['row-1'])
    expect(initIds()).toEqual(['row-1'])
    expect(initNames()).toEqual(['row-own-name'])
    // Read for the ownership check and for the pin: only ever the row's own name.
    expect(cap.metadataReads.length).toBeGreaterThan(0)
    expect(cap.metadataReads.every((n) => n === 'row-own-name')).toBe(true)
    expect(cap.encryptedMetadataKeys).toEqual([1])
  })

  for (const [why, row, copy] of [
    ['purged (404)', null, 'gone'],
    ['in the trash', { is_trashed: true }, 'gone'],
    ['a name that does not authenticate under this key', { name_encrypted: 'unreadable-name' }, 'unverified'],
  ] as const) {
    test(`the row is ${why}: refused with honest copy; nothing sent; the record goes`, async () => {
      const { PAUSED_VERSION_GONE_COPY, PAUSED_VERSION_UNVERIFIED_COPY, PausedVersionRefusedError } = await import('../src/lib/upload-resume')
      const { userFriendlyError } = await import('../src/lib/user-friendly-error')
      echo.stored = legacyVersion
      if (row) echo.rows['row-1'] = row
      const err = await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'row-1', FILE_KEY, MK, 'parent-1', undefined, 'row-1'))
      const message = copy === 'gone' ? PAUSED_VERSION_GONE_COPY : PAUSED_VERSION_UNVERIFIED_COPY
      expect(err).toBeInstanceOf(PausedVersionRefusedError)
      expect((err as Error).message).toBe(message)
      expect(userFriendlyError(err)).toBe(message)
      expect(cap.initCalls).toEqual([])
      expect(cap.uploadedChunks).toEqual([])
      expect(cap.removedStates).toEqual(['row-1'])
      expect(cap.abandons).toEqual([])
    })
  }
})

// ── R4-2: an unmarked record without its own pin restarts as NEW (reverts R3-2's widening)

describe('R4-2: an unmarked record without a pin naming its own id restarts as a new file, whatever row its id names', () => {
  /** No marker, no pin: its id may be the server's, or a row the user can write but does not own. */
  const unmarked = {
    fingerprint: 'fingerprint', fileId: 'row-2', fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'legacy-session', object_version_id: 'ov-legacy', chunk_size_bytes: 4, chunk_count: 1,
    parentId: 'parent-1', createdAt: 1,
  }
  const initIds = () => cap.initCalls.map((c) => (c as { file_id: string }).file_id)

  test('planResume: restart-new under a fresh id, and the row is not even looked up', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    const asked: string[] = []
    const plan = await planResume(unmarked, {
      mintId: () => 'fresh',
      lookupRow: async (id) => { asked.push(id); return { state: 'live', nameEncrypted: 'row-2-name' } },
    })
    expect(plan).toEqual({ kind: 'restart-new', fileId: 'fresh', resumeFileId: undefined })
    expect(asked).toEqual([])
  })

  test('uploadFile: its id names a live row this user owns, and it still uploads as a new file under a fresh id', async () => {
    echo.stored = unmarked
    echo.rows['row-2'] = { name_encrypted: 'row-2-name' }
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), 'row-2', FILE_KEY, MK, 'parent-1', undefined, 'row-2')
    const [fresh, ...more] = initIds()
    expect(more).toEqual([])
    expect(fresh).toMatch(V4)
    expect(fresh).not.toBe('row-2')
    expect(uploaded.id).toBe(fresh)
    // Never a version of the row: not its name, not looked up.
    expect((cap.initCalls[0] as { name_encrypted: string }).name_encrypted).not.toBe('row-2-name')
    expect(cap.rowLookups).toEqual([])
    expect(cap.derivedKeyIds).toEqual([fresh])
  })
})

// ── R3-3: transient folder-create failures in an import ──────────────────────

describe('R3-3: a transient folder-create failure is retried under the same id, never cached', () => {
  async function importOne(folders: { ensure(path: string): Promise<string | undefined> }, parentPath: string, name: string) {
    const { importFileInto } = await import('../src/lib/import-folders')
    return importFileInto({
      folders, parentPath, name, masterKey: MK,
      download: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      signal: new AbortController().signal, onStatus: () => {}, onBytes: () => {},
    })
  }

  test('status 0, then 200: the folder is created once, under one minted id, and its files import', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const { ApiError } = await import('../src/lib/api')
    const stopped: string[] = []
    const folders = createImportFolderTree(MK, { onFolderFailed: (path) => stopped.push(path) })
    const createdOnServer: string[] = []
    echo.createFolder = (requested) => {
      if (cap.createdFolders.length === 1) throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
      createdOnServer.push(requested ?? '')
      return requested ?? ''
    }

    // The first file sees the dropped connection (after createOwnerFolder's
    // own retries, which this suite's net-retry stub skips)...
    expect(await caught(() => importOne(folders, '/Photos', 'a.jpg'))).toMatchObject({ status: 0 })
    // ...and the next one creates the folder under the SAME id, then imports.
    await importOne(folders, '/Photos', 'b.jpg')

    const [first, second] = cap.createdFolders.map((f) => f.folderId)
    expect(cap.createdFolders).toHaveLength(2)
    expect(first).toMatch(V4)
    expect(second).toBe(first)
    expect(createdOnServer).toEqual([first])
    expect(cap.initCalls.map((c) => (c as { parent_id: string }).parent_id)).toEqual([first])
    // Not a stopped subtree: nothing was reported as such.
    expect(stopped).toEqual([])
  })
})

// ── R4-1: an import never reuses an existing folder (reverts R3-4) ───────────

describe('R4-1: an import always creates its own private folders, never reusing an existing one', () => {
  /** A folder row whose name authenticates under the stubs' key (0xd0), as an own folder's would. */
  const ownFolderRow = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, is_folder: true, is_trashed: false, created_at: '2026-10-01T00:00:00Z',
    name_encrypted: JSON.stringify({ nonce: [0xd0], ciphertext: Array.from(new TextEncoder().encode(name)) }),
    ...over,
  })

  test('an existing same-named folder the user has SHARED is never reused: a new private folder is minted', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    let listings = 0
    setListPage(() => {
      listings++
      return { files: [ownFolderRow('shared-photos', 'Photos', { share_count: 2 })], next_cursor: null }
    })
    const folders = createImportFolderTree(MK)
    const id = await folders.ensure('/Photos')
    expect(id).not.toBe('shared-photos')
    expect(id).toMatch(V4)
    expect(cap.createdFolders).toEqual([expect.objectContaining({ folderId: id, parentId: undefined })])
    // The import does not even look: no listing, so nothing it lists can be picked.
    expect(listings).toBe(0)
  })
})

// ── R4-4: only an authentication failure is "unverified" ─────────────────────

describe('R4-4: a crypto worker error is not "unverified": it propagates and the record is kept', () => {
  const legacyVersion = {
    fingerprint: 'fingerprint', fileId: 'row-4', fileName: 'a.txt', fileSize: 1, totalChunks: 1,
    upload_session_id: 'legacy-session', object_version_id: 'ov-legacy', chunk_size_bytes: 4, chunk_count: 1,
    chunk_format: 1, replace_pin: 0, replace_pin_file_id: 'row-4', parentId: 'parent-1', createdAt: 1,
  }

  test('lookupOwnRow: a worker error propagates; an authentication failure is "unverified"', async () => {
    const { lookupOwnRow } = await import('../src/lib/stored-row')
    echo.rows['row-4'] = { name_encrypted: 'worker-crash-name' }
    expect(await caught(() => lookupOwnRow('row-4', FILE_KEY))).toMatchObject({ message: 'crypto worker was restarted' })
    echo.rows['row-4'] = { name_encrypted: 'unreadable-name' }
    expect(await lookupOwnRow('row-4', FILE_KEY)).toEqual({ state: 'unverified' })
  })

  test('uploadFile: the worker error surfaces, nothing is sent, and the paused upload\'s record is NOT deleted', async () => {
    echo.stored = legacyVersion
    echo.rows['row-4'] = { name_encrypted: 'worker-crash-name' }
    const err = await caught(() => encryptedUpload(new File(['a'], 'a.txt'), 'row-4', FILE_KEY, MK, 'parent-1', undefined, 'row-4'))
    expect(err).toMatchObject({ message: 'crypto worker was restarted' })
    expect(cap.initCalls).toEqual([])
    expect(cap.uploadedChunks).toEqual([])
    expect(cap.removedStates).toEqual([])
  })

  test('the rule matches what core actually throws for a name sealed under another key', async () => {
    const { loadWasm } = await import('./helpers/wasm-crypto-mirror')
    const { createContentOps } = await import('../src/lib/content-crypto')
    const { isAuthenticationFailure } = await import('../src/lib/folder-share-crypto')
    const wasm = loadWasm()
    const sealed = wasm.encrypt_metadata(new Uint8Array(32).fill(1), JSON.stringify({ name: 'x', mime_type: null })) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const name = JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: Array.from(sealed.nonce), ciphertext: Array.from(sealed.ciphertext) })
    let thrown: unknown = null
    try {
      createContentOps(wasm).readFileMetadata(new Uint8Array(32).fill(2), name)
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    expect(isAuthenticationFailure(thrown)).toBe(true)
    expect(isAuthenticationFailure(new Error('crypto worker was restarted'))).toBe(false)
  })
})

// ── R4-5: a row check that cannot answer is said, and dismissable ────────────

describe('R4-5: the Drive banner says why a row check failed and keeps the record dismissable', () => {
  test('each failure has its own honest sentence; every one says where to dismiss it', async () => {
    const { pausedRowCheckFailedMessage } = await import('../src/lib/upload-resume')
    const { ApiError } = await import('../src/lib/api')
    const msg = (err: unknown) => pausedRowCheckFailedMessage(err)
    expect(msg(new ApiError('Unauthorized', 401))).toBe(
      'Your session expired. Sign in again, then resume this upload. It stays in your paused uploads until you dismiss it.')
    expect(msg(new ApiError('Forbidden', 403))).toBe(
      'You no longer have access to the file this paused upload was a new version of, so it was not restarted. Dismiss it from your paused uploads.')
    expect(msg(new ApiError('Gone', 410))).toBe(
      'The file this paused upload was a new version of is gone, so it was not restarted. Dismiss it from your paused uploads.')
    for (const other of [new ApiError('Could not reach the server.', 0), new Error('crypto worker was restarted')]) {
      expect(msg(other)).toBe(
        "We couldn't check the file this paused upload was a new version of, so it was not restarted. Try again, or dismiss it from your paused uploads.")
    }
  })

  test('drive.tsx: a failed row check keeps the record, puts it back on the paused banner, and says why', () => {
    const text = source('pages/drive.tsx')
    const start = text.indexOf('async function handleResumeFile(')
    expect(start).toBeGreaterThan(-1)
    const body = text.slice(start, text.indexOf('const { browse: browseResume', start))
    const check = body.slice(body.indexOf('await planResume('))
    const handler = check.slice(check.indexOf('} catch (err) {'), check.indexOf('continue'))
    // The plan has its own catch: the row check's failure is not a "Resume failed" loop.
    expect(handler).toContain('pausedRowCheckFailedMessage(err)')
    expect(handler).toContain('setPausedUploads(')
    // The record is not deleted on a check that could not answer.
    expect(handler).not.toContain('removeUploadState')
  })
})

// ── F2: the next import call adopts a folder an earlier call committed ───────

describe('F2: a folder committed while every try of one call failed is adopted by the next call', () => {
  async function importOne(folders: { ensure(path: string): Promise<string | undefined> }, parentPath: string, name: string) {
    const { importFileInto } = await import('../src/lib/import-folders')
    return importFileInto({
      folders, parentPath, name, masterKey: MK,
      download: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      signal: new AbortController().signal, onStatus: () => {}, onBytes: () => {},
    })
  }

  test('call 1: the create committed but its answer was lost; call 2: 500 on the key -> adopted, and its files import', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const { ApiError } = await import('../src/lib/api')
    const folders = createImportFolderTree(MK)
    echo.createFolder = () => {
      if (cap.createdFolders.length === 1) throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
      throw new ApiError('Internal server error', 500)
    }

    // Call 1: the row is not readable yet (the connection is still down), so
    // nothing is adopted and the dropped connection surfaces for that file.
    expect(await caught(() => importOne(folders, '/Photos', 'a.jpg'))).toMatchObject({ status: 0 })
    const first = cap.createdFolders[0]
    // ...the INSERT had committed:
    echo.rows[first.folderId!] = { is_folder: true, name_encrypted: first.nameEncrypted, parent_id: null }

    // Call 2: same minted id, same sealed name; its 500 is the primary key,
    // and the row is exactly the folder sent, so it is adopted.
    await importOne(folders, '/Photos', 'b.jpg')
    expect(cap.createdFolders).toHaveLength(2)
    expect(cap.createdFolders[1].folderId).toBe(first.folderId)
    expect(cap.createdFolders[1].nameEncrypted).toBe(first.nameEncrypted)
    // The folder name was sealed once for the run, not once per call.
    expect(cap.sealedPlaintexts.filter((p) => p === 'Photos')).toHaveLength(1)
    expect(cap.initCalls.map((c) => (c as { parent_id: string }).parent_id)).toEqual([first.folderId])
  })
})
