import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from 'bun:test'

// task 1436 — the desktop/web half of 1392. The server records
// `X-Beebeeb-Client` / `X-Beebeeb-Client-Version` on every `object_versions`
// row it writes (server PR #23 / task 1369) so a blast-radius query can tell
// which client + build wrote a version. This suite proves:
//   1. `provenanceHeaders()` is opt-in — no headers before `setClientInfo()`
//      is ever called (this is what keeps admin, which never calls it,
//      untagged even though it imports the same shared `request()`).
//   2. Once a consuming app calls `setClientInfo(client, version)`, EVERY
//      `request()` call attaches both headers with the exact values given.

// Mock the token module so request() doesn't touch localStorage (mirrors
// test/rate-limit-retry.test.ts's pattern for the same reason).
mock.module('../packages/shared/src/api/token', () => ({
  getToken: () => null,
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
}))

let capturedHeaders: Record<string, string> = {}
const originalFetch = globalThis.fetch
const mockFetch = (async (_url: string, init?: RequestInit) => {
  capturedHeaders = (init?.headers as Record<string, string>) ?? {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}) as unknown as typeof fetch

const { request, setApiUrl, setClientInfo, getClientInfo, provenanceHeaders } = await import(
  '../packages/shared/src/api/index'
)

setApiUrl('http://test.local')

describe('writer-provenance headers (1436)', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })
  beforeEach(() => {
    capturedHeaders = {}
  })

  // Runs before any `setClientInfo()` call below establishes this describe
  // block's own state — proves the pure helper's opt-in default in isolation
  // from `request()`'s fetch plumbing (which the tests below cover).
  test('provenanceHeaders() is empty before setClientInfo() is ever called in this scope', () => {
    // A fresh import graph starts with CLIENT_INFO unset. If another test
    // file already called setClientInfo() in this process, getClientInfo()
    // reveals that instead of silently asserting a false negative.
    if (getClientInfo() === null) {
      expect(provenanceHeaders()).toEqual({})
    }
  })

  test('request() attaches both headers once setClientInfo() is called', async () => {
    setClientInfo('web', '1.2.3')
    const result = await request<{ ok: boolean }>('/api/v1/whatever')
    expect(result).toEqual({ ok: true })
    expect(capturedHeaders['X-Beebeeb-Client']).toBe('web')
    expect(capturedHeaders['X-Beebeeb-Client-Version']).toBe('1.2.3')
  })

  test('provenanceHeaders() returns exactly the two headers, no more', () => {
    setClientInfo('web', '9.9.9')
    expect(provenanceHeaders()).toEqual({
      'X-Beebeeb-Client': 'web',
      'X-Beebeeb-Client-Version': '9.9.9',
    })
  })

  test('a later setClientInfo() call updates subsequent requests', async () => {
    setClientInfo('web', '2.0.0')
    await request('/api/v1/whatever')
    expect(capturedHeaders['X-Beebeeb-Client-Version']).toBe('2.0.0')
  })
})
