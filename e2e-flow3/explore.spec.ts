import { test, expect } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
import * as fs from 'fs'
const F = '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-3'
test('explore', async ({ page }) => {
  const acct = await signupAndUnlock(page, { email: uniqueEmail('flow3a'), password: 'Flow3-correct-horse-9' })
  fs.writeFileSync(F + '/acct-explore.json', JSON.stringify(acct))
  await page.waitForTimeout(3000)
  await page.screenshot({ path: F + '/shots/01-drive-after-signup.png', fullPage: true })
  const inputs = await page.locator('input[type=file]').evaluateAll(els => els.map(e => ({ multiple: (e as HTMLInputElement).multiple, dir: e.hasAttribute('webkitdirectory'), accept: e.getAttribute('accept'), id: e.id, testid: e.getAttribute('data-testid') })))
  const buttons = await page.getByRole('button').evaluateAll(els => els.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)))
  fs.writeFileSync(F + '/explore-drive.json', JSON.stringify({ inputs, buttons, text: (await page.locator('body').innerText()).slice(0, 4000) }, null, 1))
})
