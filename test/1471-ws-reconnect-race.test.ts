import { describe, expect, test } from 'bun:test'

/**
 * Task 1471 — Codex review finding on PR #55 (thread PRRT_kwDOSLX6Nc6k3xUz,
 * src/hooks/use-websocket.ts:31).
 *
 * `connect()` awaits `getStreamToken()` before opening the WebSocket. If
 * `enabled` flips to `false` while that await is in flight — the user logs
 * out, or this tab loses the BroadcastChannel leader election — the effect's
 * cleanup (`disconnect()`) runs, but the in-flight `connect()` continuation
 * had already captured its decision to proceed *before* the await and had
 * no way to observe the teardown. It could still open a WebSocket after
 * cleanup, or its `catch` branch could install a reconnect timer while
 * disabled — leaving a logged-out/follower tab receiving events or
 * repeatedly requesting stream tokens.
 *
 * `attemptConnect` is the extracted, directly-testable async decision
 * `connect()` makes once the token exchange settles (mirrors `shouldOpenWs`
 * in ws-context.tsx / `startPlanCheckout` in pricing.tsx — no React
 * rendering harness in this repo's `bun test` setup, see
 * 1471-ws-context-auth-gate.test.ts's header comment). It takes its
 * effects as injected functions so the race can be driven deterministically
 * without a real WebSocket or timer.
 */

const { attemptConnect } = await import('../src/hooks/use-websocket')

describe('attemptConnect() — bails after the token-exchange await if the connection is no longer current (task 1471)', () => {
  test('isCurrent() flips false WHILE getStreamToken() is pending → neither openSocket nor scheduleRetry is called', async () => {
    let current = true
    const openSocketCalls: string[] = []
    let scheduleRetryCalls = 0

    const getStreamToken = () =>
      new Promise<{ stream_token: string }>((resolve) => {
        // Simulate cleanup (logout / leader loss) landing WHILE the token
        // exchange is in flight — the exact race in the finding.
        setTimeout(() => {
          current = false
          resolve({ stream_token: 'tok_123' })
        }, 0)
      })

    await attemptConnect({
      getStreamToken,
      openSocket: (token) => openSocketCalls.push(token),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => current,
    })

    expect(openSocketCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(0)
  })

  test('isCurrent() flips false WHILE getStreamToken() is pending and rejects → the catch path does not scheduleRetry either', async () => {
    let current = true
    const openSocketCalls: string[] = []
    let scheduleRetryCalls = 0

    const getStreamToken = () =>
      new Promise<{ stream_token: string }>((_resolve, reject) => {
        setTimeout(() => {
          current = false
          reject(new Error('token exchange failed'))
        }, 0)
      })

    await attemptConnect({
      getStreamToken,
      openSocket: (token) => openSocketCalls.push(token),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => current,
    })

    expect(openSocketCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(0)
  })

  test('happy path — isCurrent() stays true throughout → openSocket IS called with the exchanged token', async () => {
    const openSocketCalls: string[] = []
    let scheduleRetryCalls = 0

    await attemptConnect({
      getStreamToken: () => Promise.resolve({ stream_token: 'tok_456' }),
      openSocket: (token) => openSocketCalls.push(token),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => true,
    })

    expect(openSocketCalls).toEqual(['tok_456'])
    expect(scheduleRetryCalls).toBe(0)
  })

  test('happy path — token exchange rejects but isCurrent() is still true → scheduleRetry IS called (existing backoff behaviour preserved)', async () => {
    const openSocketCalls: string[] = []
    let scheduleRetryCalls = 0

    await attemptConnect({
      getStreamToken: () => Promise.reject(new Error('network error')),
      openSocket: (token) => openSocketCalls.push(token),
      scheduleRetry: () => { scheduleRetryCalls++ },
      isCurrent: () => true,
    })

    expect(openSocketCalls).toEqual([])
    expect(scheduleRetryCalls).toBe(1)
  })
})
