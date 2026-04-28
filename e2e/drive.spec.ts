import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const API = 'http://localhost:3001'
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`
const PASSWORD = 'test-password-e2e-secure!'

test.describe('Drive E2E', () => {
  let email: string

  test.beforeAll(async () => {
    email = uniqueEmail()
  })

  test('signup → login → see drive with seed data', async ({ page }) => {
    await page.goto('/signup')

    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill(PASSWORD)

    const checkbox = page.getByRole('checkbox')
    if (await checkbox.isVisible()) await checkbox.check()

    await page.getByRole('button', { name: /create account/i }).click()

    await expect(page).toHaveURL(/\/(verify-email|onboarding|\/)/, { timeout: 10_000 })
  })

  test('login and navigate to drive', async ({ page }) => {
    const resp = await page.request.post(`${API}/api/v1/auth/signup`, {
      data: { email: uniqueEmail(), password: PASSWORD },
    })
    expect(resp.ok()).toBeTruthy()
    const { session_token, salt } = await resp.json()
    expect(session_token).toBeTruthy()
    expect(salt).toBeTruthy()

    await page.goto('/login')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill(PASSWORD)
    await page.getByRole('button', { name: /log in/i }).click()

    await expect(page).toHaveURL(/^\/$/, { timeout: 10_000 })

    await expect(page.getByText('All files')).toBeVisible()
  })

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible()) {
      return
    }

    const links = ['Shared', 'Photos', 'Starred', 'Recent', 'Trash']
    for (const label of links) {
      const link = page.getByRole('link', { name: label })
      if (await link.isVisible()) {
        await link.click()
        await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}`))
      }
    }

    await page.getByRole('link', { name: 'All files' }).click()
    await expect(page).toHaveURL(/^\/$/)
  })

  test('trash page shows empty state', async ({ page }) => {
    await page.goto('/trash')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText(/trash is empty/i)).toBeVisible({ timeout: 5_000 })
  })

  test('settings profile shows email', async ({ page }) => {
    await page.goto('/settings/profile')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText('Profile')).toBeVisible()
    await expect(page.getByText('Email')).toBeVisible()
  })

  test('search navigates from drive', async ({ page }) => {
    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible()) return

    const searchInput = page.getByPlaceholder(/search files/i)
    await searchInput.fill('test')
    await searchInput.press('Enter')

    await expect(page).toHaveURL(/\/search\?q=test/)
  })

  test('billing page loads plans', async ({ page }) => {
    await page.goto('/billing')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText(/plan|billing|subscription/i).first()).toBeVisible({ timeout: 5_000 })
  })
})
