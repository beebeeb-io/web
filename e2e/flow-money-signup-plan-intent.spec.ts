/**
 * Money flow — the site's plan choice survives signup (flow-4 P1), updated for
 * task 1037 (no free signups: a trial with a payment mandate at signup).
 *
 * The marketing site sends every pricing CTA to `/signup?plan=<slug>&cycle=<cycle>`.
 * Since 1037, /signup shows the trial plans FIRST (Starter / Basic / Pro,
 * monthly or yearly) preselected from that intent, and every new account goes
 * on to `/choose-plan` after onboarding — there is no free account to land on.
 *
 * REAL STACK — no mocks. Run through the isolated harness:
 *   E2E_API_PORT=… E2E_VITE_PORT=… bash e2e/scripts/web-e2e.sh \
 *     e2e/flow-money-signup-plan-intent.spec.ts
 *
 * GATE 1 — /signup?plan=basic&cycle=yearly renders the trial picker with Basic
 *   + Yearly preselected and the honest trial terms, before the email field.
 * GATE 2 — after onboarding the new account is routed to
 *   `/choose-plan?plan=basic&cycle=yearly` (never straight to the drive).
 * GATE 3 — what happens there depends on the SERVER:
 *   - `account_state: "needs_plan"` (a server with 1037 and
 *     BB_REQUIRE_PLAN_AT_SIGNUP=1): the chooser stays, Basic yearly
 *     preselected, and "/" redirects back to it.
 *   - no `account_state` / `"ok"` (an older server, or the gate off — the
 *     debug default): the chooser forwards the account to the drive.
 *   The branch taken is attached to the report so a green run says which one
 *   it proved. Mollie's hosted checkout cannot complete here; the mandate
 *   checkout itself is covered API-mocked by e2e/1037-trial-at-signup.spec.ts.
 */
import { test, expect } from '@playwright/test'
import { reachPasswordStep, createAccount, uniqueEmail } from './helpers/signup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(240_000)

test('site CTA /signup?plan=basic&cycle=yearly → plans first → /choose-plan on Basic yearly', async ({ page }, testInfo) => {
  const email = uniqueEmail('flow-money-intent')
  const visited: string[] = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) visited.push(f.url())
  })

  // ?nodev=1 disables DevAuthGate's dev auto-login (src/lib/dev-auth.ts) so the
  // GuestRoute /signup + /onboarding are not auto-authenticated away.
  await page.goto('/signup?plan=basic&cycle=yearly&nodev=1')

  // GATE 1 — trial plans first, preselected from the site intent.
  const picker = page.getByTestId('trial-plan-picker')
  await expect(picker).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('trial-cycle-yearly')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('trial-terms')).toContainText(/Card or iDEAL needed to start/)
  expect((await picker.boundingBox())!.y).toBeLessThan((await page.getByLabel(/email/i).boundingBox())!.y)

  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
  await reachPasswordStep(page)
  await createAccount(page, 'flow-money-correct-horse-battery')

  // GATE 2 — onboarding hands the account to the chooser with the intent.
  await expect
    .poll(() => visited.some((u) => /\/choose-plan\?plan=basic&cycle=yearly/.test(u)), { timeout: 60_000 })
    .toBe(true)

  // GATE 3 — server-dependent, see the header.
  const subRes = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(subRes.ok(), `GET /billing/subscription: ${subRes.status()}`).toBe(true)
  const sub = await subRes.json()
  const state: string = sub.account_state ?? '(absent)'
  testInfo.annotations.push({ type: 'account_state', description: state })
  console.log(`[flow-money] account_state=${state} → ${state === 'needs_plan' ? 'needs_plan branch' : 'gate-off branch'}`)

  if (state === 'needs_plan') {
    await expect(page).toHaveURL(/\/choose-plan/, { timeout: 30_000 })
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-cycle-yearly')).toHaveAttribute('aria-checked', 'true')
    await page.goto('/')
    await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })
  } else {
    expect(state === '(absent)' || state === 'ok').toBe(true)
    await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
  }
})
