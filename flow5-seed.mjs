import { chromium } from '@playwright/test'
const [email, password, phrase, file, shot] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage(); p.on('dialog', d => d.accept())
await p.goto('http://localhost:5350/login?nodev=1')
await p.waitForSelector('body[data-crypto-ready="true"]', { timeout: 60000 })
try {
await p.locator('#login-email').fill(email)
const alt = p.getByText('Sign in with password instead')
if (await alt.isVisible().catch(() => false)) await alt.click()
await p.getByPlaceholder('Your password').fill(password)
await p.getByRole('button', { name: /^sign in$/i }).click()
} catch (e) { await p.screenshot({ path: shot + '.err.png' }); throw e }
const prov = p.getByLabel('Recovery word 1', { exact: true })
const w = await Promise.race([
  p.waitForURL(/5350\/(?:$|\?|#)/, { timeout: 60000 }).then(() => 'drive').catch(() => null),
  prov.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'prov').catch(() => null),
])
console.log('after login:', w)
if (w === 'prov') {
  await prov.fill(phrase)
  await p.getByRole('button', { name: /restore vault/i }).click()
  await p.waitForURL(/5350\/(?:$|\?|#)/, { timeout: 60000 })
}
const dismiss = p.getByRole('button', { name: /^(Skip for now|Close)$/ })
if (await dismiss.first().isVisible().catch(() => false)) await dismiss.first().click()
await p.locator('input[type="file"]').first().setInputFiles(file)
const name = file.split('/').pop()
await p.getByText(name, { exact: false }).first().waitFor({ timeout: 60000 })
await p.waitForTimeout(3000)
await p.screenshot({ path: shot })
console.log('uploaded', name)
await b.close()
