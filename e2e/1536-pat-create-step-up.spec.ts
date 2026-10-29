import { test, expect, type Page } from '@playwright/test'

/**
 * Task 1536 — real-stack proof of the POST-server-#98 contract for
 * `POST /api/v1/tokens` (server 6561bf4, beebeeb-api/src/routes/tokens.rs):
 * a SESSION-authenticated caller must present a fresh, single-use
 * `X-Confirm-Token` minted by the step-up endpoint (`POST /api/v1/auth/confirm`)
 * before the server will mint a personal access token. A stolen session could
 * otherwise mint a durable, full-account PAT that survives the victim's own
 * password change.
 *
 * The contract, as enforced by `consume_confirmation_from_headers`
 * (beebeeb-api/src/confirmation.rs):
 *   - no `X-Confirm-Token` header            -> 403 {"error":"confirmation_required"}
 *   - a header that is not a live confirmation -> 403 {"error":"confirmation_required"}
 *   - a valid token from /auth/confirm        -> 201 with a `bb_pat_...` token
 *   - that same token spent a second time     -> 403 (confirmations are single-use)
 * and a refused request must not have minted anything (checked against the
 * server's own `GET /api/v1/tokens` list).
 *
 * History: this file previously asserted the PRE-#98 behaviour (201 with and
 * without the header). Once #98 merged, both of those tests went red against
 * server main — the server was right, the spec was stale.
 *
 * Driven via `page.request`, which shares the browser context's cookie jar
 * (the httpOnly `bb_session` cookie that `credentials: 'include'` relies on),
 * i.e. the same authenticated session the app itself would use. The dev-only
 * `/dev/auto-login` account has a real Argon2id password (`DEV_PASSWORD` in
 * beebeeb-api/src/routes/dev.rs), so the password step-up branch runs a real
 * `/auth/confirm` round trip — same pattern as e2e/1493-passkey-add-step-up.spec.ts.
 *
 * The step-up dialog's wiring in developer.tsx is not exercised here: Settings ->
 * Developer is a "Coming soon" placeholder (commit 85c8fdc) with no live
 * "Create token" button. createToken()'s header plumbing and its honest 403
 * message are covered by the unit test test/1536-pat-create-step-up.test.ts.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const DEV_PASSWORD = 'devdevdevdevdev!'

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 10_000 })
    .toBe(true)
}

function uniqueDevEmail(label: string): string {
  return `pat-e2e-1536-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`
}

/** Mint a fresh single-use step-up confirmation token for the page's session. */
async function stepUp(page: Page): Promise<string> {
  const res = await page.request.post(`${API_URL}/api/v1/auth/confirm`, {
    data: { password: DEV_PASSWORD },
  })
  expect(res.status(), `POST /api/v1/auth/confirm: ${res.status()} ${await res.text()}`).toBe(200)
  const body = (await res.json()) as { confirmation_token: string }
  expect(body.confirmation_token, 'step-up returned an empty confirmation_token').toBeTruthy()
  return body.confirmation_token
}

/** Ground truth: the PAT names the server holds for this account. */
async function listTokenNames(page: Page): Promise<string[]> {
  const res = await page.request.get(`${API_URL}/api/v1/tokens`)
  expect(res.status(), `GET /api/v1/tokens: ${res.status()} ${await res.text()}`).toBe(200)
  const body = (await res.json()) as { tokens: { name: string }[] }
  return body.tokens.map((t) => t.name)
}

async function expectConfirmationRequired(
  res: Awaited<ReturnType<Page['request']['post']>>,
  label: string,
): Promise<void> {
  const text = await res.text()
  expect(res.status(), `POST /api/v1/tokens ${label}: ${res.status()} ${text}`).toBe(403)
  expect((JSON.parse(text) as { error?: string }).error, `POST /api/v1/tokens ${label}: ${text}`).toBe(
    'confirmation_required',
  )
}

test.describe('task 1536: creating a PAT from a session requires a step-up confirmation (post-server-#98)', () => {
  test('WITHOUT an X-Confirm-Token header -> 403 confirmation_required, and no token is minted', async ({
    page,
  }) => {
    await devLogin(page, uniqueDevEmail('noheader'))

    const res = await page.request.post(`${API_URL}/api/v1/tokens`, {
      data: { name: 'e2e-1536-no-header', scopes: [], expires_in_days: null },
    })
    await expectConfirmationRequired(res, 'with no header')

    expect(await listTokenNames(page)).toEqual([])
  })

  test('with a FORGED X-Confirm-Token -> 403 confirmation_required, and no token is minted', async ({ page }) => {
    await devLogin(page, uniqueDevEmail('forged'))

    const res = await page.request.post(`${API_URL}/api/v1/tokens`, {
      headers: { 'X-Confirm-Token': 'not-a-real-confirmation-token-at-all' },
      data: { name: 'e2e-1536-forged', scopes: [], expires_in_days: null },
    })
    await expectConfirmationRequired(res, 'with a forged X-Confirm-Token')

    expect(await listTokenNames(page)).toEqual([])
  })

  test('with a valid step-up token -> 201; the same token cannot be spent twice', async ({ page }) => {
    await devLogin(page, uniqueDevEmail('stepup'))

    const confirmToken = await stepUp(page)

    const res = await page.request.post(`${API_URL}/api/v1/tokens`, {
      headers: { 'X-Confirm-Token': confirmToken },
      data: { name: 'e2e-1536-step-up', scopes: [], expires_in_days: null },
    })
    expect(res.status(), `POST /api/v1/tokens with a valid X-Confirm-Token: ${res.status()} ${await res.text()}`).toBe(
      201,
    )
    const body = (await res.json()) as { token: string; name: string }
    expect(body.name).toBe('e2e-1536-step-up')
    expect(body.token).toMatch(/^bb_pat_/)

    // Single-use: replaying the consumed confirmation must be refused.
    const replay = await page.request.post(`${API_URL}/api/v1/tokens`, {
      headers: { 'X-Confirm-Token': confirmToken },
      data: { name: 'e2e-1536-replay', scopes: [], expires_in_days: null },
    })
    await expectConfirmationRequired(replay, 'replaying a spent X-Confirm-Token')

    expect(await listTokenNames(page)).toEqual(['e2e-1536-step-up'])
  })
})
