import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from 'bun:test'

/**
 * Task 1517 — Guus blocked on prod: every "Start trial" / Compare-plans
 * "Upgrade" click on an account that had already used its trial showed a
 * toast with the RAW JSON error body as its description instead of a clean
 * message, and `err.code` never matched `'trial_already_used'` so the
 * fallback-to-checkout branch never ran either.
 *
 * Root cause (verified against `repos/server/beebeeb-api/src/{trial.rs,
 * error.rs}`): `POST /billing/trial/start` and `/trial/convert` build their
 * 409 body as `ApiError::Conflict(json!({ "error": code, "message": msg
 * }).to_string())` — a PRE-JSON-ENCODED STRING. But `ApiError`'s generic
 * `Conflict(msg) => (StatusCode::CONFLICT, msg)` arm treats that string as a
 * plain message and wraps it in ANOTHER `{ "error": <string> }` with no
 * top-level `message` field at all. The actual wire body for
 * `trial_already_used` is therefore:
 *
 *   { "error": "{\"error\":\"trial_already_used\",\"message\":\"You have
 *                 already used your free trial on this account.\"}" }
 *
 * — `body.error` is itself a JSON string, and there is no `body.message`.
 *
 * `parseErrorBody` (packages/shared/src/api/errors.ts) now detects and
 * unwraps that double-encoded shape so `ApiError.code` /`.message` come out
 * clean regardless of whether the server bug above ever gets fixed at the
 * source. This suite pins the exact reproduction body captured from the live
 * server code path, plus the ordinary single-encoded shape (still the vast
 * majority of the API's typed errors) to prove the fix doesn't disturb it.
 */

// Mock the token module so request() doesn't touch localStorage (mirrors
// test/rate-limit-retry.test.ts's pattern for the same reason).
mock.module('../packages/shared/src/api/token', () => ({
  getToken: () => null,
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
}))

let nextResponse: { status: number; body: unknown } = { status: 200, body: {} }
const originalFetch = globalThis.fetch
const mockFetch = (async () => {
  return new Response(JSON.stringify(nextResponse.body), {
    status: nextResponse.status,
    headers: { 'content-type': 'application/json' },
  })
}) as unknown as typeof fetch

const { request, setApiUrl, ApiError, parseErrorBody } = await import(
  '../packages/shared/src/api/index'
)

setApiUrl('http://test.local')

describe('parseErrorBody() (1517)', () => {
  test('unwraps the double-JSON-encoded Conflict body from beebeeb-api trial endpoints', () => {
    // The EXACT body `ApiError::Conflict(json!({...}).to_string())` produces
    // via the generic `{ "error": message }` render path — captured by
    // reading repos/server/beebeeb-api/src/error.rs's fallback arm.
    const rawServerBody = {
      error:
        '{"error":"trial_already_used","message":"You have already used your free trial on this account."}',
    }
    const { code, message } = parseErrorBody(rawServerBody, 'Conflict')
    expect(code).toBe('trial_already_used')
    expect(message).toBe('You have already used your free trial on this account.')
    // Never the raw blob.
    expect(message).not.toContain('{"error"')
  })

  test('unwraps the trial_not_active / trial_already_subscribed convert-trial shape identically', () => {
    const rawServerBody = {
      error: '{"error":"trial_not_active","message":"Your trial is no longer active."}',
    }
    const { code, message } = parseErrorBody(rawServerBody, 'Conflict')
    expect(code).toBe('trial_not_active')
    expect(message).toBe('Your trial is no longer active.')
  })

  test('leaves the ordinary single-encoded { error, message } shape untouched', () => {
    const body = { error: 'quota_exceeded', message: 'Storage full.' }
    const { code, message } = parseErrorBody(body, 'fallback')
    expect(code).toBe('quota_exceeded')
    expect(message).toBe('Storage full.')
  })

  test('leaves a bare-code-as-message shape (the majority convention) untouched', () => {
    // e.g. ApiError::Conflict("already_redeemed".to_string()) → { "error": "already_redeemed" }
    const body = { error: 'already_redeemed' }
    const { code, message } = parseErrorBody(body, 'fallback')
    expect(code).toBe('already_redeemed')
    expect(message).toBe('already_redeemed')
  })

  test('a string that merely starts with "{" but is not valid JSON falls back safely', () => {
    const body = { error: '{not actually json' }
    const { code, message } = parseErrorBody(body, 'fallback')
    expect(code).toBe('{not actually json')
    expect(message).toBe('{not actually json')
  })

  test('falls back to the provided fallback message when body has neither field', () => {
    const { code, message } = parseErrorBody({}, 'Internal Server Error')
    expect(code).toBeUndefined()
    expect(message).toBe('Internal Server Error')
  })
})

describe('request() surfaces a clean ApiError for the double-encoded trial 409 (1517)', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })
  beforeEach(() => {
    nextResponse = { status: 200, body: {} }
  })

  test('POST /billing/trial/start 409 → ApiError.code === trial_already_used, clean .message', async () => {
    nextResponse = {
      status: 409,
      body: {
        error:
          '{"error":"trial_already_used","message":"You have already used your free trial on this account."}',
      },
    }
    let caught: unknown
    try {
      await request('/api/v1/billing/trial/start', { method: 'POST', body: '{}' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    const err = caught as InstanceType<typeof ApiError>
    expect(err.status).toBe(409)
    // This is the exact branch billing.tsx's handleStartTrial checks —
    // before the fix this never matched (code was the whole JSON string).
    expect(err.code === 'trial_already_used').toBe(true)
    expect(err.message).toBe('You have already used your free trial on this account.')
    // The specific regression: the raw JSON body must never end up as the
    // user-facing message.
    expect(err.message).not.toContain('{"error"')
    expect(err.message).not.toContain('\\"')
  })

  test('a normal single-encoded 409 (e.g. quota_exceeded-shaped) still works after the fix', async () => {
    nextResponse = {
      status: 409,
      body: { error: 'trial_has_active_subscription', message: 'You already have an active subscription.' },
    }
    let caught: unknown
    try {
      await request('/api/v1/billing/trial/start', { method: 'POST', body: '{}' })
    } catch (err) {
      caught = err
    }
    const err = caught as InstanceType<typeof ApiError>
    expect(err.code).toBe('trial_has_active_subscription')
    expect(err.message).toBe('You already have an active subscription.')
  })
})
