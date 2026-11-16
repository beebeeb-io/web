/**
 * SF-0001 L13 round 2 — E2/E3/E4: persisted sessions.
 *
 * E2: a pre-update REPLACE record (its `fileId` is the listed row, with a
 *     `replace_pin`) targets an id the client chose. It restarts as a version
 *     of THAT row, pin included — never as a fresh file.
 * E3: the rule lives in `uploadFile`, not only in Drive. An unmarked create
 *     record is never adopted — not through `resumeFileId`, not by fingerprint.
 * E4: a fingerprint match for another row never triggers the file-wide abandon
 *     (the endpoint can kill another tab's live upload); the record's own
 *     session, or the server's lease sweep, owns that.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { installMocks, cap, resume, resetCaptures, resetEchoes } from './helpers/upload-share-mocks'

await installMocks()
await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  sharedRootFor: async () => null,
  folderKeyForRoot: async () => new Uint8Array(32).fill(7),
  folderWrapFormat: async () => 'l7',
})

const { planResume } = await import('../src/lib/upload-resume')
const { encryptedUpload } = await import('../src/lib/encrypted-upload')

const MK = new Uint8Array([9])
const FILE_KEY = new Uint8Array([1])

/** A record written before the L13 marker by a client that was replacing a listed row. */
function legacyReplaceRecord(id: string) {
  return {
    fingerprint: 'fingerprint',
    fileId: id,
    fileName: 'report.pdf',
    fileSize: 4,
    totalChunks: 1,
    chunk_count: 1,
    chunk_size_bytes: 4,
    replace_pin: 0,
    replace_pin_file_id: id,
    parentId: 'parent-1',
    createdAt: 1,
  }
}

/** A record written by an older client for a CREATE: its id may be the server's. */
function legacyCreateRecord(id: string, sessionId = 'stale-session-id') {
  return {
    fingerprint: 'fingerprint',
    fileId: id,
    fileName: 'x.txt',
    fileSize: 4,
    totalChunks: 1,
    chunk_count: 1,
    chunk_size_bytes: 4,
    upload_session_id: sessionId,
    object_version_id: 'old-object-version',
    chunk_format: 1,
    parentId: null,
    createdAt: 1,
  }
}

beforeEach(() => {
  resetCaptures()
  resetEchoes()
})

describe('E2: a legacy REPLACE record resumes the listed row, not a fresh id', () => {
  test('planResume keeps the row id and abandons nothing when the record is a replace', () => {
    const record = legacyReplaceRecord('listed-row-id')
    expect(planResume(record, () => 'fresh-id')).toEqual({ resumeId: 'listed-row-id', abandonId: null })
  })

  test('a legacy CREATE record still restarts under a fresh minted id', () => {
    expect(planResume(legacyCreateRecord('server-chosen'), () => 'fresh-id')).toEqual({
      resumeId: 'fresh-id',
      abandonId: 'server-chosen',
    })
  })

  test('the paused legacy version upload resumes as a version of the same row: same id and pin, no duplicate', async () => {
    resume.record = legacyReplaceRecord('listed-row-id')
    const plan = planResume(resume.record as never, () => 'fresh-id')
    const uploaded = await encryptedUpload(
      new File(['data'], 'report.pdf'),
      plan.resumeId,
      FILE_KEY,
      MK,
      'parent-1',
      undefined,
      plan.resumeId,
    )

    expect(plan.abandonId).toBeNull()
    expect(uploaded.id).toBe('listed-row-id')
    // The recorded pin is applied: a new version in the row's own format.
    expect(cap.appliedPins).toEqual([0])
    // Nothing opened a second file and nothing was renamed (no duplicate row).
    expect(cap.initCalls).toEqual([])
    expect(cap.updatedFiles).toEqual([])
    expect(cap.abandons).toEqual([])
    expect(cap.uploadedChunks.map((c) => c.fileId)).toEqual(['listed-row-id'])
  })
})

describe('E3: uploadFile never adopts an unmarked create record', () => {
  test('resumeFileId matching an unmarked create record does a fresh init', async () => {
    resume.record = legacyCreateRecord('server-chosen-row')
    const uploaded = await encryptedUpload(
      new File(['data'], 'x.txt'),
      'server-chosen-row',
      FILE_KEY,
      MK,
      undefined,
      undefined,
      'server-chosen-row',
    )

    expect(uploaded.id).toBe('server-chosen-row')
    // A fresh init, not the stale stored session.
    expect(cap.initCalls.length).toBe(1)
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['upload-session-id'])
  })

  test('the fingerprint auto-resume branch does not adopt an unmarked create record', async () => {
    resume.record = legacyCreateRecord('own-id')
    await encryptedUpload(new File(['data'], 'x.txt'), 'own-id', FILE_KEY, MK, undefined)

    expect(cap.initCalls.length).toBe(1)
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['upload-session-id'])
  })

  test('a marked record is still adopted (no second init)', async () => {
    resume.record = { ...legacyCreateRecord('own-id', 'live-session-id'), selfMinted: true }
    await encryptedUpload(new File(['data'], 'x.txt'), 'own-id', FILE_KEY, MK, undefined)

    expect(cap.initCalls).toEqual([])
    expect(cap.uploadedChunks.map((c) => c.uploadSessionId)).toEqual(['live-session-id'])
  })
})

describe('E4: a fingerprint match never abandons another row file-wide', () => {
  test('a matching legacy record for another row makes no abandon call', async () => {
    resume.record = legacyCreateRecord('other-row', 'other-row-session')
    await encryptedUpload(new File(['data'], 'x.txt'), 'my-id', FILE_KEY, MK, undefined)

    expect(cap.abandons).toEqual([])
    // The other row's local record goes, so the banner stops offering it; the
    // server's lease sweep owns that row. (Removing our own successful upload's
    // record at the end is expected and checked separately.)
    expect(cap.removedStates).toContain('other-row')
    expect(cap.initCalls.length).toBe(1)
    expect(cap.initCalls[0]).toMatchObject({ file_id: 'my-id' })
  })
})
