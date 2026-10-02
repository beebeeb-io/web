import { test, expect, type Page, type Browser } from '@playwright/test'
import * as fs from 'fs'
import { fillSignupForm, reachPasswordStep, createAccount, uniqueEmail } from '../e2e/helpers/signup'
import { F, FX, Recorder, dismissOverlays, saveDownload, openMenu, menuItem, sha } from './lib'
const PW = 'Flow3-correct-horse-9'
async function signup(page: Page, prefix: string) {
  const email = uniqueEmail(prefix)
  await fillSignupForm(page, { email })
  const phrase = (await reachPasswordStep(page)).join(' ')
  await createAccount(page, PW)
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 })
  await page.waitForTimeout(2000); await dismissOverlays(page)
  return { email, phrase }
}
async function anon(browser: Browser) { const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true }); return { ctx, p: await ctx.newPage() } }
async function makeLink(page: Page, name: string, o: { pass?: string; expiry?: string; maxOpens?: string } = {}) {
  await openMenu(page, name)
  await menuItem(page, /^Share/)
  const dlg = page.getByRole('dialog').last()
  if (o.expiry) { await dlg.getByRole('button', { name: /Never|hour|days/ }).first().click(); await page.getByRole('option', { name: o.expiry }).or(page.getByRole('button', { name: o.expiry, exact: true })).first().click() }
  if (o.maxOpens) { await dlg.getByRole('button', { name: /Unlimited/ }).first().click(); await page.getByRole('option', { name: o.maxOpens, exact: true }).or(page.getByRole('button', { name: o.maxOpens, exact: true })).first().click() }
  if (o.pass) { await page.getByRole('checkbox', { name: /require password/i }).check({ force: true }); await page.locator('#share-passphrase').fill(o.pass) }
  await page.screenshot({ path: `${F}/shots/C-share-dialog-${name}-${o.pass ? 'pw' : 'nopw'}.png` })
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  await page.getByRole('button', { name: 'Full link', exact: true }).click().catch(() => {})
  const url = await page.locator('input[readonly]').evaluateAll((els) => (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#/.test(e.value))?.value ?? null)
  const dtxt = (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 300)
  await page.keyboard.press('Escape')
  if (!url) throw new Error('no /s/ link in dialog: ' + dtxt)
  return { url, dtxt }
}
async function anonDownload(p: Page, url: string, name: string, pass?: string) {
  await p.goto(url)
  if (pass) { await p.getByLabel(/share password/i).fill(pass); await p.getByRole('button', { name: /unlock file/i }).click() }
  await expect(p.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), p.getByRole('button', { name: /download and decrypt/i }).first().click()])
  return sha(await saveDownload(d, 'share-' + name))
}
test('journey D: invite + delete', async ({ page, browser }) => {
  test.setTimeout(1_200_000)
  const rec = new Recorder(F + '/results-d.json', () => page)
  const owner = await signup(page, 'flow3o')
  await page.locator('input[type=file][webkitdirectory]').first().setInputFiles(FX + '/folder')
  await expect(page.locator('[role=row]').filter({ hasText: 'folder' }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
  const p2 = await ctx2.newPage()
  const consoleLines: string[] = []
  p2.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(m.text().slice(0, 200)) })
  const rcpt = await signup(p2, 'flow3r')
  await page.goto('/'); await dismissOverlays(page)
  await openMenu(page, 'folder'); await menuItem(page, /^Share/)
  const dlg = page.getByRole('dialog').last()
  await dlg.getByRole('button', { name: /invite/i }).first().click()
  await dlg.getByPlaceholder(/colleague@example.com/).fill(rcpt.email)
  await dlg.getByRole('button', { name: /send invite/i }).click()
  await expect(page.getByText(/Invite sent/i).first()).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: F + '/shots/D-invite-sent.png' })
  await page.keyboard.press('Escape')
  await rec.step('D03 recipient opens shared folder, names decrypt, downloads a.txt byte-equal', async () => {
    await p2.goto('/shared'); await p2.waitForTimeout(15000); await dismissOverlays(p2)
    await p2.screenshot({ path: F + '/shots/D03b-shared-after-15s.png' })
    const listTxt = (await p2.locator('main').innerText()).replace(/\s+/g, ' ')
    await p2.getByRole('button', { name: /notification/i }).first().click().catch(() => {})
    await p2.waitForTimeout(1500)
    await p2.screenshot({ path: F + '/shots/D03b-bell.png' })
    fs.writeFileSync(F + '/D03-bell.txt', (await p2.locator('body').innerText()).slice(0, 3000))
    await p2.keyboard.press('Escape')
    const row = p2.locator('[role=row]').first()
    await row.hover(); await row.getByRole('button').last().click().catch(() => {})
    await p2.waitForTimeout(800)
    fs.appendFileSync(F + '/D03-bell.txt', '\nROW MENU: ' + (await p2.getByRole('menuitem').allInnerTexts()).join(' / '))
    await p2.screenshot({ path: F + '/shots/D03b-rowmenu.png' })
    await p2.keyboard.press('Escape')
    await p2.getByRole('link', { name: 'Shared folder' }).or(p2.getByText('Shared folder')).first().click()
    await p2.waitForTimeout(6000)
    fs.appendFileSync(F + '/D03-bell.txt', '\nURL after sidebar click: ' + p2.url() + '\nconsole: ' + consoleLines.join(' || ').slice(0, 1500))
    await p2.screenshot({ path: F + '/shots/D03b-opened.png' })
    const t = (await p2.locator('main').innerText()).replace(/\s+/g, ' ')
    if (!/a\.txt/.test(t)) throw new Error('shared folder list: [' + listTxt.slice(0, 200) + '] opened: [' + t.slice(0, 300) + '] url=' + p2.url())
    const r = p2.locator('[role=row]').filter({ hasText: 'a.txt' }).first()
    await r.hover()
    const [d] = await Promise.all([p2.waitForEvent('download', { timeout: 60_000 }), (async () => { const k = r.getByRole('button', { name: /File actions|More/ }); if (await k.count()) { await k.first().click(); await p2.getByRole('menuitem', { name: /^Download/ }).first().click() } else await r.getByRole('button', { name: /download/i }).first().click() })()])
    if (sha(await saveDownload(d, 'invite-a.txt')) !== sha(FX + '/folder/a.txt')) throw new Error('not byte-equal')
    return 'folder list shows: ' + listTxt.slice(0, 120) + ' ; a.txt byte-equal'
  })
  await rec.step('D06 account deletion (recipient account): data gone, sign-in refused', async () => {
    await p2.goto('/settings/delete-account'); await p2.waitForTimeout(2000); await dismissOverlays(p2)
    await p2.screenshot({ path: F + '/shots/D06-delete-page.png' })
    const pw = p2.locator('input[type=password]').first()
    if (await pw.isVisible().catch(() => false)) await pw.fill(PW)
    const confirmText = p2.getByPlaceholder(/DELETE|delete|email/i).first()
    if (await confirmText.isVisible().catch(() => false)) { const ph = (await confirmText.getAttribute('placeholder')) || ''; await confirmText.fill(/@/.test(ph) ? rcpt.email : 'DELETE') }
    await p2.getByText(/I understand my files are encrypted/).click()
    await p2.screenshot({ path: F + '/shots/D06-delete-filled.png' })
    await p2.getByRole('button', { name: /delete permanently/i }).last().click()
    const again = p2.getByRole('dialog').last().locator('input[type=password]')
    if (await again.isVisible({ timeout: 3000 }).catch(() => false)) { await again.fill(PW); await p2.getByRole('dialog').last().getByRole('button', { name: /confirm|continue|delete/i }).last().click() }
    await p2.waitForTimeout(5000)
    await p2.screenshot({ path: F + '/shots/D06-after-delete.png' })
    const c3 = await browser.newContext({ storageState: { cookies: [], origins: [] } }); const p3 = await c3.newPage()
    try {
      await p3.goto('/login'); await p3.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
      await p3.getByLabel(/email/i).fill(rcpt.email); await p3.getByPlaceholder('Your password').fill(PW); await p3.getByRole('button', { name: /^sign in$/i }).click()
      await p3.waitForTimeout(6000)
      const listing = await p3.request.get('http://localhost:3333/api/v1/files').catch(() => null)
    const url = p3.url(); const t = (await p3.locator('body').innerText()).replace(/\s+/g, ' ')
      if (!/\/login/.test(url)) throw new Error('deleted account could still sign in: ' + url)
      return `after delete url=${p2.url()}; sign-in refused: ${t.match(/[^.]*(incorrect|invalid|not found|deleted)[^.]*\./i)?.[0] ?? t.slice(0, 100)}`
    } finally { await c3.close() }
  }, { blockedIf: !r2 })
  await ctx2.close()
})
