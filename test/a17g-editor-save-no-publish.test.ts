/**
 * Contract 2275 L15 / A17g: an editor save of an EXISTING file whose
 * server-reported parent is `R` publishes nothing.
 *
 * The text editor and the office editor both save through `encryptedUpload`
 * with `replaceOf` and the listed row's `parent_id` — a write to an existing id
 * (replace, version, editor save, save-as-new) is never a publish trigger. The
 * test drives that exact call into a custody folder with the click trail
 * anchored on `R`, so neither the parent the server reported nor the anchor can
 * publish it.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { preserveGlobals, setGlobal } from './helpers/scoped-global'
import { installMocks, cap, echo, resetCaptures } from './helpers/upload-share-mocks'

// A unit test must never reach a real API.
preserveGlobals('fetch')
setGlobal('fetch', (async (input: RequestInfo | URL) => {
  throw new Error(`unit test tried the network: ${String(input)}`)
}) as typeof fetch)

await installMocks()

const ROOT = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '44444444-4444-8444-8444-444444444444'
const MASTER = new Uint8Array(32).fill(7)
const EXISTING_NAME = JSON.stringify({ nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAA' })

const { resetCustodyMemoryForTests, markCustodySeen } = await import('../src/lib/custody-memory')
const { noteFolderClick, noteUrlFolder, resetAnchorsForTests } = await import('../src/lib/publish-anchor')

/** `file-editor.tsx` / `office-editor.tsx`: replaceOf + the row's parent_id. */
async function saveExistingFile(parentId: string) {
  const { encryptedUpload } = await import('../src/lib/encrypted-upload')
  return encryptedUpload(
    new File(['edited document'], 'notes.txt', { type: 'text/plain' }),
    FILE_ID,
    new Uint8Array(32).fill(3),
    MASTER,
    parentId,
    undefined,
    undefined,
    undefined,
    undefined,
    { replaceOf: { nameEncrypted: EXISTING_NAME } },
  )
}

beforeEach(() => {
  resetCaptures()
  resetCustodyMemoryForTests()
  resetAnchorsForTests()
  echo.rows[FILE_ID] = {
    id: FILE_ID,
    parent_id: ROOT,
    is_folder: false,
    name_encrypted: EXISTING_NAME,
    is_trashed: false,
  }
})

describe('A17g: an editor save of an existing file under R', () => {
  test('writes the new version and publishes no key, even anchored on R under custody', async () => {
    markCustodySeen(ROOT)
    noteFolderClick(ROOT)
    noteUrlFolder(ROOT)

    const saved = await saveExistingFile(ROOT)

    expect(saved.id).toBe(FILE_ID)
    // The version was written (not skipped for fear of publishing).
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual([FILE_ID])
    // Nothing was sealed for a share: an existing id is never a publish.
    expect(cap.ownerKeys).toEqual([])
    expect(cap.addFolderKeysCalls).toEqual([])
  })

  test('the sink itself has no publish hook to reach (the removal L15 asks for)', async () => {
    const { readFileSync } = await import('node:fs')
    for (const file of ['../src/lib/encrypted-upload.ts', '../src/components/editor/file-editor.tsx', '../src/components/office/office-editor.tsx']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src).not.toContain('publishOwnerUploadKey')
      expect(src).not.toContain('publishOrDeferOwnerUpload')
    }
  })
})
