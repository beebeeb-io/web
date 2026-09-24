import { describe, expect, test, afterEach } from 'bun:test'
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  confirmPasskey,
  ApiError,
} from '../src/lib/api'

/**
 * Regression tests for task 1493 (web half).
 *
 * The server (task 1493, server PR #85) now:
 *   - requires a fresh `X-Confirm-Token` on `register-start` (403
 *     `confirmation_required` without one) — a bare session can no longer
 *     add a persistent sign-in passkey on its own;
 *   - holds the registration challenge server-side and returns an opaque
 *     `reg_id` instead of a client-editable `reg_state` blob;
 *   - silently ignores any `reg_state` field a client still sends (no
 *     `#[serde(deny_unknown_fields)]`), so the client must actually stop
 *     sending it, not just add the new field alongside it.
 *
 * These tests assert the CLIENT side of that contract at the HTTP level —
 * what headers/body actually leave the browser — independent of the
 * WebAuthn ceremony itself (covered by the Playwright e2e with a CDP
 * virtual authenticator).
 */

interface CapturedCall {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
}

function capturingFetch(calls: CapturedCall[], responder: (url: string) => { status: number; body: unknown }) {
  return (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers as Record<string, string> | undefined) ?? {}
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: String(url), method: init?.method, headers, body })
    const { status, body: respBody } = responder(String(url))
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('startPasskeyRegistration sends X-Confirm-Token (task 1493)', () => {
  test('the header carries the confirm token', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { publicKey: { challenge: 'AAAA' }, reg_id: 'reg-abc-123' },
    }))

    const res = await startPasskeyRegistration('confirm-token-xyz')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/passkey/register-start')
    expect(calls[0].headers['X-Confirm-Token']).toBe('confirm-token-xyz')
    // Response round-trips the new reg_id field (was reg_state).
    expect(res.reg_id).toBe('reg-abc-123')
  })

  test('a 403 confirmation_required surfaces as ApiError with that code', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 403,
      body: { error: 'confirmation_required' },
    }))

    let caught: unknown
    try {
      await startPasskeyRegistration('stale-or-missing-token')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(403)
    expect((caught as ApiError).code).toBe('confirmation_required')
  })
})

describe('finishPasskeyRegistration sends reg_id, never reg_state (task 1493)', () => {
  const fakeCredential = {
    id: 'cred-id',
    rawId: 'cred-raw-id',
    type: 'public-key',
    response: { attestationObject: 'attobj', clientDataJSON: 'cdj' },
    extensions: {},
  }

  test('body carries reg_id and omits reg_state entirely', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 201,
      body: { id: 'passkey-1', name: 'My device', created_at: '2026-09-24T00:00:00Z' },
    }))

    await finishPasskeyRegistration(fakeCredential, 'reg-abc-123', 'My device')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/passkey/register-finish')
    const body = calls[0].body as Record<string, unknown>
    expect(body.reg_id).toBe('reg-abc-123')
    expect(body.credential).toEqual(fakeCredential)
    expect(body.name).toBe('My device')
    expect('reg_state' in body).toBe(false)
  })

  test('a start -> finish round trip carries the SAME reg_id, not the discarded reg_state shape', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string> | undefined) ?? {}
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      calls.push({ url: String(url), headers, body })
      const respBody = String(url).includes('register-start')
        ? { publicKey: { challenge: 'AAAA' }, reg_id: 'reg-roundtrip-789' }
        : { id: 'passkey-2', name: 'CLI handoff', created_at: '2026-09-24T00:00:00Z' }
      return new Response(JSON.stringify(respBody), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const startRes = await startPasskeyRegistration('confirm-token-xyz')
    await finishPasskeyRegistration(fakeCredential, startRes.reg_id, 'CLI handoff')

    expect(calls.length).toBe(2)
    expect(calls[0].headers['X-Confirm-Token']).toBe('confirm-token-xyz')
    const finishBody = calls[1].body as Record<string, unknown>
    expect(finishBody.reg_id).toBe('reg-roundtrip-789')
    expect('reg_state' in finishBody).toBe(false)
  })
})

describe('confirmPasskey (task 1493 passkey-only step-up) hits the confirm-passkey endpoints', () => {
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator

  afterEach(() => {
    ;(globalThis as { navigator?: unknown }).navigator = originalNavigator
  })

  test('start call carries auth + credentials; a cancelled ceremony throws without ever calling finish', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { publicKey: { challenge: 'BBBB' }, auth_state: 'state-token' },
    }))
    ;(globalThis as { navigator: unknown }).navigator = {
      credentials: {
        // Simulates the user cancelling the WebAuthn prompt (returns null).
        get: async () => null,
      },
    }

    let caught: unknown
    try {
      await confirmPasskey()
    } catch (err) {
      caught = err
    }

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/confirm-passkey-start')
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).message).toContain('cancelled')
  })
})
