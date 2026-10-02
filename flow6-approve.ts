// Flow-6 audit driver (not committed): real signup through the local web app,
// then approve a CLI device code at /cli-auth?code=... in the same browser.
// Usage: bun flow6-approve.ts <email> <password> <code> <outdir> [signup|login]
import { chromium } from '@playwright/test'

const [email, password, code, outdir, mode = 'signup'] = process.argv.slice(2)
const WEB = 'http://localhost:5360'

const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addInitScript(() => {
  localStorage.setItem('bb_cookie_consent', 'all')
  sessionStorage.setItem('bb_dev_authed', 'skipped')
})
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)) })
const shot = (n: string) => page.screenshot({ path: `${outdir}/${n}.png`, fullPage: true })

try {
  if (mode === 'signup') {
    await page.goto(`${WEB}/signup?nodev=1`)
    await page.getByLabel(/email/i).fill(email)
    await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await page.waitForURL(/\/onboarding/, { timeout: 20000 })
    const wordEls = page.locator('span.font-mono.text-sm.font-medium')
    await wordEls.nth(11).waitFor({ timeout: 30000 })
    const words = (await wordEls.allInnerTexts()).map((w) => w.trim())
    console.log('PHRASE', words.join(' '))
    await page.getByRole('checkbox', { name: /I've saved my recovery phrase offline/i }).click()
    await page.getByRole('button', { name: /I saved it/i }).click()
    const labels = page.locator('label', { hasText: /^Word #\d+$/ })
    const n = await labels.count()
    for (let i = 0; i < n; i++) {
      const t = (await labels.nth(i).innerText()).trim()
      const idx = parseInt(t.match(/Word #(\d+)/)![1], 10) - 1
      await page.getByLabel(t, { exact: true }).fill(words[idx])
    }
    await page.getByRole('button', { name: /^verify$/i }).click()
    await page.getByPlaceholder('At least 12 characters').fill(password)
    await page.getByPlaceholder('Type it again').fill(password)
    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL((u) => !/onboarding|signup/.test(u.pathname), { timeout: 90000 })
    await page.waitForTimeout(3000)
    await shot('01-after-signup')
    console.log('AFTER_SIGNUP_URL', page.url())
  } else {
    // documented flow: open the CLI link while signed out -> login -> back to /cli-auth
    await page.goto(`${WEB}/cli-auth?code=${encodeURIComponent(code)}&nodev=1`)
    await page.waitForURL(/\/login/, { timeout: 20000 })
    console.log('REDIRECTED_TO', page.url())
    await page.getByLabel(/email/i).fill(email)
    await page.getByPlaceholder('Your password').fill(password)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    const restore = page.getByRole('button', { name: /Restore vault/i })
    await Promise.race([restore.waitFor({ timeout: 60000 }), page.waitForURL((u) => u.pathname.startsWith('/cli-auth'), { timeout: 60000 })]).catch(() => {})
    if (await restore.isVisible().catch(() => false)) {
      console.log('NEW_DEVICE_RESTORE_PROMPT')
      await shot('01b-new-device-restore')
      const words = (process.env.PHRASE ?? '').split(' ')
      const boxes = page.locator('input')
      for (let i = 0; i < 12; i++) await boxes.nth(i).fill(words[i])
      await restore.click()
    }
    await page.waitForURL((u) => u.pathname.startsWith('/cli-auth'), { timeout: 60000 })
    console.log('BACK_AT', page.url())
    await page.waitForTimeout(2000)
  }
  if (!page.url().includes('cli-auth')) {
  await page.goto(`${WEB}/cli-auth?code=${encodeURIComponent(code)}`)
  }
  await page.waitForTimeout(3000)
  await shot('02-cli-auth-page')
  const btn = page.getByRole('button', { name: /Authorize CLI access/i })
  await btn.waitFor({ timeout: 30000 })
  await btn.click()
  await page.getByText(/You're all set/i).waitFor({ timeout: 30000 })
  await shot('03-cli-auth-success')
  console.log('APPROVED')
  // keep cookies for later checks
  await ctx.storageState({ path: `${outdir}/storage-${mode}.json` })
} catch (e) {
  console.log('FAIL', (e as Error).message.slice(0, 800))
  await shot('99-fail').catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
