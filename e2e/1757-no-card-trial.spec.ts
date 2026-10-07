/**
 * 1757 — the no-card trial on the web, on the REAL stack.
 *
 * Needs: the isolated harness (`e2e/scripts/web-e2e.sh`) with an API built from
 * server main at or after 617ef80c (task 1755), and these in the environment:
 *   BB_REQUIRE_PLAN_AT_SIGNUP=1  BB_SIGNUP_EMAIL_CODE=1  BB_ENTRY_ALLOWANCE_BYTES=3000000
 *   BB_TRIAL_CLAIM_KEY=<any test value>  VITE_FEATURE_ONBOARDING_DOCUMENT=true
 *   SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS_MODE=none  (Mailpit, E2E_MAILPIT_URL)
 *   MOLLIE_API_KEY=test_mock_local MOLLIE_API_BASE=http://localhost:$E2E_API_PORT/dev/mock-mollie/v2
 * The spec itself switches the trial on (`server_config.no_card_trial_enabled`) and sets
 * a small cap (`no_card_trial_cap_bytes`), because those are operator settings.
 *
 *   OFF       — the switch off: the offer says why, no start button, a forced start is refused.
 *   START     — allowance -> "Start 14-day trial, no card" -> trialing; honest status; no card
 *               anywhere; an upload past the cap shows the trial-cap message.
 *   ENDED<=   — the trial ends with the files within the allowance: back to the allowance, no deadline.
 *   ENDED>    — the trial ends over the allowance: read-only above it with a deletion date; trimming
 *               clears it again.
 *   SUBSCRIBE — subscribe through the mock Mollie checkout: the cap lifts.
 */
import { test, expect, type Page } from '@playwright/test'
import { uniqueEmail } from './helpers/signup'
import { openRowMenu } from './helpers/drive'
import {
  ALLOWANCE,
  API_URL,
  deleteServerConfig,
  missingPrerequisites,
  onboardingDoc,
  PASSWORD,
  psql,
  runLifecycleSweep,
  setServerConfig,
  shot,
  shotBoth,
  signUpAllowanceAccount,
  skipTours,
  subscription,
  userIdOf,
} from './helpers/no-card-trial'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(300_000)
test.describe.configure({ mode: 'serial' })

const CAP = 6_000_000 // the trial cap this spec sets (allowance is 3 MB)

/** Debug aid: E2E_1757_ONLY=UNDER,OVER runs just those tests (a full pass runs them all). */
const ONLY = (process.env.E2E_1757_ONLY ?? '').split(',').filter(Boolean)
const skipUnless = (tag: string) => test.skip(ONLY.length > 0 && !ONLY.includes(tag), `E2E_1757_ONLY=${ONLY.join(',')}`)

test.beforeAll(async () => {
  const missing = await missingPrerequisites()
  test.skip(missing.length > 0, `1757 real-API spec needs: ${missing.join('; ')}`)
  setServerConfig('no_card_trial_cap_bytes', String(CAP))
})

async function uploadFile(page: Page, name: string, bytes: number) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(bytes, 7),
  })
}

test('OFF — switch off: no offer, the chooser is what prod shows today; breaker tripped: the offer says why and a forced start is refused', async ({ page }) => {
  skipUnless('OFF')
  // The switch off (prod today): the document carries no offer at all, so the web draws
  // no trial start and the existing chooser stays exactly as it was.
  setServerConfig('no_card_trial_enabled', 'false')
  await signUpAllowanceAccount(page, uniqueEmail('v1757-off'))
  expect((await onboardingDoc(page)).offers?.trial).toBeUndefined()
  await page.goto('/choose-plan')
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('start-trial')).toHaveCount(0)
  await expect(page.getByTestId('trial-unavailable')).toHaveCount(0)
  await shot(page, '1757-01a-switch-off-legacy-chooser')

  // The switch on but the outstanding-capacity breaker tripped (ceiling 1 byte): the offer is
  // there, unavailable, with its reason, and the web says so in words.
  setServerConfig('no_card_trial_enabled', 'true')
  setServerConfig('no_card_trial_capacity_ceiling_bytes', '1')
  try {
    expect((await onboardingDoc(page)).offers.trial).toMatchObject({ available: false, unavailable_reason: 'temporarily_unavailable' })
    await page.goto('/choose-plan')
    const note = page.getByTestId('trial-unavailable')
    await expect(note).toBeVisible({ timeout: 30_000 })
    await expect(note).toContainText('We are not starting new trials right now.')
    await expect(note).toContainText('Your 3 MB stays.')
    await expect(page.getByTestId('start-trial')).toHaveCount(0)
    // The card-mandate flow is not offered either: the document, not the page, decides.
    await expect(page.getByTestId('trial-method-picker')).toHaveCount(0)
    await shotBoth(page, '1757-01b-trials-paused')

    // A stale tab that tries anyway gets the typed refusal, and the account is unchanged.
    const forced = await page.request.post(`${API_URL}/api/v1/billing/trial/start`, { data: { plan: 'basic', billing_cycle: 'monthly' } })
    expect(forced.status()).toBe(409)
    expect((await forced.json()).error).toBe('trial_temporarily_unavailable')
    expect((await onboardingDoc(page)).account.state).toBe('allowance')
  } finally {
    deleteServerConfig('no_card_trial_capacity_ceiling_bytes')
  }
})

test('ACCOUNT PAGE — the document-driven account page starts the trial too, with a plan in the request (main posted an empty body)', async ({ page }) => {
  skipUnless('ACCT')
  setServerConfig('no_card_trial_enabled', 'true')
  await signUpAllowanceAccount(page, uniqueEmail('v1757-acct'))
  await page.goto('/account-status')
  const card = page.getByTestId('step-start_trial')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('start-trial')).toHaveText(/Start 14-day trial, no card/)
  await shotBoth(page, '1757-02b-account-page-start')
  const started = page.waitForResponse((r) => r.url().includes('/api/v1/billing/trial/start') && r.request().method() === 'POST')
  await card.getByTestId('start-trial').click()
  const res = await started
  expect(res.request().postDataJSON()).toMatchObject({ plan: expect.any(String), billing_cycle: expect.any(String) })
  expect(res.status(), 'POST /billing/trial/start').toBe(201)
  await expect.poll(async () => (await onboardingDoc(page)).account.state, { timeout: 30_000 }).toBe('trialing_no_card')
})

test('START — allowance -> start with no card -> honest trial status -> upload past the cap is refused with the trial-cap message', async ({ page }) => {
  skipUnless('START')
  setServerConfig('no_card_trial_enabled', 'true')
  const paymentRequests: string[] = []
  page.on('request', (r) => {
    if (/\/billing\/trial\/checkout|mock-mollie|\/billing\/checkout/.test(r.url())) paymentRequests.push(r.url())
  })
  const email = uniqueEmail('v1757-start')
  await signUpAllowanceAccount(page, email)
  expect((await onboardingDoc(page)).account.state).toBe('allowance')

  // The plan chooser offers the trial with no card and no payment method.
  await page.goto('/choose-plan')
  const start = page.getByTestId('trial-start')
  await expect(start).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('start-trial')).toHaveText(/Start 14-day trial, no card/)
  await expect(start).toContainText('No card')
  await expect(start).toContainText('6 MB')
  await expect(page.getByTestId('trial-method-picker')).toHaveCount(0)
  await expect(page.getByText(/iDEAL|authorization|Mollie/i)).toHaveCount(0)
  await shotBoth(page, '1757-02-chooser-start-no-card')

  const started = page.waitForResponse((r) => r.url().includes('/api/v1/billing/trial/start') && r.request().method() === 'POST')
  await page.getByTestId('start-trial').click()
  const res = await started
  expect(res.status(), 'POST /billing/trial/start').toBe(201)
  expect(await res.json()).toMatchObject({ status: 'trialing', trial_kind: 'no_card', cap_bytes: CAP })
  await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 })
  await skipTours(page)
  expect(paymentRequests, 'no payment request of any kind').toEqual([])

  const doc = await onboardingDoc(page)
  expect(doc.account.state).toBe('trialing_no_card')
  expect(doc.account.trial).toMatchObject({ kind: 'no_card', cap_bytes: CAP, converts_automatically: false, first_charge_at: null })

  // The status: end date, days left, cap meter, one sentence on what happens at the end.
  const banner = page.getByTestId('trial-banner-no-card')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await expect(banner).toContainText('days left')
  await expect(banner.getByTestId('trial-ends-on')).toHaveText(/\d{1,2} \w{3} 20\d\d/)
  await expect(banner.getByTestId('trial-cap-meter')).toContainText('of 6 MB')
  await expect(banner.getByTestId('trial-consequence')).toContainText('3 MB')
  await expect(banner).not.toContainText(/Add payment method|auto/i)
  await shotBoth(page, '1757-03-trial-running-drive')

  // Inside the cap (above the allowance): fine.
  await uploadFile(page, 'inside-cap.bin', 4_000_000)
  await expect(page.getByText('inside-cap.bin').first()).toBeVisible({ timeout: 60_000 })

  // Past the cap: the trial-cap message, with Subscribe, not the plan-gate or generic copy.
  await uploadFile(page, 'past-cap.bin', 3_000_000)
  const toast = page.getByText(/trial storage cap|trial cap/i).first()
  await expect(toast).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/6 MB/).first()).toBeVisible()
  await expect(page.getByText('Start your trial to upload')).toHaveCount(0)
  await shotBoth(page, '1757-04-upload-past-cap')
  await page.waitForTimeout(800)
  await expect(page.getByText('past-cap.bin')).toHaveCount(0)

  // The server refuses the same upload with its own typed answer (a stale tab that believed it had room).
  await page.route('**/api/v1/files/usage', async (route) => {
    const r = await route.fetch()
    const body = await r.json()
    await route.fulfill({ response: r, json: { ...body, plan_limit_bytes: 10_000_000_000 } })
  })
  await page.route('**/api/v1/billing/usage', async (route) => {
    const r = await route.fetch()
    const body = await r.json()
    await route.fulfill({ response: r, json: { ...body, quota_bytes: 10_000_000_000 } })
  })
  await page.reload()
  await skipTours(page)
  const refused = page.waitForResponse((r) => r.status() === 413)
  await uploadFile(page, 'stale-tab.bin', 3_000_000)
  const r413 = await refused
  expect((await r413.json()).is_trial_cap).toBe(true)
  await expect(page.getByText(/6 MB trial (storage )?cap/i).first()).toBeVisible({ timeout: 30_000 })
  await shotBoth(page, '1757-05-server-413-trial-cap')

  // Sharing is paused for the trial (task 1732 gate): honest, not a vague conflict.
  const shareRes = await page.request.post(`${API_URL}/api/v1/billing/cancel`, { data: {} })
  expect(shareRes.status()).toBe(409)
  expect((await shareRes.json()).error).toBe('no_subscription_to_cancel')
  expect(Number(psql(`SELECT COUNT(*) FROM subscriptions WHERE user_id = '${userIdOf(email)}' AND status = 'trialing'`))).toBe(1)
  expect((await subscription(page)).status).toBe('trialing')
})

/** Start the trial from the plan chooser (the document's offer), and land on the drive. */
async function startTrialViaChooser(page: Page) {
  await page.goto('/choose-plan')
  await expect(page.getByTestId('start-trial')).toBeVisible({ timeout: 30_000 })
  const started = page.waitForResponse((r) => r.url().includes('/api/v1/billing/trial/start') && r.request().method() === 'POST')
  await page.getByTestId('start-trial').click()
  expect((await started).status(), 'POST /billing/trial/start').toBe(201)
  await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 })
  await skipTours(page)
  await expect(page.getByTestId('trial-banner-no-card')).toBeVisible({ timeout: 30_000 })
}

/** Move the trial's end into the past, the way the clock would. */
function endTrialNow(email: string) {
  psql(`UPDATE subscriptions SET trial_ends_at = NOW() - INTERVAL '1 hour'
        WHERE user_id = '${userIdOf(email)}' AND status = 'trialing'`)
}

const newestRow = (email: string, column: string) =>
  psql(`SELECT ${column} FROM subscriptions WHERE user_id = '${userIdOf(email)}' ORDER BY created_at DESC LIMIT 1`)

test('ENDED, within the allowance — the trial ends: back to the allowance, no deadline, "your 3 MB stays", uploads still work', async ({ page }) => {
  skipUnless('UNDER')
  setServerConfig('no_card_trial_enabled', 'true')
  const email = uniqueEmail('v1757-under')
  await signUpAllowanceAccount(page, email)
  await startTrialViaChooser(page)
  await uploadFile(page, 'under.bin', 1_000_000)
  await expect(page.getByText('under.bin').first()).toBeVisible({ timeout: 60_000 })

  endTrialNow(email)
  await runLifecycleSweep(async () => (await onboardingDoc(page)).account.state === 'allowance')
  const doc = await onboardingDoc(page)
  expect(doc.account.trial).toBeUndefined()
  expect(doc.account.lifecycle).toBeUndefined()
  expect(doc.account.storage).toMatchObject({ quota_bytes: ALLOWANCE, over_allowance: false })
  expect(newestRow(email, 'storage_grace_deadline'), 'no deletion deadline when the files fit').toBe('')

  await page.goto('/')
  await skipTours(page)
  const notice = page.getByTestId('trial-ended-allowance-notice')
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await expect(notice).toContainText('Your trial has ended.')
  await expect(notice).toContainText('Your 3 MB stays.')
  await expect(notice).toContainText('Nothing was charged')
  await expect(page.getByTestId('trial-banner-no-card')).toHaveCount(0)
  await expect(page.getByTestId('trial-ended-banner')).toHaveCount(0)
  await shotBoth(page, '1757-06-trial-ended-within-allowance')

  // One notice, once: dismissed, it stays gone after a reload.
  await page.getByTestId('trial-ended-allowance-dismiss').click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await skipTours(page)
  await expect(page.getByTestId('trial-ended-allowance-notice')).toHaveCount(0)

  // Uploads work again (within the allowance), and the one trial is used: the chooser says so.
  await uploadFile(page, 'after-end.bin', 1_000_000)
  await expect(page.getByText('after-end.bin').first()).toBeVisible({ timeout: 60_000 })
  expect((await onboardingDoc(page)).offers.trial).toMatchObject({ available: false, unavailable_reason: 'already_used' })
  await page.goto('/choose-plan')
  await expect(page.getByTestId('trial-unavailable')).toContainText('already had your trial')
  await expect(page.getByTestId('start-trial')).toHaveCount(0)
  await shot(page, '1757-07-chooser-trial-used')
})

test('ENDED, over the allowance — read-only above it with the deletion date; the trash counts; trimming clears it', async ({ page }) => {
  skipUnless('OVER')
  setServerConfig('no_card_trial_enabled', 'true')
  const email = uniqueEmail('v1757-over')
  await signUpAllowanceAccount(page, email)
  await startTrialViaChooser(page)
  await uploadFile(page, 'over.bin', 4_000_000)
  await expect(page.getByText('over.bin').first()).toBeVisible({ timeout: 60_000 })
  // While it runs, the banner already says what the end will mean for the files above the allowance.
  await expect(page.getByTestId('trial-consequence')).toContainText('read-only')

  endTrialNow(email)
  await runLifecycleSweep(async () => (await onboardingDoc(page)).account.state === 'trial_ended')
  const doc = await onboardingDoc(page)
  expect(doc.account.capabilities.upload).toMatchObject({ allowed: false, reason: 'trial_ended' })
  expect(doc.account.capabilities.download.allowed).toBe(true)
  const deletionAt = new Date(doc.account.lifecycle.data_deletion_at).getTime()
  const days = (deletionAt - Date.now()) / 86_400_000
  expect(days, 'deletion about 14 days after the trial ended').toBeGreaterThan(13)
  expect(days).toBeLessThan(14.1)

  await page.goto('/')
  await skipTours(page)
  const banner = page.getByTestId('trial-ended-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  const deletionDay = new Date(deletionAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  await expect(banner.getByTestId('trial-ended-body')).toContainText(`deleted on ${new Date(deletionAt).getDate()}`)
  await expect(banner.getByTestId('trial-ended-trim')).toContainText('Trash')
  await expect(banner.getByTestId('trial-ended-trim')).toContainText('still count')
  await expect(banner.getByTestId('trial-ended-subscribe')).toBeVisible()
  // The generic nudges ("Storage full, upgrade") do not pile on top of the account banner.
  await expect(page.getByText(/Storage full/)).toHaveCount(0)
  expect(deletionDay).toMatch(/20\d\d/)
  await shotBoth(page, '1757-08-trial-ended-over-allowance')

  // Uploads are refused with the trial-ended words (not the plan gate, not "Not enough storage").
  await uploadFile(page, 'refused.bin', 1_000)
  await expect(page.getByText('Your trial has ended').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Start your trial to upload')).toHaveCount(0)
  await expect(page.getByText('Not enough storage')).toHaveCount(0)
  await page.waitForTimeout(800)
  await expect(page.getByText('refused.bin')).toHaveCount(0)
  await shotBoth(page, '1757-09-upload-refused-trial-ended')

  // Download still works; the server refuses an upload with the typed code.
  const fileId = psql(`SELECT id FROM files WHERE user_id = '${userIdOf(email)}' AND size_bytes = 4000000 AND is_folder = FALSE`)
  const dl = await page.request.get(`${API_URL}/api/v1/files/${fileId}/download`)
  expect(dl.status(), 'download stays open over the allowance').toBe(200)

  // The settings page says the same thing in its own card.
  await page.goto('/billing')
  await expect(page.getByTestId('billing-trial-ended')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('billing-lapsed')).toHaveCount(0)
  await shotBoth(page, '1757-10-billing-trial-ended')

  // Trash counts: moving the file to the trash changes nothing.
  await page.goto('/')
  await skipTours(page)
  await openRowMenu(page, 'over.bin')
  await page.getByRole('menuitem', { name: /Move to trash/ }).click()
  await expect(page.getByText('over.bin')).toHaveCount(0, { timeout: 30_000 })
  await runLifecycleSweep(async () => true)
  expect((await onboardingDoc(page)).account.state, 'a file in the trash still counts').toBe('trial_ended')

  // Emptying the trash trims below the allowance; the sweep clears the deadline.
  await page.goto('/trash')
  await page.getByRole('button', { name: 'Empty trash' }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByPlaceholder('Your password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Delete permanently' }).last().click()
  await expect(page.getByText(/trash is empty/i)).toBeVisible({ timeout: 60_000 })
  await runLifecycleSweep(async () => (await onboardingDoc(page)).account.state === 'allowance')
  expect(newestRow(email, 'storage_grace_deadline'), 'trimming clears the deadline').toBe('')
  await page.goto('/')
  await skipTours(page)
  await expect(page.getByTestId('trial-ended-banner')).toHaveCount(0)
  await uploadFile(page, 'back.bin', 1_000_000)
  await expect(page.getByText('back.bin').first()).toBeVisible({ timeout: 60_000 })
  await shot(page, '1757-11-trimmed-back-to-allowance')
})

test('SUBSCRIBE — a trial without a card subscribes at checkout (mock Mollie): the cap lifts', async ({ page }) => {
  skipUnless('SUBSCRIBE')
  setServerConfig('no_card_trial_enabled', 'true')
  const email = uniqueEmail('v1757-sub')
  await signUpAllowanceAccount(page, email)
  await startTrialViaChooser(page)
  await page.getByTestId('trial-subscribe').click()
  await page.waitForURL(/\/billing\?view=change/, { timeout: 30_000 })
  // No mandate to charge, nothing to convert: neither legacy trial control is drawn.
  await expect(page.getByTestId('pay-now-button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add payment method' })).toHaveCount(0)
  // 1842: no "Subscribe to Pro" any more — "Choose a plan" leads to the plan table, and Pro's button opens checkout.
  await page.getByTestId('chooser-choose-plan').click()
  await page.getByTestId('plan-comparison').getByRole('button', { name: 'Choose', exact: true }).last().click()
  await page.waitForTimeout(1500)
  await shot(page, '1757-12a-upgrade-dialog')
  await page.getByRole('button', { name: /^Continue/ }).click()
  await page.waitForTimeout(1500)
  await shot(page, '1757-12b-billing-details')
  await page.getByLabel('Full name').fill('Trial Subscriber')
  await page.getByTestId('billing-country').selectOption('NL')
  await page.getByLabel('Street and house number').fill('Hoofdstraat 1')
  await page.getByLabel('Postal code').fill('6602 AB')
  await page.getByLabel('City').fill('Wijchen')
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await page.waitForURL(/\/dev\/mock-mollie\/checkout\//, { timeout: 30_000 })
  await expect(page.getByTestId('mock-mollie-checkout')).toBeVisible()
  await page.getByTestId('mock-mollie-pay').click()
  await page.waitForURL(/\/billing/, { timeout: 30_000 })

  // The first real charge settles: the account is a paying one and the cap is gone.
  await expect
    .poll(async () => (await onboardingDoc(page)).account.state, { timeout: 60_000, intervals: [1000] })
    .toBe('active')
  const doc = await onboardingDoc(page)
  expect(doc.account.storage.quota_bytes, 'the plan quota, not the 6 MB cap').toBeGreaterThan(CAP * 100)
  expect(doc.account.capabilities.upload.limit_bytes ?? doc.account.storage.quota_bytes).toBeGreaterThan(CAP * 100)
  expect((await subscription(page)).status).toBe('active')
  await page.goto('/')
  await skipTours(page)
  await expect(page.getByTestId('trial-banner-no-card')).toHaveCount(0)
  await expect(page.getByTestId('trial-ended-banner')).toHaveCount(0)

  // Past the old cap (6 MB) now uploads: 7 MB lands.
  await uploadFile(page, 'past-the-old-cap.bin', 7_000_000)
  await expect(page.getByText('past-the-old-cap.bin').first()).toBeVisible({ timeout: 90_000 })
  await shotBoth(page, '1757-12-subscribed-cap-lifted')
})
