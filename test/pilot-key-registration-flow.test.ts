import { describe, expect, test, afterEach } from 'bun:test'
import { opaqueRegisterStart, opaqueRegisterFinish } from '../src/lib/api'

/**
 * Regression test for task 1411.
 *
 * With the server's pilot signup gate ON (`BB_REQUIRE_PILOT_KEY=1`), BOTH
 * `POST /api/v1/opaque/register-start` AND `POST /api/v1/opaque/register-finish`
 * re-check the `X-Beebeeb-Pilot-Key` header (`beebeeb-api/src/routes/opaque_auth.rs`
 * — `check_pilot_gate` runs at both call sites; see `pilot_gate.rs`). Before the
 * fix, `opaqueRegisterFinish` had no `pilotKey` parameter at all, so the header
 * was silently dropped on the final "Create account" request — the account was
 * rejected 403 `pilot_key_required` after the user had already generated and
 * verified their recovery phrase, and the app bounced them back to /signup with
 * an empty email field.
 *
 * This test asserts EVERY registration request in the flow carries the header
 * when a pilot key is supplied — not just register-start.
 */

const PILOT_KEY = 'test-pilot-key'
const HEADER = 'X-Beebeeb-Pilot-Key'

function capturingFetch(calls: { url: string; headers: Record<string, string> }[], body: unknown) {
  return (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers as Record<string, string> | undefined) ?? {}
    calls.push({ url: String(url), headers })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('pilot access key must ride on every registration request (task 1411)', () => {
  test('register-start sends X-Beebeeb-Pilot-Key', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    globalThis.fetch = capturingFetch(calls, { server_message: 'AAAA' })

    await opaqueRegisterStart('pilot@beebeeb.io', 'Y2xpZW50LW1lc3NhZ2U=', PILOT_KEY)

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/opaque/register-start')
    expect(calls[0].headers[HEADER]).toBe(PILOT_KEY)
  })

  test('register-finish ALSO sends X-Beebeeb-Pilot-Key (the request that was dropping it)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    globalThis.fetch = capturingFetch(calls, { user_id: 'u1', session_token: 'tok' })

    await opaqueRegisterFinish(
      'pilot@beebeeb.io',
      'cmVnaXN0cmF0aW9uLXVwbG9hZA==', // client_message
      'eDI1NTE5LXB1Yg==', // x25519PublicKey
      'cmVjb3ZlcnktY2hlY2s=', // recoveryCheck
      undefined, // referralSource
      undefined, // referralSharerId
      undefined, // referralCode
      PILOT_KEY,
    )

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/opaque/register-finish')
    expect(calls[0].headers[HEADER]).toBe(PILOT_KEY)
  })

  test('a full start -> finish round trip carries the SAME key on BOTH requests', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string> | undefined) ?? {}
      calls.push({ url: String(url), headers })
      const body = String(url).includes('register-start')
        ? { server_message: 'AAAA' }
        : { user_id: 'u1', session_token: 'tok' }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    await opaqueRegisterStart('pilot@beebeeb.io', 'Y2xpZW50LW1lc3NhZ2U=', PILOT_KEY)
    await opaqueRegisterFinish(
      'pilot@beebeeb.io',
      'cmVnaXN0cmF0aW9uLXVwbG9hZA==',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      PILOT_KEY,
    )

    expect(calls.length).toBe(2)
    for (const call of calls) {
      expect(call.headers[HEADER]).toBe(PILOT_KEY)
    }
  })

  test('no key supplied -> no header sent on either request (gate-off / no-pilot-cohort behavior unchanged)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    globalThis.fetch = capturingFetch(calls, { server_message: 'AAAA' })
    await opaqueRegisterStart('nopilot@beebeeb.io', 'Y2xpZW50LW1lc3NhZ2U=')
    expect(calls[0].headers[HEADER]).toBeUndefined()

    calls.length = 0
    globalThis.fetch = capturingFetch(calls, { user_id: 'u1', session_token: 'tok' })
    await opaqueRegisterFinish('nopilot@beebeeb.io', 'cmVnaXN0cmF0aW9uLXVwbG9hZA==')
    expect(calls[0].headers[HEADER]).toBeUndefined()
  })
})
