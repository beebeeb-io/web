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
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures } from './helpers/upload-share-mocks'

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

  test('any create error stops the subtree the same way; other folders still import', async () => {
    const { createImportFolderTree } = await import('../src/lib/import-folders')
    const folders = createImportFolderTree(MK)
    echo.createFolder = (requested) => {
      if (cap.createdFolders.length === 1) throw new Error('Could not reach the server.')
      return requested ?? ''
    }

    expect(await caught(() => importOne(folders, '/Photos'))).toMatchObject({ message: 'Could not reach the server.' })
    expect(await caught(() => importOne(folders, '/Photos/2024'))).toMatchObject({ message: 'Could not reach the server.' })
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
    expect(planResume(legacyReplace, () => 'fresh-own-id')).toEqual({
      kind: 'restart-version', fileId: 'listed-row-id', resumeFileId: 'listed-row-id',
    })
  })

  test('the Drive resume path: one init under the row with its recorded pin, in a fresh session; no new file', async () => {
    const { planResume } = await import('../src/lib/upload-resume')
    echo.stored = legacyReplace
    // Exactly what the Drive resume banner passes for this record.
    const plan = planResume(legacyReplace, () => crypto.randomUUID())
    const uploaded = await encryptedUpload(new File(['a'], 'a.txt'), plan.fileId, FILE_KEY, MK,
      legacyReplace.parentId, undefined, plan.resumeFileId)

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
    const plan = planResume({ ...legacyReplace, replace_pin_file_id: 'some-other-row' }, () => 'fresh-own-id')
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
