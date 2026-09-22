import { describe, expect, test } from 'bun:test'
import type { AuthUser } from '@beebeeb/shared'

/**
 * Task 1474 — `devices.tsx`'s `useSessionSSE` opened
 * `new EventSource(...&token=<bb_session>)` using `getToken()`, the legacy
 * `bb_session` localStorage slot (task 1471's finding: that slot is empty
 * for any real cookie-authenticated user, and the server's `AuthUser`
 * extractor never even read the query string — see server PR #68's premise
 * check). The fix: gate on `isAuthenticated(user)` (the auth-context truth
 * task 1471 introduced), and mint a FRESH short-lived stream token via
 * `getStreamToken()` (the same token type/table the WS path already uses)
 * right before each `EventSource` open — never the legacy slot.
 *
 * `buildSessionSSEUrl` and `attemptSessionSSEConnect` are the extracted,
 * directly-testable pure/injectable pieces (mirrors `attemptConnect` in
 * `hooks/use-websocket.ts` / `shouldOpenWs` in `lib/ws-context.tsx` — no
 * React rendering harness in this repo's `bun test` setup, see
 * 1471-isloggedin-auth-context.test.ts's header comment).
 */

function cookieUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: 'u_1474',
    email: 'guus@beebeeb.io',
    email_verified: true,
    created_at: '2026-01-01T00:00:00Z',
    totp_enabled: false,
    ...overrides,
  }
}

const { buildSessionSSEUrl, attemptSessionSSEConnect } = await import(
  '../src/pages/devices'
)
const { setApiUrl } = await import('@beebeeb/shared')

// `getApiUrl()` defaults to production per the workspace's "no localhost
// defaults" rule (`src/lib/api.ts`'s own module-level `setApiUrl(API_URL)`
// call, triggered by importing `devices.tsx` above, resolves that from env
// to `https://api.beebeeb.io` under `bun test`). Pin it AFTER that import so
// this file's own call wins and its URL assertions are deterministic — same
// convention as `test/session-expiry-gate.test.ts` / `test/rate-limit-retry.test.ts`.
setApiUrl('http://test.local')

describe('buildSessionSSEUrl() — the SSE URL is built from the stream token and nothing else (task 1474)', () => {
  test('encodes the given stream token into the `token` query param on /clients/sessions/live', () => {
    const url = buildSessionSSEUrl('strm_abc123')
    expect(url).toBe('http://test.local/api/v1/clients/sessions/live?token=strm_abc123')
  })

  test('URI-encodes special characters in the token — never assumes it is URL-safe', () => {
    const url = buildSessionSSEUrl('strm/with+special=chars')
    expect(url).toContain(encodeURIComponent('strm/with+special=chars'))
    expect(url).not.toContain('strm/with+special=chars')
  })
})

describe('attemptSessionSSEConnect() — gates on isAuthenticated(user), never the legacy token slot (task 1474)', () => {
  test('cookie-only user (no legacy `bb_session` slot involved at all) still opens the stream, with the freshly minted stream token', async () => {
    const openCalls: string[] = []
    let getStreamTokenCalls = 0

    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken: () => {
        getStreamTokenCalls++
        return Promise.resolve({ stream_token: 'strm_fresh_1' })
      },
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => {
        throw new Error('should not schedule a retry on the happy path')
      },
      isCurrent: () => true,
    })

    expect(getStreamTokenCalls).toBe(1)
    expect(openCalls).toEqual([
      'http://test.local/api/v1/clients/sessions/live?token=strm_fresh_1',
    ])
  })

  test('logged-out visitor (user: null) → does NOT fetch a stream token and does NOT open the stream', async () => {
    let getStreamTokenCalls = 0
    const openCalls: string[] = []
    let scheduleRetryCalls = 0

    await attemptSessionSSEConnect({
      user: null,
      getStreamToken: () => {
        getStreamTokenCalls++
        return Promise.resolve({ stream_token: 'strm_should_not_be_used' })
      },
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => true,
    })

    expect(getStreamTokenCalls).toBe(0)
    expect(openCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(0)
  })

  test('a second, different stream token drives a different URL each call — the builder always uses whatever getStreamToken() just returned, never a cached/legacy value', async () => {
    const openCalls: string[] = []

    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken: () => Promise.resolve({ stream_token: 'strm_first' }),
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => {},
      isCurrent: () => true,
    })
    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken: () => Promise.resolve({ stream_token: 'strm_second' }),
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => {},
      isCurrent: () => true,
    })

    expect(openCalls).toEqual([
      'http://test.local/api/v1/clients/sessions/live?token=strm_first',
      'http://test.local/api/v1/clients/sessions/live?token=strm_second',
    ])
  })

  test('getStreamToken() rejects but isCurrent() is still true → scheduleRetry IS called (backoff reconnect, not a silent drop)', async () => {
    const openCalls: string[] = []
    let scheduleRetryCalls = 0

    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken: () => Promise.reject(new Error('network error')),
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => true,
    })

    expect(openCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(1)
  })
})

describe('attemptSessionSSEConnect() — the async race (task 1471\'s finding on PR #55, applied here per the 1474 brief)', () => {
  test('isCurrent() flips false WHILE getStreamToken() is pending → neither openSource nor scheduleRetry is called', async () => {
    let current = true
    const openCalls: string[] = []
    let scheduleRetryCalls = 0

    const getStreamToken = () =>
      new Promise<{ stream_token: string }>((resolve) => {
        // Simulate teardown (logout / unmount / a fresh connect superseding
        // this one) landing WHILE the token exchange is in flight.
        setTimeout(() => {
          current = false
          resolve({ stream_token: 'strm_stale' })
        }, 0)
      })

    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken,
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => current,
    })

    expect(openCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(0)
  })

  test('isCurrent() flips false WHILE getStreamToken() is pending and rejects → the catch path does not scheduleRetry either', async () => {
    let current = true
    const openCalls: string[] = []
    let scheduleRetryCalls = 0

    const getStreamToken = () =>
      new Promise<{ stream_token: string }>((_resolve, reject) => {
        setTimeout(() => {
          current = false
          reject(new Error('token exchange failed'))
        }, 0)
      })

    await attemptSessionSSEConnect({
      user: cookieUser(),
      getStreamToken,
      openSource: (url) => openCalls.push(url),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => current,
    })

    expect(openCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(0)
  })
})
