import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import * as fs from 'fs'
import * as crypto from 'crypto'
function b32(s: string) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
const authenticator = { generate(secret: string) { const ctr = Math.floor(Date.now() / 30000); const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr)); const h = crypto.createHmac('sha1', b32(secret)).update(b).digest(); const o = h[h.length - 1] & 15; return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0') } }
import { fillSignupForm, reachPasswordStep, createAccount, uniqueEmail } from '../e2e/helpers/signup'
import { F, FX, Recorder, dismissOverlays, saveDownload, openMenu, menuItem, sha } from './lib'
const PW = 'Flow3-correct-horse-9'

async function addAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const r = await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } as any })
  return { client, id: r.authenticatorId }
}
async function nextTotp(secret: string, last?: string) {
  let c = authenticator.generate(secret)
  // avoid reusing the same code (replay protection) — wait for next window
  while (c === last) { await new Promise(r => setTimeout(r, 2000)); c = authenticator.generate(secret) }
  return c
}
async function passwordLogin(page: Page, email: string) {
  await page.goto('/login')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
  await page.getByLabel(/email/i).fill(email)
  await page.getByPlaceholder('Your password').fill(PW)
  await page.getByRole('button', { name: /^sign in$/i }).click()
}
async function signOutViaMenu(page: Page, email: string) {
  await dismissOverlays(page)
  await page.getByRole('button', { name: new RegExp(email.slice(0, 12)) }).last().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: F + '/shots/B-account-menu.png' })
  const so = page.getByRole('menuitem', { name: /sign out|log out/i }).or(page.getByRole('button', { name: /sign out|log out/i })).first()
  await so.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: F + '/shots/B-after-signout-click.png' })
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const warned = /recovery phrase/i.test(body) && !/\/login/.test(page.url())
  const confirm = page.getByRole('button', { name: /^(sign out|log out|yes)/i })
  if (!/\/login/.test(page.url()) && await confirm.first().isVisible().catch(() => false)) await confirm.first().click()
  await page.waitForURL(/\/login/, { timeout: 20_000 })
  return warned
}
test('journey B: 2FA, passkey, new device', async ({ page, browser }) => {
  test.setTimeout(1_200_000)
  const rec = new Recorder(F + '/results-b.json', () => page)
  const email = uniqueEmail('flow3b')
  let phrase = ''
  let secret = ''
  let lastCode = ''
  const ok = await rec.step('B01 signup + upload photo.png', async () => {
    await fillSignupForm(page, { email })
    phrase = (await reachPasswordStep(page)).join(' ')
    await createAccount(page, PW)
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 })
    await page.waitForTimeout(2000); await dismissOverlays(page)
    await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles(FX + '/photo.png')
    await expect(page.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 60_000 })
    fs.writeFileSync(F + '/acct-b.json', JSON.stringify({ email, password: PW, phrase }))
    return email
  })
  await rec.step('B02 sign out via account menu (warns that the recovery phrase is needed to sign back in?)', async () => {
    const warned = await signOutViaMenu(page, email)
    if (!warned) throw new Error('signed out with no warning that signing back in on this browser requires the 12-word recovery phrase (logout wipes the local vault); see shots/B-account-menu.png, B-after-signout-click.png')
    return 'warned'
  }, { blockedIf: !ok })
  await rec.step('B03 sign in with password on the same browser after sign-out lands on drive without the phrase', async () => {
    if (!/\/login/.test(page.url())) await page.goto('/login')
    await passwordLogin(page, email)
    const res = await Promise.race([
      page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 }).then(() => 'drive'),
      page.getByLabel('Recovery word 1', { exact: true }).waitFor({ timeout: 40_000 }).then(() => 'phrase'),
    ])
    await page.screenshot({ path: F + '/shots/B03-after-password-login.png' })
    if (res === 'phrase') {
      await page.getByLabel('Recovery word 1', { exact: true }).fill(phrase)
      await page.getByRole('button', { name: /restore vault/i }).click()
      await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 })
      throw new Error('returning user on the SAME browser was asked for the 12-word recovery phrase after password sign-in ("Set up this device — This device doesn\'t have your encryption keys yet"); restored with phrase to continue')
    }
    return 'drive without phrase'
  }, { blockedIf: !ok })
  await dismissOverlays(page)
  const tfa = await rec.step('B04 enable 2FA (TOTP) in Settings > Security', async () => {
    await page.goto('/settings/security')
    await page.getByRole('button', { name: /^Set up$/ }).first().click()
    const code = page.locator('code').filter({ hasText: /^[A-Z2-7]{16,}$/ }).first()
    await expect(code).toBeVisible({ timeout: 15_000 })
    secret = (await code.innerText()).trim()
    lastCode = await nextTotp(secret)
    await page.getByPlaceholder('6-digit code').fill(lastCode)
    await page.getByRole('button', { name: /^Verify$/ }).click()
    await expect(page.getByRole('button', { name: /I've saved these codes/ })).toBeVisible({ timeout: 15_000 })
    const backup = (await page.locator('body').innerText()).match(/\b[a-z0-9]{4,5}-[a-z0-9]{4,5}\b/gi) ?? []
    await page.screenshot({ path: F + '/shots/B04-2fa-backup-codes.png' })
    await page.getByRole('button', { name: /I've saved these codes/ }).click()
    await expect(page.getByText('Enabled').first()).toBeVisible({ timeout: 10_000 })
    return `secret len ${secret.length}; backup-code-like tokens shown: ${backup.length}; status Enabled`
  }, { blockedIf: !ok })
  await rec.step('B05 sign out -> sign in with password + TOTP', async () => {
    await page.goto('/logout'); await page.waitForURL(/\/login/, { timeout: 20_000 })
    await passwordLogin(page, email)
    const inp = page.getByLabel('6-digit verification code')
    await inp.waitFor({ state: 'attached', timeout: 30_000 })
    await page.screenshot({ path: F + '/shots/B05-2fa-prompt.png' })
    lastCode = await nextTotp(secret, lastCode)
    await page.keyboard.type(lastCode)
    const res = await Promise.race([
      page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 }).then(() => 'drive'),
      page.getByLabel('Recovery word 1', { exact: true }).waitFor({ timeout: 40_000 }).then(() => 'phrase'),
    ])
    if (res === 'phrase') { await page.getByLabel('Recovery word 1', { exact: true }).fill(phrase); await page.getByRole('button', { name: /restore vault/i }).click(); await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 }) }
    await expect(page.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 30_000 })
    return `2FA accepted (then ${res === 'phrase' ? 'phrase required again' : 'drive'}); photo.png listed`
  }, { blockedIf: !tfa })
  await rec.step('B05b wrong TOTP code is rejected', async () => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const p = await ctx.newPage()
    await passwordLogin(p, email)
    await p.getByLabel('6-digit verification code').waitFor({ state: 'attached', timeout: 30_000 })
    await p.keyboard.type('000000')
    await p.waitForTimeout(4000)
    const url = p.url(); const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
    await ctx.close()
    if (!/\/login/.test(url)) throw new Error('wrong TOTP was accepted: ' + url)
    return 'stayed on /login; ' + (t.match(/invalid[^.]*\.|incorrect[^.]*\./i)?.[0] ?? t.slice(0, 120))
  }, { blockedIf: !tfa })
  let pk: { client: any; id: string } | null = null
  const pkOk = await rec.step('B06 add passkey (virtual authenticator, step-up with password)', async () => {
    pk = await addAuthenticator(page)
    await page.goto('/settings/security')
    await dismissOverlays(page)
    await page.getByRole('button', { name: /^Add passkey$/ }).click()
    const pw = page.getByRole('dialog').last().locator('input[type=password]').first()
    await pw.fill(PW)
    await page.getByRole('dialog').last().getByRole('button', { name: /confirm|continue|verify/i }).last().click()
    // 2FA may be required in the step-up too
    const tf = page.getByRole('dialog').last().getByPlaceholder(/6-digit|code/i)
    if (await tf.isVisible({ timeout: 2000 }).catch(() => false)) { lastCode = await nextTotp(secret, lastCode); await tf.fill(lastCode); await page.getByRole('dialog').last().getByRole('button', { name: /confirm|continue|verify/i }).last().click() }
    await expect(page.getByTestId('passkey-row')).toHaveCount(1, { timeout: 30_000 })
    const creds = await pk!.client.send('WebAuthn.getCredentials', { authenticatorId: pk!.id })
    await page.screenshot({ path: F + '/shots/B06-passkey-added.png' })
    return `passkey-row count=1; authenticator holds ${creds.credentials.length} credential(s)`
  }, { blockedIf: !ok })
  await rec.step('B07 sign out -> Sign in with passkey -> drive', async () => {
    await page.goto('/logout'); await page.waitForURL(/\/login/, { timeout: 20_000 })
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
    await page.getByRole('button', { name: /Sign in with passkey/ }).click()
    await page.getByLabel(/email/i).fill(email)
    await page.getByRole('button', { name: /Continue with passkey/ }).click()
    const res = await Promise.race([
      page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 }).then(() => 'drive'),
      page.getByLabel('Recovery word 1', { exact: true }).waitFor({ timeout: 40_000 }).then(() => 'phrase'),
      page.getByLabel('6-digit verification code').waitFor({ state: 'attached', timeout: 40_000 }).then(() => '2fa'),
    ])
    await page.screenshot({ path: F + '/shots/B07-after-passkey.png' })
    if (res === '2fa') { lastCode = await nextTotp(secret, lastCode); await page.keyboard.type(lastCode); await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 }).catch(() => {}) }
    if (res === 'phrase') throw new Error('passkey sign-in asked for the recovery phrase')
    await expect(page.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 30_000 })
    return `passkey sign-in -> ${res} -> drive, photo.png decrypts`
  }, { blockedIf: !pkOk })
  await rec.step('B08 new device: fresh context, password + TOTP -> 12-word phrase -> drive, download byte-equal', async () => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
    const p = await ctx.newPage()
    try {
      await passwordLogin(p, email)
      await p.getByLabel('6-digit verification code').waitFor({ state: 'attached', timeout: 30_000 })
      lastCode = await nextTotp(secret, lastCode)
      await p.keyboard.type(lastCode)
      await p.getByLabel('Recovery word 1', { exact: true }).waitFor({ timeout: 40_000 })
      await p.screenshot({ path: F + '/shots/B08-new-device-phrase.png' })
      await p.getByLabel('Recovery word 1', { exact: true }).fill(phrase)
      await p.getByRole('button', { name: /restore vault/i }).click()
      await p.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 })
      await p.waitForTimeout(2000); await dismissOverlays(p)
      await expect(p.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 30_000 })
      await openMenu(p, 'photo.png')
      const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), menuItem(p, /^Download/)])
      const got = sha(await saveDownload(d, 'b-newdevice-photo.png'))
      if (got !== sha(FX + '/photo.png')) throw new Error('new-device download not byte-equal')
      return 'new device restored; photo.png byte-equal'
    } finally { await ctx.close() }
  }, { blockedIf: !tfa })
})
