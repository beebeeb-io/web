import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { execSync } from 'child_process'
import { signupAndUnlock, uniqueEmail, fillSignupForm } from '../e2e/helpers/signup'
const E = '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-8'
const PW = 'Correct-Horse-Battery-Staple-42'
const psql = (sql: string) =>
  execSync(`docker exec -e PGPASSWORD=beebeeb_dev beebeebio-postgres-1 psql -U beebeeb -d beebeeb_web_e2e_flow8_1 -tAc "${sql}"`).toString().trim()

async function snap(page: Page, name: string) {
  fs.writeFileSync(`${E}/${name}.txt`, await page.locator('body').innerText())
  await page.screenshot({ path: `${E}/${name}.png` })
}

function lastCode(email: string): string {
  const log = fs.readFileSync(E + '/api.log', 'utf8').replace(/\x1b\[[0-9;]*m/g, '')
  const blocks = log.split('--- EMAIL (console mode) ---').filter((b) => b.includes(`To: ${email}`) && b.includes('Verify your email'))
  const m = blocks[blocks.length - 1].match(/verify your Beebeeb account: (\d{6})/)
  return m![1]
}

test('quota full, verify email, delete account, signup-attempt', async ({ page, browser }) => {
  const email = uniqueEmail('flow8c')
  fs.writeFileSync(E + '/acct-c.txt', email)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email, password: PW })

  // verify email via banner
  await page.waitForTimeout(1500)
  const code = lastCode(email)
  await page.getByRole('button', { name: /^enter code$/i }).click()
  await page.waitForTimeout(800)
  await snap(page, 'web-20-verify-dialog')
  await page.keyboard.type(code)
  await page.waitForTimeout(4000)
  await snap(page, 'web-21-after-verify')

  // quota full
  psql(`UPDATE files SET size_bytes = 5368709000 WHERE user_id = (SELECT id FROM users WHERE email='${email}') AND is_folder = FALSE`)
  await page.reload()
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(2000)
  await snap(page, 'web-22-quota-full-drive')
  const fp = `${E}/quota-upload.bin`
  fs.writeFileSync(fp, Buffer.alloc(200_000, 7))
  await page.locator('input[type=file]').first().setInputFiles(fp)
  await page.waitForTimeout(8000)
  await snap(page, 'web-23-quota-full-upload')

  // delete account
  await page.goto('/settings/delete-account')
  await expect(page.getByText(/Delete your account/i).first()).toBeVisible({ timeout: 10_000 })
  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page.getByRole('checkbox', { name: /files are encrypted and cannot be recovered/i }).click()
  await page.getByRole('button', { name: /^delete permanently$/i }).click()
  await expect(page.getByRole('dialog', { name: /confirm your identity/i })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel(/^password$/i).fill(PW)
  await page.getByRole('button', { name: /^delete account$/i }).click()
  await page.waitForTimeout(6000)
  await snap(page, 'web-24-after-delete')

  // signup attempt with existing email (account A)
  const ctx = await browser.newContext()
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const p2 = await ctx.newPage()
  await p2.goto('/signup?nodev=1')
  const a = fs.readFileSync(E + '/acct-a.txt', 'utf8').trim()
  await fillSignupForm(p2, { email: a })
  await p2.waitForTimeout(3000)
  await snap(p2, 'web-25-signup-existing-email')
  await ctx.close()
})
