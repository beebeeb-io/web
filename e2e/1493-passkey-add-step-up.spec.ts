import { test, expect, type Page } from '@playwright/test'

/**
 * Task 1493 (web half) — adding a passkey now requires a fresh step-up
 * before the server will issue a registration challenge (server PR #85,
 * branch fix/1493-passkey-register-server-state-step-up).
 *
 * Runs against an ISOLATED stack the task brief asked for — NOT the shared
 * dev API on :3001:
 *   - server built from the 1493 branch, scratch DB `bb_1493_e2e`, on :3101
 *   - this repo's own `bunx vite` on :5273 (VITE_API_URL pinned via
 *     .env.local)
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
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5273'
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

    const passkeyRows = page.locator('text=Added').locator('..')
    const initialCount = await passkeyRows.count()

    await page.getByRole('button', { name: 'Add passkey' }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible()

    await page.getByLabel('Password').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step-up succeeds -> register-start (now WITH X-Confirm-Token) ->
    // navigator.credentials.create against the virtual authenticator ->
    // register-finish with the server-issued reg_id -> onAdded.
    await expect(page.getByText('Passkey added')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toHaveCount(0)

    // A new passkey row is now listed.
    await expect(passkeyRows).toHaveCount(initialCount + 1)
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
