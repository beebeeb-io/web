/**
 * Money flow — the site's plan choice survives signup (flow-4 P1).
 *
 * The marketing site sends every pricing CTA to `/signup?plan=<slug>&cycle=<cycle>`
 * ("Start a 14-day trial", "Get Basic", …). Before this fix the web app read
 * only the referral params on /signup, onboarding had no plan step, and a new
 * account landed on the drive on Free 5 GB with no trial — the plan the user
 * picked on the site was silently dropped.
 *
 * REAL STACK — no mocks. Run through the isolated harness:
 *   E2E_API_PORT=… E2E_VITE_PORT=… bash e2e/scripts/web-e2e.sh \
 *     e2e/flow-money-signup-plan-intent.spec.ts
 *
 * GATE 1 — after signup via `/signup?plan=basic&cycle=yearly`, the user lands
 *   on the change-plan view with the Basic plan preselected and a one-click
 *   "Start 14-day Basic trial" CTA naming the chosen cycle (not on the drive,
 *   Free, with no chooser).
 * GATE 2 — that one click starts a trial for EXACTLY the chosen plan + cycle:
 *   GET /billing/subscription → { plan: 'basic', status: 'trialing',
 *   billing_cycle: 'yearly', trial_ends_at: <set> }.
 * GATE 3 — the intent is consumed once: a second visit to /billing no longer
 *   shows the plan-intent card.
 */
import { test, expect } from '@playwright/test'
import { reachPasswordStep, createAccount, uniqueEmail } from './helpers/signup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(240_000)

test('site CTA /signup?plan=basic&cycle=yearly ends on a Basic yearly trial, one click', async ({ page }) => {
  const email = uniqueEmail('flow-money-intent')
  // ?nodev=1 disables DevAuthGate's dev auto-login (src/lib/dev-auth.ts) so the
  // GuestRoute /signup + /onboarding are not auto-authenticated away.
  await page.goto('/signup?plan=basic&cycle=yearly&nodev=1')
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
  await reachPasswordStep(page)
  await createAccount(page, 'flow-money-correct-horse-battery')

  // GATE 1 — the plan chooser, opened on Basic, trial CTA visible.
  await page.waitForURL(/\/billing\?.*view=change/, { timeout: 60_000 })
  const intent = page.getByTestId('plan-intent-card')
  await expect(intent).toBeVisible({ timeout: 20_000 })
  await expect(intent).toContainText(/Basic/)
  await expect(intent).toContainText(/yearly/i)
  const cta = intent.getByRole('button', { name: /Start 14-day Basic trial/i })
  await expect(cta).toBeVisible()

  // GATE 2 — one click → trialing Basic on the yearly cycle, server truth.
  const startResp = page.waitForResponse(
    (r) => r.url().includes('/api/v1/billing/trial/start') && r.request().method() === 'POST',
  )
  await cta.click()
  const start = await startResp
  expect(start.status()).toBe(201)
  expect(JSON.parse(start.request().postData() ?? '{}')).toMatchObject({
    plan: 'basic',
    billing_cycle: 'yearly',
  })

  // Server truth via the page's own session cookie (page.request shares the
  // context cookie jar). A waitForResponse armed before page.goto caught the
  // OLD page's refetch, whose body Chromium discards on navigation.
  const subRes = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(subRes.ok(), `GET /billing/subscription: ${subRes.status()}`).toBe(true)
  const sub = await subRes.json()
  expect(sub).toMatchObject({ plan: 'basic', status: 'trialing', billing_cycle: 'yearly' })
  await page.goto('/billing')
  expect(sub.trial_ends_at).toBeTruthy()

  // GATE 3 — intent consumed: no plan-intent card on a later billing visit.
  await expect(page.getByRole('button', { name: /Add payment method/i }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('plan-intent-card')).toHaveCount(0)
})
