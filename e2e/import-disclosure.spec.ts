import { test, expect } from '@playwright/test'

/**
 * Task 0280 — Google Drive import must disclose the US dependency BEFORE the
 * OAuth redirect (brand: honest over reassuring; the user opts in with eyes open).
 *
 * The provider cards only render when their OAuth client id is configured
 * (VITE_GOOGLE_CLIENT_ID / VITE_DROPBOX_APP_KEY). Run with a dummy id set so the
 * Google card renders without performing a real OAuth round-trip:
 *
 *   VITE_GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com \
 *     make web-e2e SPECS=e2e/import-disclosure.spec.ts
 *
 * Skips cleanly when the id is absent (e.g. the default harness run).
 */
test.describe('Import — US disclosure before OAuth (0280)', () => {
  test.skip(
    !process.env.VITE_GOOGLE_CLIENT_ID,
    'Set VITE_GOOGLE_CLIENT_ID to render the Google Drive provider card.',
  )

  test('Google Drive card shows the US disclosure next to Connect, before any redirect', async ({ page }) => {
    await page.goto('/settings/import')

    // The pre-connect provider grid is what a user sees before opting in.
    await expect(page.getByText(/connect a provider/i)).toBeVisible({ timeout: 15_000 })

    // The honest US disclosure is present BEFORE the OAuth redirect (it lives in
    // the same card as the Connect button; clicking Connect is what triggers the
    // redirect, so seeing this copy first satisfies the opt-in-with-disclosure bar).
    const disclosure = page.getByText(/Connects to Google \(US service\)\. Files are downloaded directly to your browser and encrypted before upload to Beebeeb\. Google does not receive your encryption keys\./i)
    await expect(disclosure).toBeVisible()

    // The Connect control exists and has NOT navigated us off-page yet.
    await expect(page.getByRole('button', { name: /connect google drive/i })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/import/)

    await page.screenshot({ path: 'test-results/0280-google-import-disclosure.png', fullPage: true })
  })
})
