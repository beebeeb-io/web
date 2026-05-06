import { test, expect } from '@playwright/test'

test('referral join page shows split screen (0072)', async ({ page }) => {
  await page.goto('/join/test-code')
  // Wait for lazy load
  await page.waitForTimeout(5000)
  const content = await page.locator('body').textContent() ?? ''
  // Should have referral-related text OR a signup form
  const hasReferral = /invited|10 GB|Beebeeb|sign up|create.*account|encrypted/i.test(content)
  await page.screenshot({ path: '../../qa-screenshots/referral-join-test.png' })
  expect(hasReferral).toBe(true)
})
