import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { signupAndUnlock } from './helpers/signup'
import { uploadTextFile } from './helpers/drive'

// Marketing screenshots of the REAL web app, taken in the isolated e2e stack (own API, fresh DB,
// temp blob store). Never run against production. Made-up file names only; nothing personal in frame.
// Not committed anywhere: lives in a throwaway worktree.
const OUT = process.env.CAPTURE_OUT ?? '/tmp/bb-capture'

test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2, colorScheme: 'dark' })

test('capture the web app for the marketing site', async ({ page, context }) => {
  test.setTimeout(240_000)
  fs.mkdirSync(OUT, { recursive: true })
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  await context.clearCookies()

  await signupAndUnlock(page, { email: 'studio@beebeeb.io', password: 'Marketing-Demo-2026-Kx9' })

  const files: Array<[string, string]> = [
    ['Team roadmap.pptx', 'Q4 roadmap. Made-up content for a screenshot.'],
    ['Supplier agreement.pdf', 'Supplier agreement. Made-up content for a screenshot.'],
    ['Q3 report.xlsx', 'Q3 report. Made-up content for a screenshot.'],
    ['Lisbon offsite.md', '# Lisbon offsite\n\nMade-up notes for a screenshot.\n'],
    ['Brand guidelines.docx', 'Brand guidelines. Made-up content for a screenshot.'],
    ['Invoice 2026-041.pdf', 'Invoice. Made-up content for a screenshot.'],
    ['Press kit notes.md', '# Press kit\n\nMade-up notes for a screenshot.\n'],
    ['Budget 2027.xlsx', 'Budget. Made-up content for a screenshot.'],
  ]
  for (const [name, body] of files) await uploadTextFile(page, name, body)

  // the welcome tour can arrive late; dismiss it if it shows, then let the list settle
  for (let i = 0; i < 4; i++) {
    const dismiss = page.getByRole('button', { name: /^(Skip for now|Close)$/ })
    if (await dismiss.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
      await dismiss.first().click()
      await dismiss.first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
    }
  }
  // a real user can dismiss the verify-email banner; do that, then let the upload toasts expire
  const banner = page.getByRole('status').filter({ hasText: /verification code/i })
  if (await banner.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await banner.first().getByRole('button', { name: 'Dismiss' }).click()
  }
  await expect(page.getByText('Brand guidelines.docx').first()).toBeVisible()
  // wait until every 'Uploaded' toast has expired, then settle
  await expect(page.getByText(/^Uploaded$/)).toHaveCount(0, { timeout: 60_000 })
  await page.waitForTimeout(1_500)
  await page.mouse.move(600, 700)

  // clip above the sidebar storage block (its label reads 'free plan' in this stack)
  await page.screenshot({ path: `${OUT}/web-drive.png`, clip: { x: 0, y: 0, width: 1100, height: 566 } })
  fs.writeFileSync(`${OUT}/web-drive.url.txt`, page.url() + '\n')
})
