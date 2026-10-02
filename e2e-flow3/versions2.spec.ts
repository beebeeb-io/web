import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
import { F, dismissOverlays } from './lib'
for (const mode of ['no-reload', 'reload-between', 'same-content']) {
  test('versions ' + mode, async ({ page }) => {
    test.setTimeout(240_000)
    await signupAndUnlock(page, { email: uniqueEmail('flow3v'), password: 'Flow3-correct-horse-9' })
    await page.waitForTimeout(3000); await dismissOverlays(page)
    const inp = page.locator('input[type=file]:not([webkitdirectory])').first()
    await inp.setInputFiles(F + '/fixtures/v1/notes.txt')
    await expect(page.locator('[role=row]').filter({ hasText: 'notes.txt' })).toHaveCount(1, { timeout: 30_000 })
    await page.waitForTimeout(3000)
    if (mode === 'reload-between') { await page.reload(); await expect(page.locator('[role=row]').filter({ hasText: 'notes.txt' })).toHaveCount(1, { timeout: 30_000 }); await page.waitForTimeout(3000); await dismissOverlays(page) }
    await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles(F + (mode === 'same-content' ? '/fixtures/v1/notes.txt' : '/fixtures/v2/notes.txt'))
    await page.waitForTimeout(8000)
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const n = await page.locator('[role=row]').filter({ hasText: 'notes.txt' }).count()
    await page.screenshot({ path: `${F}/shots/V2-${mode}.png` })
    fs.appendFileSync(F + '/versions2.txt', `${mode}: rows=${n} dupBanner=${/already uploaded|duplicate/i.test(body)} replaceDlg=${/Keep both/.test(body)}\n`)
  })
}
