/**
 * SF-0001 L13 round 2 — E1: an import proposes its own folder ids.
 *
 * The old import minted a folder id from a SHA-256 of the provider path: the
 * same id for every user and every run, with a wrong version nibble. A failed
 * create (the server answering another id included) was swallowed by a bare
 * `catch {}` and the derived id was used as if the folder existed.
 *
 * Now every folder gets a fresh v4, minted once per run, and a create failure
 * stops that subtree and surfaces the error — no file init under it.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, echo, resetCaptures, resetEchoes } from './helpers/upload-share-mocks'

await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { createImportRun } = await import('../src/lib/import-folders')
const { encryptedUpload } = await import('../src/lib/encrypted-upload')
const { createOwnerFolder } = await import('../src/lib/owner-upload-key')
const { SERVER_CHANGED_ITEM_ID_MESSAGE, ServerChangedItemIdError } = await import('../src/lib/item-id-echo')

const MK = new Uint8Array([9])
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** One import run: real create path, fake key derivation (no WASM here). */
function makeRun() {
  return createImportRun({
    masterKey: MK,
    mintId: () => crypto.randomUUID(),
    deriveKey: async () => new Uint8Array([3]),
    encryptName: async (_nameKey: Uint8Array, name: string) => `sealed:${name}`,
    create: (args) => createOwnerFolder(args),
    upload: (file, fileId, fileKey, parentId, masterKey, signal) =>
      encryptedUpload(file, fileId, fileKey, masterKey, parentId, undefined, undefined, undefined, signal),
  })
}

beforeEach(() => {
  resetCaptures()
  resetEchoes()
})

describe('E1: import folder creates mint a v4 id per folder per run', () => {
  test('two imports of the same provider path propose different ids', async () => {
    const first = await makeRun().ensureFolderPath('Photos/2024')
    const second = await makeRun().ensureFolderPath('Photos/2024')

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    // Each run creates Photos then Photos/2024; the leaf ids must differ.
    expect(cap.createdFolders.length).toBe(4)
    const leafIds = [cap.createdFolders[1].folderId!, cap.createdFolders[3].folderId!]
    expect(leafIds[0]).not.toBe(leafIds[1])
    for (const created of cap.createdFolders) expect(created.folderId!).toMatch(V4)
    // The returned leaf is the id this run minted, not a hash of the path.
    expect(first).toBe(leafIds[0])
  })

  test('within one run a path is created once and reused', async () => {
    const run = makeRun()
    const a = await run.ensureFolderPath('Photos/2024')
    const b = await run.ensureFolderPath('Photos/2024')
    expect(a).toBe(b)
    expect(cap.createdFolders.length).toBe(2) // Photos, Photos/2024
  })

  test('the root has no folder', async () => {
    expect(await makeRun().ensureFolderPath('')).toBeUndefined()
    expect(cap.createdFolders).toEqual([])
  })

  test('a changed-id create error is surfaced and no file inits under that parent', async () => {
    echo.createFolder = () => 'server-chosen-folder-id'
    const run = makeRun()
    const err = await run
      .uploadItem(new File(['a'], 'a.txt'), 'Photos/2024')
      .then(() => null, (e: unknown) => e)

    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
    // Only the top folder was attempted; nothing was uploaded.
    expect(cap.createdFolders.length).toBe(1)
    expect(cap.initCalls).toEqual([])
    expect(cap.uploadedChunks).toEqual([])

    // The failed subtree is not retried for the next file in the run.
    const again = await run
      .uploadItem(new File(['b'], 'b.txt'), 'Photos/2024')
      .then(() => null, (e: unknown) => e)
    expect(again).toBe(err)
    expect(cap.createdFolders.length).toBe(1)
    expect(cap.initCalls).toEqual([])
  })

  test('a successful import creates each folder under the minted id and uploads under it', async () => {
    const run = makeRun()
    await run.uploadItem(new File(['a'], 'a.txt'), 'Photos/2024')
    expect(cap.initCalls.length).toBe(1)
    const leaf = cap.createdFolders[1]
    expect(cap.initCalls[0]).toMatchObject({ parent_id: leaf.folderId })
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual([
      (cap.initCalls[0] as { file_id: string }).file_id,
    ])
  })
})
