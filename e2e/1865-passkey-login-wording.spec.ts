import { test, expect } from '@playwright/test'

/**
 * Task 1865 — a cancelled / empty passkey sign-in shows our own account-neutral
 * sentence, never the browser's raw DOMException text.
 *
 * `/auth/passkey/login-start` is route-mocked with the decoy-shaped 200 the
 * 1784 server returns for an unknown email, so this runs with no API. A CDP
 * virtual authenticator holding NO credential stands in for the browser: with
 * no matching credential `navigator.credentials.get` rejects NotAllowedError.
 */
const SENTENCE = 'No passkey was used. If you have not set one up on this device, sign in with your password.'
const OUT = process.env.E2E_SHOT_DIR ?? '.'

for (const scheme of ['light', 'dark'] as const) {
  test(`login passkey cancel -> neutral sentence (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    const client = await page.context().newCDPSession(page)
    await client.send('WebAuthn.enable')
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    await page.route('**/auth/passkey/login-start', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: '00000000-0000-0000-0000-000000000000',
          auth_state: 'decoy',
          publicKey: {
            challenge: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
            timeout: 1000,
            rpId: 'localhost',
            allowCredentials: [{ type: 'public-key', id: 'AAECAwQFBgcICQoLDA0ODw' }],
            userVerification: 'preferred',
          },
        }),
      }),
    )
    await page.goto('/login')
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 }).catch(() => {})
    await page.locator('#login-email').fill('nobody@beebeeb.io')
    await page.getByRole('button', { name: /sign in with passkey/i }).click()
    // passkey mode: a second click performs the ceremony if the first only switched mode
    const msg = page.getByText(SENTENCE)
    if (!(await msg.isVisible().catch(() => false))) {
      const again = page.getByRole('button', { name: /passkey/i }).last()
      await again.click().catch(() => {})
    }
    await expect(msg).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/operation either timed out/i)).toHaveCount(0)
    await expect(page.getByText(/NotAllowedError/)).toHaveCount(0)
    await page.screenshot({ path: `${OUT}/1865-login-${scheme}.png` })
  })
}
