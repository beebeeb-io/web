/** FLOW-4 QA walk (not committed): real stack, no mocks. */
import { test, expect } from '@playwright/test'
import { reachPasswordStep, createAccount, uniqueEmail } from './helpers/signup'

const OUT = process.env.FLOW4_OUT ?? '/tmp'
test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(180_000)

test('site CTA signup?plan=pro → trial → billing labels (real stack)', async ({ page }) => {
  const email = uniqueEmail('flow4')
  await page.goto('/?nodev=1'); await page.goto('/signup?plan=pro&cycle=yearly&nodev=1')
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
  await reachPasswordStep(page)
  await createAccount(page, 'flow4-correct-horse-battery')
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${OUT}/01-after-signup-plan-pro.png`, fullPage: true })

  const subResp = page.waitForResponse((r) => r.url().includes('/api/v1/billing/subscription') && r.request().method() === 'GET')
  await page.goto('/billing')
  const sub1 = await (await subResp).json()
  console.log('FLOW4 sub-after-signup', JSON.stringify({ plan: sub1.plan, status: sub1.status, trial_ends_at: sub1.trial_ends_at, quota: sub1.quota_bytes, has_used_trial: sub1.has_used_trial }))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/02-billing-after-signup.png`, fullPage: true })
  console.log('FLOW4 billing-text-1', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 1500))

  await page.getByRole('button', { name: /Choose a plan/i }).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/02b-billing-choose-plan.png`, fullPage: true })
  console.log('FLOW4 choose-plan-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 2500))
  const allTrial = page.getByRole('button', { name: /14-day/i })
  console.log('FLOW4 any-14day-buttons', await allTrial.count(), JSON.stringify(await allTrial.allInnerTexts()))
  let cta = page.getByRole('button', { name: /Start 14-day Pro trial/i })
  if (!(await cta.count())) cta = page.getByTestId('plan-card-pro').getByRole('button', { name: /14-day|trial|upgrade/i })
  console.log('FLOW4 pro-trial-cta-count', await cta.count())
  if (await cta.count()) {
    const tr = page.waitForResponse((r) => r.url().includes('/billing/trial/start'))
    await cta.first().click()
    const trr = await tr
    console.log('FLOW4 trial-start', trr.status(), await trr.text())
    await page.waitForTimeout(2000)
    const subResp2 = page.waitForResponse((r) => r.url().includes('/api/v1/billing/subscription') && r.request().method() === 'GET')
    await page.reload()
    const sub2 = await (await subResp2).json()
    console.log('FLOW4 sub-after-trial', JSON.stringify({ plan: sub2.plan, status: sub2.status, billing_cycle: sub2.billing_cycle, trial_ends_at: sub2.trial_ends_at, quota: sub2.quota_bytes }))
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/03-billing-trialing.png`, fullPage: true })
    console.log('FLOW4 billing-text-2', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 2000))
    const add = page.getByRole('button', { name: /Add payment method/i })
    console.log('FLOW4 add-payment-cta-count', await add.count())
    if (await add.count()) {
      const cv = page.waitForResponse((r) => r.url().includes('/billing/trial/convert'))
      await add.first().click()
      const cvr = await cv
      console.log('FLOW4 trial-convert', cvr.status(), await cvr.text())
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/04-convert-no-mollie.png`, fullPage: true })
      console.log('FLOW4 toast-text', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600))
    }
  }
})

test.skip('app pricing page monthly vs yearly (real stack)', async ({ page }) => {
  await page.goto('/pricing?nodev=1')
  await expect(page.getByTestId('plan-card-pro')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${OUT}/05-app-pricing-default.png`, fullPage: true })
  for (const id of ['starter', 'basic', 'pro', 'business']) {
    const c = page.getByTestId(`plan-card-${id}`)
    if (await c.count()) console.log('FLOW4 default', id, (await c.innerText()).replace(/\s+/g, ' ').slice(0, 300))
  }
  await page.getByRole('button', { name: /^Monthly$/ }).click()
  await page.screenshot({ path: `${OUT}/06-app-pricing-monthly.png`, fullPage: true })
  for (const id of ['starter', 'basic', 'pro', 'business']) {
    const c = page.getByTestId(`plan-card-${id}`)
    if (await c.count()) console.log('FLOW4 monthly', id, (await c.innerText()).replace(/\s+/g, ' ').slice(0, 300))
  }
})
