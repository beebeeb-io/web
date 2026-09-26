import { describe, expect, test } from 'bun:test'

/**
 * Web same-name re-upload created a DUPLICATE instead of a new version:
 * `initUpload()`'s v2 body dropped `metadata.file_id`, so the server — which
 * versions an existing file when `InitUploadV2Request.file_id` names it
 * (server routes/uploads.rs) — never saw the id of the file being replaced
 * and inserted a brand-new row under a server-generated id. Its own
 * name-match fallback cannot fire either, because `name_encrypted` is fresh
 * ciphertext on every upload.
 *
 * Tests the extracted body builder directly (no `mock.module('../src/lib/api')`:
 * that registration is process-global and collides with
 * test/helpers/upload-share-mocks.ts).
 */
const { buildUploadInitV2Body } = await import('../src/lib/upload-init-body')

const base = {
  name_encrypted: 'enc-name',
  size_bytes: 22,
  chunk_count: 1,
  parent_id: null,
}

describe('buildUploadInitV2Body() — v2 upload init carries file_id', () => {
  test('forwards file_id when given (replace / auto-version / resume)', () => {
    const body = buildUploadInitV2Body({ ...base, file_id: 'ec323656-0000-4000-8000-000000000001' })
    expect(body.file_id).toBe('ec323656-0000-4000-8000-000000000001')
  })

  test('the serialized JSON the server receives contains file_id', () => {
    const json = JSON.parse(JSON.stringify(buildUploadInitV2Body({ ...base, file_id: 'abc' })))
    expect(json.file_id).toBe('abc')
  })

  test('omits file_id when none is given (server issues one)', () => {
    const json = JSON.parse(JSON.stringify(buildUploadInitV2Body(base)))
    expect('file_id' in json).toBe(false)
  })

  test('keeps the rest of the v2 contract unchanged', () => {
    const body = buildUploadInitV2Body({ ...base, file_id: 'abc', is_media: true, conflict_created: true, parent_id: 'p1' })
    expect(body).toEqual({
      file_id: 'abc',
      file_name: 'enc-name',
      file_size_bytes: 22,
      parent_id: 'p1',
      profile: 'web',
      is_media: true,
      conflict_created: true,
    })
  })
})
