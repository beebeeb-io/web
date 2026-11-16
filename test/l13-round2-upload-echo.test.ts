/**
 * SF-0001 L13 round 2 — E5 (part 2): mismatch cleanup in the upload itself.
 *
 * - An init answered with another id abandons the session for the id this
 *   client REQUESTED (the one the server may now hold for us) — never the
 *   echoed one.
 * - A completion answered with another id keeps the resume record, so the next
 *   run does not upload the file a second time, and the error says plainly that
 *   the file may exist on the server.
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

const { encryptedUpload } = await import('../src/lib/encrypted-upload')
const { SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE, ServerChangedItemIdError } = await import(
  '../src/lib/item-id-echo'
)

const MK = new Uint8Array([9])
const FILE_KEY = new Uint8Array([1])

beforeEach(() => {
  resetCaptures()
  resetEchoes()
})

describe('E5: an init mismatch abandons the REQUESTED id', () => {
  test('the requested id is abandoned, not the echoed one', async () => {
    echo.init = () => 'server-chosen-id'
    const err = await encryptedUpload(new File(['a'], 'a.txt'), 'requested-id', FILE_KEY, MK).then(
      () => null,
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect(cap.abandons).toEqual(['requested-id'])
    expect(cap.uploadedChunks).toEqual([])
    expect(cap.savedStates).toEqual([])
  })
})

describe('E5: a completion mismatch keeps the resume record and tells the truth', () => {
  test('the record survives so the next run does not upload it twice', async () => {
    echo.complete = () => 'server-chosen-id'
    const err = await encryptedUpload(new File(['a'], 'a.txt'), 'my-file-id', FILE_KEY, MK).then(
      () => null,
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
    // The record written before the transfer stays: dropping it would invite a
    // second upload of content the server may already hold.
    expect(cap.savedStates.some((s) => s.fileId === 'my-file-id')).toBe(true)
    expect(cap.removedStates).not.toContain('my-file-id')
    // No abandon here either — the upload itself may be live under our id.
    expect(cap.abandons).toEqual([])
  })

  test('a successful completion still drops the record', async () => {
    await encryptedUpload(new File(['a'], 'a.txt'), 'my-file-id', FILE_KEY, MK)
    expect(cap.removedStates).toContain('my-file-id')
  })
})
