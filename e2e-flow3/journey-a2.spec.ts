import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { fillSignupForm, reachPasswordStep, createAccount, uniqueEmail } from '../e2e/helpers/signup'
import { F, FX, Recorder, dismissOverlays, saveDownload, openMenu, menuItem, sha, shaStream, lastEmailCode } from './lib'

const PW = 'Flow3-correct-horse-9'
test('journey A2: verify, trash, search, sign out/in', async ({ page }) => {
  test.setTimeout(3_000_000)
  const rec = new Recorder(F + '/results-a2.json', () => page)
  const email = uniqueEmail('flow3a')
  let phrase: string[] = []
  const consoleErrs: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)) })

  const signedUp = await rec.step('A01 signup email -> phrase -> password lands on drive', async () => {
    const t0 = Date.now()
    await fillSignupForm(page, { email })
    phrase = await reachPasswordStep(page)
    await createAccount(page, PW)
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 20_000 })
    fs.writeFileSync(F + '/acct-a2.json', JSON.stringify({ email, password: PW, phrase: phrase.join(' ') }))
    await page.screenshot({ path: F + '/shots/A01-drive.png' })
    return `email=${email} phrase words=${phrase.length} took ${Date.now() - t0}ms`
  })
  await rec.step('A02 onboarding checklist / welcome tour visible', async () => {
    await expect(page.getByText(/Upload your first file/i).first()).toBeVisible({ timeout: 15_000 })
    const t = await page.locator('body').innerText()
    const hasTour = /Upload your first file/i.test(t)
    const hasWelcomeDoc = /Welcome to Beebeeb/i.test(t)
    if (!hasTour) throw new Error('welcome tour not visible')
    return `tour step "Upload your first file" visible; welcome doc present=${hasWelcomeDoc}`
  }, { blockedIf: !signedUp })
  await rec.step('A03 verify email with console-mode code', async () => {
    await page.getByRole('button', { name: 'Enter code' }).click()
    let code: string | null = null
    for (let i = 0; i < 20 && !code; i++) { code = lastEmailCode(F + '/stack/api.log', email); if (!code) await page.waitForTimeout(500) }
    if (!code) throw new Error('no 6-digit code found in api.log for ' + email)
    const inp = page.locator('input[inputmode=numeric], input[autocomplete=one-time-code], input[maxlength="6"]').first()
    await inp.fill(code)
    const verifyBtn = page.getByRole('button', { name: /^(Verify|Confirm|Submit)/i }).first()
    if (await verifyBtn.isVisible().catch(() => false)) await verifyBtn.click()
    await expect(page.getByText(/Check your email for a verification code/)).toHaveCount(0, { timeout: 15_000 })
    return `code ${code} accepted; banner gone`
  }, { blockedIf: !signedUp })
  await dismissOverlays(page)

  const fileInput = page.locator('input[type=file]:not([webkitdirectory])').first()
  await fileInput.setInputFiles([FX + '/hello.txt', FX + '/photo.png'])
  await expect(page.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type=file][webkitdirectory]').first().setInputFiles(FX + '/folder')
  await expect(page.locator('[role=row]').filter({ hasText: 'folder' }).first()).toBeVisible({ timeout: 60_000 })
  await rec.step('A12b rename hello.txt -> hello-renamed.txt', async () => {
    await openMenu(page, 'hello.txt')
    await menuItem(page, /^Rename/)
    const inp = page.getByLabel('New name')
    await inp.fill('hello-renamed.txt')
    await inp.press('Enter')
    await expect(page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' })).toBeVisible({ timeout: 15_000 })
    return 'ok'
  }, { blockedIf: !signedUp })
  await rec.step('A16 trash -> restore -> trash -> empty trash', async () => {
    await openMenu(page, 'hello-renamed.txt')
    await menuItem(page, /^Move to trash/)
    const confirmBtn = page.getByRole('button', { name: /^(Move to trash|Trash|Delete)$/ })
    if (await confirmBtn.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.first().click()
    await expect(page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' })).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('link', { name: 'Trash' }).click()
    await expect(page.getByText('hello-renamed.txt').first()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: F + '/shots/A16-trash.png' })
    const trow = page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' }).first()
    await trow.hover()
    const restoreBtn = page.getByRole('button', { name: /Restore/ }).first()
    await restoreBtn.click()
    await page.waitForTimeout(2000)
    await page.getByRole('link', { name: 'All files' }).click()
    await expect(page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' })).toBeVisible({ timeout: 20_000 })
    const restoredDl = await (async () => { await openMenu(page, 'hello-renamed.txt'); const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), menuItem(page, /^Download/)]); return sha(await saveDownload(d, 'restored.txt')) })()
    if (restoredDl !== sha(FX + '/hello.txt')) throw new Error('restored file content differs')
    await openMenu(page, 'hello-renamed.txt')
    await menuItem(page, /^Move to trash/)
    if (await confirmBtn.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.first().click()
    await page.getByRole('link', { name: 'Trash' }).click()
    await expect(page.getByText('hello-renamed.txt').first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Empty trash/i }).first().click()
    const conf = page.getByRole('dialog').last().getByRole('button', { name: /Empty|Delete/i }).last()
    if (await conf.isVisible({ timeout: 3000 }).catch(() => false)) await conf.click()
    await expect(page.getByText('hello-renamed.txt')).toHaveCount(0, { timeout: 20_000 })
    return 'trashed, restored (byte-equal), re-trashed, emptied'
  }, { blockedIf: !signedUp })
  await page.getByRole('link', { name: 'All files' }).click().catch(() => {})

  await rec.step('A17 search finds photo.png and a nested file (c.txt)', async () => {
    await dismissOverlays(page)
    await page.getByRole('button', { name: /Search files and folders/ }).click()
    const inp = page.getByRole('dialog').last().locator('input').first()
    await inp.fill('photo')
    await expect(page.getByRole('dialog').last().getByText('photo.png').first()).toBeVisible({ timeout: 15_000 })
    await inp.fill('c.txt')
    await expect(page.getByRole('dialog').last().getByText('c.txt').first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: F + '/shots/A17-search.png' })
    await page.keyboard.press('Escape')
    return 'palette search hits for photo.png and nested c.txt'
  }, { blockedIf: !signedUp })

  await rec.step('A18 sign out', async () => {
    await page.goto('/logout')
    await page.waitForURL(/\/login/, { timeout: 20_000 })
    const me = await page.request.get('http://localhost:3333/api/v1/auth/me')
    if (me.status() !== 401) throw new Error('after logout /auth/me = ' + me.status())
    return 'landed on /login; /auth/me 401'
  }, { blockedIf: !signedUp })
  await rec.step('A19 sign in with password (same browser) -> drive with files', async () => {
    await page.goto('/login')
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
    await page.getByLabel(/email/i).fill(email)
    await page.getByPlaceholder('Your password').fill(PW)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 40_000 })
    await expect(page.locator('[role=row]').filter({ hasText: 'photo.png' })).toBeVisible({ timeout: 30_000 })
    return 'signed in; photo.png listed (names decrypt)'
  }, { blockedIf: !signedUp })
  fs.writeFileSync(F + '/console-errors-a2.txt', consoleErrs.join('\n'))
})
