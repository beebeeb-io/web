import { test, expect, type Page } from '@playwright/test'

/**
 * Task 1493 (web half) — adding a passkey now requires a fresh step-up
 * before the server will issue a registration challenge (server PR #85,
 * branch fix/1493-passkey-register-server-state-step-up).
 *
 * Runs against an ISOLATED stack the task brief asked for — NOT the shared
 * dev API on :3001:
 *   - server built from the 1493 branch, scratch DB `bb_1493_e2e2`, on :3101
 *   - this repo's own `bunx vite` on :5273 (VITE_API_URL pinned via
 *     `.env.development.local` — NOT `.env.local`: Vite 6's precedence is
 *     `.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local`, so a bare
 *     `.env.local` is silently overridden by the committed
 *     `.env.development`)
 *
 * Each test authenticates via the dev-only `/dev/auto-login` bypass with a
 * unique `?dev_email=` so tests never share account state. That account has
 * a real Argon2id password (`devdevdevdevdev!`, `DEV_PASSWORD` in
 * beebeeb-api/src/routes/dev.rs) — enough to exercise the PASSWORD step-up
 * branch of `StepUpAuth` end to end with a real `/auth/confirm` round trip.
 *
 * A CDP virtual authenticator (WebAuthn.addVirtualAuthenticator,
 * automaticPresenceSimulation: true) stands in for a platform authenticator
 * for BOTH the step-up-required registration ceremony itself and (in the
 * companion server-side tests) any assertion ceremony.
 *
 * Test 2's row-count assertion counts `data-testid="passkey-row"`
 * (settings/security.tsx), plus the server's own `/api/v1/auth/passkeys`
 * list and the register-start/register-finish request counts — see that
 * test's comments for why the original `text=Added` locator was unsound.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5273'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'
const DEV_PASSWORD = 'devdevdevdevdev!'

async function addVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 10_000 })
    .toBe(true)
  // Suppress first-run overlays that would otherwise intercept clicks.
  await page.evaluate(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
}

function uniqueDevEmail(label: string): string {
  return `passkey-e2e-1493-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`
}

/**
 * Ground truth for "how many passkeys does this account actually have":
 * the server's own list endpoint, called with the page's own session cookie
 * (`page.request` shares the browser context's cookie jar, including the
 * httpOnly `bb_session` cookie `credentials: 'include'` relies on in the
 * app itself). This is what test 2's row-count assertion is checked
 * against — a DOM locator alone proved unreliable (see below).
 */
async function fetchPasskeyCount(page: Page): Promise<number> {
  const res = await page.request.get(`${API_URL}/api/v1/auth/passkeys`)
  expect(res.ok(), `GET /api/v1/auth/passkeys failed: ${res.status()} ${await res.text()}`).toBe(true)
  const body = (await res.json()) as { passkeys: unknown[] }
  return body.passkeys.length
}

test.describe('task 1493: adding a passkey requires step-up', () => {
  test('clicking "Add passkey" shows the confirm prompt, not an error (no step-up token yet)', async ({
    page,
  }) => {
    await addVirtualAuthenticator(page)
    await devLogin(page, uniqueDevEmail('noconfirm'))

    await page.goto(`${WEB_URL}/settings/security`)
    await page.getByRole('button', { name: 'Add passkey' }).click()

    // The step-up modal must appear — this is the honest "confirm your
    // identity" prompt, never a raw 403/"confirmation_required" error toast.
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible()
    await expect(page.getByText(/confirmation_required/i)).toHaveCount(0)
    await expect(page.getByText(/failed to add passkey/i)).toHaveCount(0)

    // Cancelling must not have hit register-start at all (no ceremony, no
    // toast of any kind) — just closes the modal.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toHaveCount(0)
  })

  test('add passkey via settings with a PASSWORD step-up -> success', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await devLogin(page, uniqueDevEmail('pwstepup'))
    await page.goto(`${WEB_URL}/settings/security`)

    // Row-count locator: `data-testid="passkey-row"` (settings/security.tsx),
    // NOT `text=Added` — that locator was a false lead. Playwright's
    // unquoted `text=` engine is a case-insensitive SUBSTRING match, so
    // `text=Added` also matched the success toast's title, "Passkey added"
    // (lowercase "added" inside it). `.locator('..')` on the toast's text
    // node resolves to a real DOM element too, so the count came out one
    // too high FOR AS LONG AS THE TOAST WAS STILL ON SCREEN — a timing-
    // dependent false failure, not a real double registration (see the
    // network- and server-side counts below, which are the actual proof).
    const passkeyRows = page.getByTestId('passkey-row')
    const initialCount = await passkeyRows.count()
    const initialServerCount = await fetchPasskeyCount(page)

    // Proves or disproves a real double registration: exactly one
    // register-start and one register-finish call must reach the server
    // for a single "Add passkey" click, however many times React re-renders
    // or the toast substring-matches something.
    const registerStartRequests: string[] = []
    const registerFinishRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.endsWith('/api/v1/auth/passkey/register-start')) registerStartRequests.push(url)
      if (url.endsWith('/api/v1/auth/passkey/register-finish')) registerFinishRequests.push(url)
    })

    await page.getByRole('button', { name: 'Add passkey' }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible()

    await page.getByLabel('Password').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step-up succeeds -> register-start (now WITH X-Confirm-Token) ->
    // navigator.credentials.create against the virtual authenticator ->
    // register-finish with the server-issued reg_id -> onAdded.
    await expect(page.getByText('Passkey added')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toHaveCount(0)

    // A new passkey row is now listed, by a locator that cannot alias the
    // toast (data-testid is scoped to the row element only).
    await expect(passkeyRows).toHaveCount(initialCount + 1)

    // Ground truth: the server's own list endpoint agrees — exactly one
    // passkey was added, not two.
    await expect.poll(() => fetchPasskeyCount(page), { timeout: 10_000 }).toBe(initialServerCount + 1)

    // The registration handshake ran exactly once each way. More than one
    // of either would mean the step-up confirm handler re-entered (double
    // click, a StrictMode-style double-invoke, a mis-keyed effect) and
    // actually registered twice — a real bug, not a locator artifact.
    expect(registerStartRequests, `register-start calls: ${JSON.stringify(registerStartRequests)}`).toHaveLength(1)
    expect(registerFinishRequests, `register-finish calls: ${JSON.stringify(registerFinishRequests)}`).toHaveLength(1)
  })

  test('wrong password during step-up shows an inline error, not a session bounce', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await devLogin(page, uniqueDevEmail('wrongpw'))

    await page.goto(`${WEB_URL}/settings/security`)
    await page.getByRole('button', { name: 'Add passkey' }).click()
    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText('Incorrect password')).toBeVisible({ timeout: 10_000 })
    // Still on the settings page, still logged in — a wrong step-up password
    // must never clear the session (mirrors confirmAction's existing
    // behavior for every other step-up-gated action).
    await expect(page).toHaveURL(/\/settings\/security/)
  })
})
