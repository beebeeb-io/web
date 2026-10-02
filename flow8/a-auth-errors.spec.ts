import { test, expect } from '@playwright/test'
import fs from 'fs'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
const E = '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-8'
const PW = 'Correct-Horse-Battery-Staple-42'

test('auth error messages walk', async ({ page, browser }) => {
  const email = uniqueEmail('flow8a')
  fs.writeFileSync(E + '/acct-a.txt', email)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  const acct = await signupAndUnlock(page, { email, password: PW })
  fs.writeFileSync(E + '/acct-a-phrase.txt', acct.recoveryPhrase)
  await page.screenshot({ path: E + '/web-01-after-signup.png' })

  // fresh browser context = new device, no vault
  const ctx = await browser.newContext()
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const p2 = await ctx.newPage()
  await p2.goto('/login?nodev=1')
  await p2.goto('/login?nodev=1')
  await p2.getByPlaceholder('you@example.com').fill(email)
  await p2.getByPlaceholder('Your password').last().fill('totally-wrong-password-1')
  await p2.locator('button[type=submit]').first().click()
  await p2.waitForTimeout(4000)
  const msg1 = await p2.locator('body').innerText()
  fs.writeFileSync(E + '/web-02-wrong-password.txt', msg1)
  await p2.screenshot({ path: E + '/web-02-wrong-password.png' })

  // hammer to trigger lockout
  for (let i = 0; i < 8; i++) {
    await p2.getByPlaceholder('Your password').last().fill('totally-wrong-password-' + i)
    await p2.locator('button[type=submit]').first().click()
    await p2.waitForTimeout(2500)
  }
  fs.writeFileSync(E + '/web-03-after-9-wrong.txt', await p2.locator('body').innerText())
  await p2.screenshot({ path: E + '/web-03-after-9-wrong.png' })

  // correct password now (locked?)
  await p2.getByPlaceholder('Your password').last().fill(PW)
  await p2.locator('button[type=submit]').first().click()
  await p2.waitForTimeout(5000)
  fs.writeFileSync(E + '/web-04-correct-while-locked.txt', await p2.locator('body').innerText())
  await p2.screenshot({ path: E + '/web-04-correct-while-locked.png' })
  await ctx.close()
})
