/**
 * Final review P2 (web #198): the owner key publish runs AFTER an upload has
 * committed. With the flag off and the flag request failing (5xx, offline,
 * over 5 s), the strict write read used to throw there, so a committed upload
 * was reported failed and its thumbnails were skipped. After a commit, an
 * unanswered flag read skips the publish, as main does, unless the folder
 * sits under one this device has seen with custody (N2), where it fails.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'

// A unit test must never reach a real API (final review P3-2).
preserveGlobals('fetch')
setGlobal('fetch', (async (input: RequestInfo | URL) => {
  throw new Error(`unit test tried the network: ${String(input)}`)
}) as typeof fetch)

await installMocks()
// The flag request fails: reads fail closed, a write's strict read throws.
await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  sharedFoldersEnabled: async () => false,
  sharedFoldersEnabledForWrite: async () => {
    throw new (r.FeatureFlagsUnavailableError as new () => Error)()
  },
}))
const thumbnails: string[] = []
await mockModuleScoped('../src/lib/thumbnail', import.meta.dir, {
  generateThumbnail: async () => new Blob([new Uint8Array([1])]),
  generateLargeThumbnail: async () => null,
  encryptAndUploadThumbnail: async (fileId: string) => {
    thumbnails.push(fileId)
  },
  encryptAndUploadLargeThumbnail: async () => {},
})

const { resetCustodyMemoryForTests, markCustodySeen } = await import('../src/lib/custody-memory')
const PARENT = '66666666-6666-4666-8666-666666666666'

async function upload(parentId: string) {
  const { encryptedUpload } = await import('../src/lib/encrypted-upload')
  return encryptedUpload(new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' }), 'proposed',
    new Uint8Array([1]), new Uint8Array([9]), parentId, undefined, undefined, undefined, undefined,
    async () => new Uint8Array([9]))
}

beforeEach(() => {
  resetCaptures()
  resetCustodyMemoryForTests()
  thumbnails.length = 0
})

describe('final review P2: a failed flag read after the upload committed', () => {
  test('flag request failing, an upload into an unshared folder succeeds, reports success, and writes its thumbnails', async () => {
    const uploaded = await upload(PARENT)
    expect(uploaded.id).toBe('server-file-id')
    expect(thumbnails).toEqual(['server-file-id'])
    expect(cap.ownerKeys).toHaveLength(0)
  })

  test('the same, into a folder seen with custody: the publish still fails (never a silent skip under custody)', async () => {
    markCustodySeen(PARENT)
    await expect(upload(PARENT)).rejects.toThrow("This folder's keys are unavailable")
    expect(cap.ownerKeys).toHaveLength(0)
  })
})
