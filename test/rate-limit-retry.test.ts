import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from 'bun:test'

// Mock the token module so request() doesn't touch localStorage.
mock.module('../packages/shared/src/api/token', () => ({
  getToken: () => null,
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
}))

// Queue of canned responses returned by successive fetch() calls, plus a
// record of the actual retry-after headers each 429 carried.
let responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = []
let fetchCallCount = 0
const originalFetch = globalThis.fetch
const mockFetch = (async () => {
  const next = responses[fetchCallCount] ?? responses[responses.length - 1]
  fetchCallCount++
  return new Response(JSON.stringify(next.body), {
    status: next.status,
    headers: { 'content-type': 'application/json', ...next.headers },
  })
}) as unknown as typeof fetch

const { request, setApiUrl } = await import('../packages/shared/src/api/index')

setApiUrl('http://test.local')

describe('request() 429 retry-after handling (1148)', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })
  beforeEach(() => {
    fetchCallCount = 0
    responses = []
  })

  test('a 429 with a large Retry-After (86400s) throws promptly instead of sleeping', async () => {
    responses = [
      {
        status: 429,
        body: { error: 'rate_limit_exceeded' },
        headers: { 'retry-after': '86400' },
      },
    ]
    const start = Date.now()
    await expect(request('/api/v1/whatever')).rejects.toThrow(/24 hours/)
    const elapsed = Date.now() - start
    // Must resolve near-instantly — no sleep at all, let alone 24h.
    expect(elapsed).toBeLessThan(2000)
    // Only ONE fetch call — no retry attempted for a delay this large.
    expect(fetchCallCount).toBe(1)
  })

  test('a 429 with a short Retry-After (2s) still auto-retries and can succeed', async () => {
    responses = [
      {
        status: 429,
        body: { error: 'rate_limit_exceeded' },
        headers: { 'retry-after': '2' },
      },
      {
        status: 200,
        body: { ok: true },
      },
    ]
    const start = Date.now()
    const result = await request<{ ok: boolean }>('/api/v1/whatever')
    const elapsed = Date.now() - start
    expect(result).toEqual({ ok: true })
    expect(fetchCallCount).toBe(2)
    // Actually waited ~2s (smoothing behavior preserved), not instant.
    expect(elapsed).toBeGreaterThanOrEqual(1900)
  })
})
