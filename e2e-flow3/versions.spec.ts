import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
import { F, dismissOverlays, openMenu } from './lib'
test('versions probe', async ({ page }) => {
  test.setTimeout(240_000)
  const reqs: string[] = []
  page.on('request', r => { if (/\/api\/v1\/(files|upload)/.test(r.url()) && r.method() !== 'GET') reqs.push(`${r.method()} ${r.url().replace('http://localhost:3333', '')} ${(r.postData() ?? '').slice(0, 160)}`) })
  page.on('response', async r => { if (/\/api\/v1\/(files|upload)/.test(r.url()) && r.request().method() !== 'GET') reqs.push(`  <- ${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`) })
  await signupAndUnlock(page, { email: uniqueEmail('flow3v'), password: 'Flow3-correct-horse-9' })
  await page.waitForTimeout(3000); await dismissOverlays(page)
  const inp = page.locator('input[type=file]:not([webkitdirectory])').first()
  fs.mkdirSync(F + '/fixtures/v1', { recursive: true }); fs.mkdirSync(F + '/fixtures/v2', { recursive: true })
  fs.writeFileSync(F + '/fixtures/v1/notes.txt', 'version one\n'); fs.writeFileSync(F + '/fixtures/v2/notes.txt', 'version TWO is longer\n')
  const up = async (path: string) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /^Upload$|^Upload files$/ }).first().click()]); await fc.setFiles(path) }
  await up(F + '/fixtures/v1/notes.txt')
  await expect(page.locator('[role=row]').filter({ hasText: 'notes.txt' })).toHaveCount(1, { timeout: 30_000 })
  await page.waitForTimeout(3000)
  reqs.push('---- second upload (same name, different content) ----')
  await up(F + '/fixtures/v2/notes.txt')
  await page.waitForTimeout(8000)
  await page.screenshot({ path: F + '/shots/V-after-second-upload.png' })
  const before = await page.locator('[role=row]').filter({ hasText: 'notes.txt' }).count()
  await page.reload(); await page.waitForTimeout(5000); await dismissOverlays(page)
  const after = await page.locator('[role=row]').filter({ hasText: 'notes.txt' }).count()
  const list = await page.request.get('http://localhost:3333/api/v1/files')
  fs.writeFileSync(F + '/versions-probe.txt', [`rows before reload=${before} after reload=${after}`, `GET /files -> ${list.status()}`, (await list.text()).slice(0, 3000), ...reqs].join('\n'))
  if (after === 1) { await openMenu(page, 'notes.txt'); fs.appendFileSync(F + '/versions-probe.txt', '\nmenu: ' + (await page.getByRole('menuitem').allInnerTexts()).join(' / ')) }
})
