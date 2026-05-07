import { test, expect, type Page } from '@playwright/test'

/**
 * E2E regression test for task 0028 — admin / settings page refresh stability.
 *
 * Spec 011 (storage-pool decommission wizard) requires its dedicated pages to
 * be bookmarkable + refresh-stable. This test asserts that hitting the
 * browser reload on common admin and settings pages keeps the user on the
 * same URL — never silently bouncing them to `/` or `/login`.
 *
 * The bug was reported as "refresh now goes back to / (always)" but couldn't
 * be reproduced during recon (see 0028 task notes). This test exists to
 * pin the current correct behaviour so any future regression gets caught
 * before it hits Guus.
 *
 * Prerequisites (same as auth.spec.ts):
 *   1. Postgres on 5434
 *   2. API on 3001
 *   3. Web dev server on 5173
 */

const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`

const TEST_PASSWORD = 'RefreshStable1234'

/**
 * Drive the full signup flow (email → recovery phrase → verify → password)
 * and land on `/` with the vault unlocked. Returns once the drive is visible.
 *
 * Reuses the same recovery-phrase-extraction trick as
 * onboarding-password.spec.ts: read the 12 words out of the DOM, then re-type
 * the random subset the verify step asks for.
 */
async function signupAndUnlock(page: Page) {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(uniqueEmail())
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Display step — wait for the 12-word phrase, capture, acknowledge.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  expect(phraseWords.length).toBe(12)

  await page
    .getByRole('checkbox', { name: /I've saved my recovery phrase offline/i })
    .click()
  await page.getByRole('button', { name: /I saved it/i }).click()

  // Verify step — fill every "Word #N" with the right word.
  const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
  const labelCount = await verifyLabels.count()
  expect(labelCount).toBeGreaterThan(0)
  for (let i = 0; i < labelCount; i++) {
    const labelText = (await verifyLabels.nth(i).innerText()).trim()
    const m = labelText.match(/Word #(\d+)/)
    if (!m) throw new Error(`unexpected verify label: ${labelText}`)
    const wordIdx = parseInt(m[1], 10) - 1
    await page.getByLabel(labelText, { exact: true }).fill(phraseWords[wordIdx])
  }
  await page.getByRole('button', { name: /^verify$/i }).click()

  // Password step — set device password and create the account.
  const passwordField = page.getByPlaceholder('At least 12 characters')
  await expect(passwordField).toBeVisible({ timeout: 5_000 })
  await passwordField.fill(TEST_PASSWORD)
  await page.getByPlaceholder('Type it again').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  // Wait until we land on `/` (drive). OPAQUE registration + key wrap can take
  // a few seconds on a cold worker, especially during cargo-watch rebuilds.
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({
    timeout: 10_000,
  })
}

test.describe('Page refresh stability (task 0028)', () => {
  // Pages that must survive a browser refresh without bouncing to `/` or
  // `/login`. Admin pages don't require a superadmin role to RENDER (the
  // server-side admin endpoints will 403, but the route + URL are
  // user-agnostic) — so a regular signed-up user is sufficient to test
  // routing behaviour.
  // Note: /admin/* routes now redirect to admin.beebeeb.io (removed from list)
  const refreshStablePaths = [
    '/settings/security',
    '/settings/profile',
    '/settings/billing',
  ] as const

  test('refresh on admin + settings pages keeps the user on the same URL', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await signupAndUnlock(page)

    for (const path of refreshStablePaths) {
      await test.step(`refresh on ${path} stays on ${path}`, async () => {
        await page.goto(path)
        await expect(page).toHaveURL(new RegExp(escapeRegex(path) + '$'), {
          timeout: 10_000,
        })

        await page.reload()

        // After reload, the URL must remain `path`. Allow a brief window
        // for ProtectedRoute's `loading || !vaultChecked` guard to settle —
        // during that window it renders null, but it must not navigate.
        await expect(page).toHaveURL(new RegExp(escapeRegex(path) + '$'), {
          timeout: 10_000,
        })
        // Sanity: not bounced to /login or / under the same URL via some
        // history.replaceState shenanigan that the regex above might miss.
        const finalPath = new URL(page.url()).pathname
        expect(finalPath).toBe(path)
      })
    }
  })
})

/** Escape a path so it can be embedded in a RegExp end-anchor. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
