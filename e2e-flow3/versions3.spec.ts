import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
import { F, dismissOverlays } from './lib'
test('versions diag', async ({ page }) => {
  test.setTimeout(240_000)
  const logs: string[] = []
  page.on('request', r => { if (/uploads\/init|\/files\//.test(r.url()) && r.method() !== 'GET') { let fid = ''; try { fid = JSON.parse(r.postData() || '{}').file_id } catch {} ; logs.push(`REQ ${r.method()} ${r.url().replace('http://localhost:3333', '')} body.file_id=${fid}`) } })
  page.on('response', async r => { if (/uploads\/init/.test(r.url())) { const j = await r.json().catch(() => ({})); logs.push(`RES init ${r.status()} file_id=${j.file_id} protocol=${j.protocol}`) } })
  page.on('console', m => { if (m.text().includes('FLOW3DIAG')) logs.push(m.text()) })
  await signupAndUnlock(page, { email: uniqueEmail('flow3v'), password: 'Flow3-correct-horse-9' })
  await page.waitForTimeout(3000); await dismissOverlays(page)
  const inp = page.locator('input[type=file]:not([webkitdirectory])').first()
  await inp.setInputFiles(F + '/fixtures/v1/notes.txt')
  await expect(page.locator('[role=row]').filter({ hasText: 'notes.txt' })).toHaveCount(1, { timeout: 30_000 })
  await page.waitForTimeout(3000)
  await inp.setInputFiles(F + '/fixtures/v2/notes.txt')
  await page.waitForTimeout(6000)
  fs.writeFileSync(F + '/versions-diag.txt', logs.join('\n'))
})
