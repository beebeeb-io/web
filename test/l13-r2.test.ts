/**
 * SF-0001 / contract 2275 L13, round 2 on web#206 — the rows the review found
 * still open after round 1.
 *
 * E1  the import mints its own folder ids (per folder, per run) and a failed
 *     create stops that subtree instead of falling back to a guessed id.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures } from './helpers/upload-share-mocks'

await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } = await import('../src/lib/item-id-echo')

const MK = new Uint8Array([9])
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
