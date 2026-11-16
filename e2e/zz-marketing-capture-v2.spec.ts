import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { signupAndUnlock } from './helpers/signup'
import { uploadTextFile, openRowMenu } from './helpers/drive'

// Marketing screenshot v2 (isolated e2e stack only; made-up data; not committed).
const OUT = process.env.CAPTURE_OUT ?? '/tmp/bb-capture-v2'

test.use({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })

async function dismissOverlays(page: import('@playwright/test').Page) {
  for (let i = 0; i < 3; i++) {
    const dismiss = page.getByRole('button', { name: /^(Skip for now|Close)$/ })
    if (await dismiss.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
      await dismiss.first().click()
      await dismiss.first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
    }
  }
  const banner = page.getByRole('status').filter({ hasText: /verification code/i })
  if (await banner.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await banner.first().getByRole('button', { name: 'Dismiss' }).click().catch(() => {})
  }
}

test('capture v2', async ({ page, context }) => {
  test.setTimeout(300_000)
  fs.mkdirSync(OUT, { recursive: true })
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  await context.clearCookies()
  await signupAndUnlock(page, { email: 'studio@beebeeb.io', password: 'Marketing-Demo-2026-Kx9' })
  await dismissOverlays(page)

  const folders = ['Books 2023', 'Beebeeb BV', 'Designs']
  for (const f of folders) {
    await page.evaluate(() => window.dispatchEvent(new Event('beebeeb:new-folder-trigger')))
    const dlg = page.getByRole('dialog', { name: 'New folder' })
    await dlg.getByPlaceholder('e.g. Contracts').fill(f)
    await dlg.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(f, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
  }
  for (const f of folders) {
    await dismissOverlays(page)
    await openRowMenu(page, f)
    await page.getByRole('menuitem', { name: /Pin to Quick access/ }).click()
    await page.waitForTimeout(800)
  }

  const files: Array<[string, string]> = [
    ['Team roadmap.pptx', 'Q4 roadmap. Made-up.'],
    ['Supplier agreement.pdf', 'Supplier agreement. Made-up.'],
    ['Q3 report.xlsx', 'Q3 report. Made-up.'],
    ['Brand guidelines.docx', 'Brand guidelines. Made-up.'],
    ['Invoice 2026-041.pdf', 'Invoice. Made-up.'],
    ['Lisbon offsite.md', '# Lisbon offsite\n'],
    ['Budget 2027.xlsx', 'Budget. Made-up.'],
    ['Press kit notes.md', '# Press kit\n'],
  ]
  // made-up sizes so the list does not show a column of "17 B": pad each file to a plausible size
  const sizes: Record<string, number> = {
    'Team roadmap.pptx': 3_400_000, 'Supplier agreement.pdf': 880_000, 'Q3 report.xlsx': 412_000, 'Brand guidelines.docx': 1_900_000,
    'Invoice 2026-041.pdf': 96_000, 'Lisbon offsite.md': 4_200, 'Budget 2027.xlsx': 255_000, 'Press kit notes.md': 7_800,
  }
  for (const [n, b] of files) await uploadTextFile(page, n, b.padEnd(sizes[n] ?? 10_000, ' '))
  await dismissOverlays(page)

  await expect(page.getByText('Budget 2027.xlsx').first()).toBeVisible()
  await expect(page.getByText(/^Uploaded$/)).toHaveCount(0, { timeout: 90_000 })
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(2_000)
  await page.mouse.click(900, 30)
  await page.mouse.move(1450, 20)
  await page.waitForTimeout(800)

  await page.screenshot({ path: `${OUT}/web-drive-v3.png`, clip: { x: 0, y: 0, width: 1100, height: 700 } })
  fs.writeFileSync(`${OUT}/web-drive-v2.url.txt`, page.url() + '\n')
})
