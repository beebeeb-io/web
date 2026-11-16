import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { submitSignIn, restoreWithPhrase, expectDrive, uploadAndSettle } from './after-password-change-shim'
const acc = JSON.parse(fs.readFileSync(process.env.KIT_ACCOUNTS_OUT ?? '/private/tmp/kit1887-accounts.json', 'utf8'))
test('A signs in on the web and uploads a file (proves upload is allowed for the QA accounts)', async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 160)) })
  page.on('response', async (r) => { if (r.url().includes('/uploads/init')) console.log('INIT', r.status(), (await r.text().catch(() => '')).slice(0, 300)) })
  await submitSignIn(page, acc.a.email, acc.a.password)
  const phraseBox = page.getByLabel('Recovery word 1', { exact: true })
  const drive = page.getByText(/All files/i).first()
  await Promise.race([phraseBox.waitFor({ timeout: 45_000 }).catch(() => {}), drive.waitFor({ timeout: 45_000 }).catch(() => {})])
  if (await phraseBox.isVisible().catch(() => false)) { console.log('NOTE: web asked for the recovery phrase on first sign-in'); await restoreWithPhrase(page, acc.a.recoveryPhrase) }
  await expectDrive(page)
  await uploadAndSettle(page, 'rehearse.txt', 'kit 1887 rehearsal\n')
})
