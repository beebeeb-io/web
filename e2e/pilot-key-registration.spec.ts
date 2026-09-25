import { test, expect } from '@playwright/test'
import { PILOT_KEY, createAccount, fillSignupForm, reachPasswordStep, retrySignupWithPilotKey } from './helpers/signup'

/**
 * E2E regression test for task 1411, updated for task 1520.
 *
 * With the server's pilot signup gate ON (`BB_REQUIRE_PILOT_KEY=1`,
 * `BB_PILOT_SIGNUP_KEY=<key>`), the pilot access key must ride on EVERY
 * registration request — `opaque/register-start` AND `opaque/register-finish`
 * (both are re-checked server-side, `beebeeb-api/src/routes/opaque_auth.rs`).
 * Before the 1411 fix, `opaqueRegisterFinish` never sent the header, so the
 * final "Create account" call 403'd with `pilot_key_required` AFTER the user
 * had already generated + verified their recovery phrase and set a password.
 *
 * Task 1520 changed WHEN the key is even collected: prod itself now runs
 * gate-OFF (BB_REQUIRE_PILOT_KEY=0, launched) and /signup shows no pilot-key
 * field by default (src/lib/signup-pilot-gate.ts). The field — and this
 * whole flow — is now a ROLLBACK SAFETY NET, reachable only by actually
 * hitting a live gate-on API: /signup submits with NO key, onboarding's
 * register-start 403s (`pilot_key_required`), bounces back to /signup with
 * the field now visible + required, and ONLY THEN does the user enter a key
 * and go through recovery-phrase generation etc. a second time (a fresh
 * mount discards the first phrase). Both tests below now drive that full
 * two-round-trip flow.
 *
 * Run against a LOCAL API started with the gate ON, e.g.:
 *   BB_REQUIRE_PILOT_KEY=1 BB_PILOT_SIGNUP_KEY=test-pilot-key cargo run -p beebeeb-api
 * (a fresh DB, so email-uniqueness/rate limits don't collide with other runs).
 * Point Playwright at it explicitly if it isn't on the default :3001/:5173, e.g.:
 *   E2E_API_URL=http://localhost:3011 E2E_WEB_URL=http://localhost:5183 \
 *     bunx playwright test e2e/pilot-key-registration.spec.ts
 * Set BB_TEST_PILOT_KEY to override the expected-correct key (defaults to
 * 'test-pilot-key', matching the value above). The isolated CI harness
 * (`e2e/scripts/web-e2e.sh`) passes BB_REQUIRE_PILOT_KEY/BB_PILOT_SIGNUP_KEY
 * through to the API it spawns when the CALLER sets them — its default run
 * (gate off, matching prod, task 1520) skips this spec's tests rather than
 * false-passing/false-failing; see the gate probe below.
 *
 * GATE PROBE (review fix, task 1411): the CI harness's default glob includes
 * this spec, and by default it starts the API with the gate OFF — against an
 * ungated API the wrong-key test would fail (nothing rejects a "wrong" key
 * when the gate is off) and the correct-key test would prove nothing about
 * the header actually being required. `beforeAll` probes the live API
 * directly (an unauthenticated register-start with NO key) and every test
 * self-skips when the gate isn't enforced, so a gate-off run reports SKIPPED
 * — never a false pass or a false fail.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:3001'
const uniqueEmail = () =>
  `e2e-pilot-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`
const PASSWORD = 'CorrectHorseBattery9!'

/**
 * True iff the server currently enforces the pilot-key gate. POSTs
 * register-start for a throwaway email with NO `X-Beebeeb-Pilot-Key` header
 * and a dummy (invalid) `client_message`. Gate ON rejects this BEFORE any
 * OPAQUE work runs — 403 `pilot_key_required` — regardless of the garbage
 * client_message (`check_pilot_gate` runs first in `register_start`, see
 * `opaque_auth.rs`). Gate OFF falls through to the OPAQUE decode and returns
 * something else (typically 400 `invalid base64 client_message`).
 */
async function pilotGateIsOn(): Promise<boolean> {
  const res = await fetch(`${API}/api/v1/opaque/register-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `gate-probe-${Date.now()}@beebeeb.io`,
      client_message: 'not-valid-base64-opaque-message',
    }),
  })
  if (res.status !== 403) return false
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error === 'pilot_key_required'
}

test.describe('Pilot key gate — full registration flow (task 1411)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  let gateOn = false

  test.beforeAll(async () => {
    gateOn = await pilotGateIsOn()
  })

  test.beforeEach(async ({ page }) => {
    // Self-skip (not a false pass/fail) when the API isn't actually enforcing
    // the gate — see the GATE PROBE note at the top of the file.
    test.skip(
      !gateOn,
      'pilot gate is OFF on this API — start it with BB_REQUIRE_PILOT_KEY=1 BB_PILOT_SIGNUP_KEY=test-pilot-key',
    )
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })

  test('correct pilot key: full sign-up (recovery phrase -> verify -> password -> Create account) lands in the vault', async ({
    page,
  }) => {
    const email = uniqueEmail()

    // Round 1: /signup shows no field by default (task 1520) — submit email
    // only, go all the way through the recovery-phrase flow, and get
    // rejected at Create Account for having no key.
    await fillSignupForm(page, { email })
    await reachPasswordStep(page)
    await createAccount(page, PASSWORD)
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })

    // Round 2: field is now visible (bounced back with pilotKeyError). Fill
    // the CORRECT key and redo the flow from a fresh mount (new phrase).
    await retrySignupWithPilotKey(page, PILOT_KEY)
    await reachPasswordStep(page)
    await createAccount(page, PASSWORD)

    // Reaching the drive proves BOTH register-start AND register-finish
    // succeeded with the pilot key attached — the exact regression this test
    // guards (pre-fix, register-finish 403'd here with pilot_key_required).
    // toHaveURL matches against the FULL url (origin + path), not just the
    // path — match "/" at the end of the origin, optionally followed by a
    // query/hash, rather than anchoring on a bare leading "/".
    await expect(page).toHaveURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
      .toBe('/')

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'bb_session')).toBe(true)
  })

  test('wrong pilot key: registration is rejected with the typed message and the account is never created', async ({
    page,
  }) => {
    const email = uniqueEmail()

    // Round 1: no field by default (task 1520) — submit email only and get
    // bounced back for having no key at all.
    await fillSignupForm(page, { email })
    await reachPasswordStep(page)
    await createAccount(page, PASSWORD)
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })

    // Round 2: field is now visible. Enter the WRONG key and redo the flow.
    await retrySignupWithPilotKey(page, 'definitely-the-wrong-key')
    await reachPasswordStep(page)
    await createAccount(page, PASSWORD)

    // Bounced back to /signup AGAIN, this time with the server's typed
    // wrong-key message inline next to the key field (onboarding.tsx's 403
    // pilot_key_required handler sets pilotKeyError, which signup.tsx passes
    // to BBInput's `error` prop on the pilot-key-input field, which is now
    // shown since navState.pilotKeyError is set again).
    //
    // MUST be scoped to that field's own error <p>, not any <p> on the page
    // — the field's own static notice ("Pilot access key required...") also
    // renders whenever the field does and overlaps "pilot"/"access key", so
    // an unscoped text filter would pass even when the typed error never
    // rendered (review finding, task 1411 PR #35). BBInput renders `error`
    // as a <p> that is a sibling of the input's wrapper div, i.e. the
    // input's grandparent's child — see packages/shared/src/design/bb-input.tsx.
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })
    const pilotError = page.getByTestId('pilot-key-input').locator('xpath=../../p')
    await expect(pilotError).toBeVisible({ timeout: 5_000 })
    // Real server copy (repos/server/beebeeb-api/src/error.rs,
    // ApiError::PilotKeyRequired) — identical whether the key was missing
    // or wrong (pilot_gate::evaluate doesn't distinguish the two).
    await expect(pilotError).toHaveText(/a pilot access key is required to sign up/i)

    // Never authenticated, never reached the drive — no account was created.
    expect(new URL(page.url()).pathname).not.toBe('/')
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'bb_session')).toBe(false)
  })
})
