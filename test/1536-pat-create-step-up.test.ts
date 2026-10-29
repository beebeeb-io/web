import { describe, expect, test, afterEach } from 'bun:test'
import { createToken, ApiError } from '../src/lib/api'

/**
 * Regression tests for task 1536 (web half, companion to server PR #98,
 * head ffe69bb648ac92fd064568c5ffd51297d4f015d6).
 *
 * The server (task 1536 finding 2) now requires a fresh `X-Confirm-Token` on
 * `POST /api/v1/tokens` for SESSION-authenticated callers (403
 * `confirmation_required` without one) — PAT-authenticated callers stay
 * exempt (a PAT rotating itself has no `sessions` row to re-confirm
 * against). The web app always authenticates via session, never a bare PAT,
 * so it must always obtain and send that header once the fix lands.
 *
 * These assert the CLIENT side at the HTTP level — what actually leaves the
 * browser — independent of the step-up modal itself (`StepUpAuth`, already
 * covered by its own 1493 tests). Wiring `StepUpAuth` into developer.tsx's
 * preserved "Create token" flow is the other half of this fix.
 */

interface CapturedCall {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
}

function capturingFetch(
  calls: CapturedCall[],
  responder: (url: string) => { status: number; body: unknown },
) {
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

describe('createToken carries X-Confirm-Token when given one (task 1536)', () => {
  test('the header carries the confirm token', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 201,
      body: { id: 'tok-1', token: 'bb_pat_xyz', name: 'CI', scopes: ['files:read'], expires_at: null },
    }))

    const res = await createToken(
      { name: 'CI', scopes: ['files:read'], expires_in_days: null },
      'confirm-token-abc',
    )

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/tokens')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers['X-Confirm-Token']).toBe('confirm-token-abc')
    expect(res.token).toBe('bb_pat_xyz')
  })

  test('omitting the token sends no X-Confirm-Token header — harmless against the CURRENT server, which never reads it', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 201,
      body: { id: 'tok-2', token: 'bb_pat_abc', name: 'no-token-case', scopes: [], expires_at: null },
    }))

    await createToken({ name: 'no-token-case', scopes: [], expires_in_days: null })

    expect(calls.length).toBe(1)
    expect('X-Confirm-Token' in calls[0].headers).toBe(false)
  })

  test('a 403 confirmation_required surfaces as ApiError with that code and the server\'s own honest message', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 403,
      body: { error: 'confirmation_required', message: 'This action requires password confirmation' },
    }))

    let caught: unknown
    try {
      await createToken({ name: 'x', scopes: [], expires_in_days: null }, 'stale-or-reused-token')
    } catch (err) {
      caught = err
    }

    expect(calls.length).toBe(1)
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(403)
    expect((caught as ApiError).code).toBe('confirmation_required')
    expect((caught as ApiError).message).toBe('This action requires password confirmation')
  })
})
