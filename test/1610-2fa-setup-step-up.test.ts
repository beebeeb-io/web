import { describe, expect, test, afterEach } from 'bun:test'
import { setup2fa, ApiError } from '../src/lib/api'

/**
 * Regression tests for task 1610 — `setup2fa()`'s request shape.
 *
 * Bug: settings/security.tsx's `TotpSection` (and the client) always POSTed
 * `/api/v1/auth/2fa/setup` with no body and no `X-Confirm-Token`. Once an
 * account already has 2FA on, the server requires step-up before it will
 * replace the live secret (`routes/totp.rs` `setup_step_up_validated_if_required`
 * — server behavior verified correct, NOT loosened by this task): either the
 * current TOTP/backup code as `body.code`, or a step-up `X-Confirm-Token`
 * (the same `confirmAction()`/`<StepUpAuth>` pattern task 1493 built for
 * adding a passkey). These tests assert the CLIENT side of that contract at
 * the HTTP level — what actually leaves the browser — mirroring
 * `1493-passkey-add-step-up.test.ts`'s pattern exactly.
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

const SETUP_OK = { secret: 'JBSWY3DPEHPK3PXP', qr_uri: 'otpauth://totp/x', backup_codes: ['12345678'] }

describe('setup2fa (task 1610)', () => {
  test('called bare (fresh enrollment, 2FA off): no body content, no X-Confirm-Token — unchanged behavior', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: SETUP_OK }))

    await setup2fa()

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/2fa/setup')
    expect(calls[0].body).toBeUndefined()
    expect(calls[0].headers['X-Confirm-Token']).toBeUndefined()
  })

  test('called with a code: body carries it, no X-Confirm-Token', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: SETUP_OK }))

    await setup2fa({ code: '654321' })

    expect(calls[0].body).toEqual({ code: '654321' })
    expect(calls[0].headers['X-Confirm-Token']).toBeUndefined()
  })

  test('called with a confirmToken: X-Confirm-Token header carries it, no body', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: SETUP_OK }))

    await setup2fa({ confirmToken: 'tok-xyz' })

    expect(calls[0].body).toBeUndefined()
    expect(calls[0].headers['X-Confirm-Token']).toBe('tok-xyz')
  })

  test('a bare call against an already-enabled account surfaces the 403 as ApiError with code=confirmation_required (never silently swallowed)', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 403,
      body: { error: 'confirmation_required', message: 'This action requires password confirmation' },
    }))

    let caught: unknown
    try {
      await setup2fa()
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(403)
    expect((caught as ApiError).code).toBe('confirmation_required')
  })

  test('a wrong code surfaces the 400 as ApiError with code=invalid_totp_code', async () => {
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 400,
      body: { error: 'invalid_totp_code', message: "That code didn't match. Check your authenticator app and try again." },
    }))

    let caught: unknown
    try {
      await setup2fa({ code: '000000' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('invalid_totp_code')
  })
})
