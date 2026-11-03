/**
 * SF-0001 / contract 2275 L13, round 2 row E5 — the echo check lives in the
 * request primitives themselves (api.ts createFolder / initUpload /
 * completeUpload), which receive the id the client proposed. Every caller is
 * then covered once, and a caller cannot forget it.
 *
 * Real api.ts + real request(); only `fetch` is replaced. (Suites that mock
 * ./api check the echo inside their mocks, as these primitives do.)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const {
  SERVER_CHANGED_ITEM_ID_MESSAGE,
  SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE,
  ServerChangedItemIdError,
} = await import('../src/lib/item-id-echo')
const { completeUpload, createFolder, initUpload } = await import('../src/lib/api')

const OWN = '0b5c3a1e-7d2f-4c6a-9e8b-1f2a3b4c5d6e'
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321'

type Answer = { status: number; body: unknown }
let answers: Record<string, Answer> = {}
let calls: Array<{ url: string; method: string; body: unknown }> = []
const originalFetch = globalThis.fetch

beforeEach(() => {
  answers = {}
  calls = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    calls.push({ url: path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    const answer = answers[path] ?? { status: 404, body: { error: 'not found' } }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

const file = (id: string) => ({
  id, name_encrypted: 'n', mime_type: null, size_bytes: 4, chunk_count: 1, is_folder: false,
  is_uploading: false, created_at: '2026-10-31T00:00:00Z', updated_at: '2026-10-31T00:00:00Z',
})
const v2Init = (id: string) => ({
  file_id: id, tenant_id: 't', object_version_id: 'ov', upload_session_id: 'us-1', chunk_size_bytes: 4,
  chunk_count: 1, storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
})
const meta = { file_id: OWN, name_encrypted: 'n', size_bytes: 4, chunk_count: 1, parent_id: null }

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (e: unknown) => e)
}

function expectChanged(err: unknown, message: string) {
  expect(err).toBeInstanceOf(ServerChangedItemIdError)
  expect((err as { code: string }).code).toBe('server_changed_item_id')
  expect((err as Error).message).toBe(message)
}

describe('E5: initUpload checks the answer against the id it proposed', () => {
  test('v2: an answer naming another item throws, and the primitive itself sends nothing else', async () => {
    answers['/api/v1/uploads/init'] = { status: 200, body: v2Init(OTHER) }
    expectChanged(await caught(() => initUpload(meta)), SERVER_CHANGED_ITEM_ID_MESSAGE)
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/uploads/init'])
  })

  test('v2: the exact id passes', async () => {
    answers['/api/v1/uploads/init'] = { status: 200, body: v2Init(OWN) }
    expect(await initUpload(meta)).toMatchObject({ protocol: 'v2', file_id: OWN })
  })

  test('v2: an upper-cased echo of the own id is another id (the match is exact)', async () => {
    answers['/api/v1/uploads/init'] = { status: 200, body: v2Init(OWN.toUpperCase()) }
    expectChanged(await caught(() => initUpload(meta)), SERVER_CHANGED_ITEM_ID_MESSAGE)
  })

  test('v1 (the legacy route after a v2 404): an answer naming another item throws', async () => {
    answers['/api/v1/files/upload/init'] = { status: 200, body: { file_id: OTHER, chunk_count: 1 } }
    expectChanged(await caught(() => initUpload(meta)), SERVER_CHANGED_ITEM_ID_MESSAGE)
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/uploads/init', '/api/v1/files/upload/init'])
  })
})

describe('E5: completeUpload checks the answer, with the after-upload copy', () => {
  test('session route: another item throws; the copy says the file may already be on the server', async () => {
    answers['/api/v1/uploads/us-1/complete'] = { status: 200, body: file(OTHER) }
    expectChanged(await caught(() => completeUpload(OWN, 'us-1')), SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
  })

  test('legacy route: another item throws too', async () => {
    answers[`/api/v1/files/${OWN}/upload/complete`] = { status: 200, body: file(OTHER) }
    expectChanged(await caught(() => completeUpload(OWN)), SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
  })

  test('the exact id passes', async () => {
    answers['/api/v1/uploads/us-1/complete'] = { status: 200, body: file(OWN) }
    expect((await completeUpload(OWN, 'us-1')).id).toBe(OWN)
  })
})

describe('E5: createFolder checks the answer against the folder id it proposed', () => {
  test('another item throws', async () => {
    answers['/api/v1/files/folder'] = { status: 200, body: { ...file(OTHER), is_folder: true } }
    expectChanged(await caught(() => createFolder('sealed', undefined, OWN)), SERVER_CHANGED_ITEM_ID_MESSAGE)
    expect(calls[0].body).toMatchObject({ folder_id: OWN })
  })

  test('the exact id passes', async () => {
    answers['/api/v1/files/folder'] = { status: 200, body: { ...file(OWN), is_folder: true } }
    expect((await createFolder('sealed', 'parent-1', OWN)).id).toBe(OWN)
  })
})
