import { test, expect } from '@playwright/test'
import { envTestAccount, loginAndProvision } from './helpers/auth'

/**
 * E2E tests for authentication flows.
 *
 * Prerequisites (manual setup required):
 *   1. Postgres running: docker compose -f ../../docker-compose.yml up -d postgres
 *   2. API server:       cd ../server && cargo run -p beebeeb-api
 *   3. Web dev server:   bun dev
 *
 * Run: bunx playwright test
 */

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`

test.describe('Authentication', () => {
  test('signup flow: fill form, submit, redirected to /onboarding', async ({ page }) => {
    const email = uniqueEmail()

    await page.goto('/signup')
    await expect(page).toHaveURL(/\/signup/)

    // Fill signup form
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill('test-password-12chars!')

    // If there's a confirm password field, fill it too
    const confirmField = page.getByLabel(/confirm/i)
    if (await confirmField.isVisible()) {
      await confirmField.fill('test-password-12chars!')
    }

    // Submit
    await page.getByRole('button', { name: /sign up|create account|get started/i }).click()

    // Should redirect to onboarding (recovery phrase screen)
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  })

  test('login flow: fill form, submit, redirected to /', async ({ page }) => {
    const email = uniqueEmail()

    // First, create the account via the API directly
    const signupResp = await page.request.post('http://localhost:3001/api/v1/auth/signup', {
      data: { email, password: 'test-password-12chars!' },
    })
    expect(signupResp.ok()).toBeTruthy()

    // Now test the login UI
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)

    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill('test-password-12chars!')

    await page.getByRole('button', { name: /log in|sign in/i }).click()

    // Should redirect to the drive (root page)
    await expect(page).toHaveURL(/^\/$|\/$/,{ timeout: 10_000 })
  })

  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    // Clear any stored session
    await page.context().clearCookies()

    await page.goto('/')

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
  })

  test('full OPAQUE + DeviceProvision flow with seeded account', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars to run this test (see .env.example)')

    await loginAndProvision(page, account!)

    // After provision, we should be on the drive
    await expect(page).toHaveURL(/^\/(?:$|\?|#)/, { timeout: 10_000 })
  })

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')

    // Should show some form of 404 content
    // The app has a NotFound component that renders for unmatched routes
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    // Page should NOT redirect to login (404 is visible even when not authenticated)
    // or it should show "not found" text
    const url = page.url()
    const hasNotFoundIndicator =
      url.includes('not-found') ||
      url.includes('this-page-does-not-exist') ||
      (body && /not found|404|page.*exist/i.test(body))
    expect(hasNotFoundIndicator).toBeTruthy()
  })
})
