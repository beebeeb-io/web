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
  const m = blocks[blocks.length - 1].match(/verify your Beebeeb account: (\d{8})/)
  return m![1]
}

test('verify email -> welcome', async ({ page }) => {
  const email = uniqueEmail('flow8d')
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email, password: PW })
  await page.waitForTimeout(1500)
  const code = lastCode(email)
  await page.getByRole('button', { name: /^enter code$/i }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: /^verify$/i }).click()
  await page.waitForTimeout(4000)
  await snap(page, 'web-26-verified')
})
