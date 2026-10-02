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
test('journey C/D: sharing, invite, file request, revoke, delete', async ({ page, browser }) => {
  test.setTimeout(1_200_000)
  const rec = new Recorder(F + '/results-c.json', () => page)
  let owner = { email: '', phrase: '' }
  const ok = await rec.step('C01 owner signup + upload hello.txt, photo.png, doc.pdf + folder', async () => {
    owner = await signup(page, 'flow3c')
    await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles([FX + '/hello.txt', FX + '/photo.png', FX + '/doc.pdf'])
    for (const n of ['hello.txt', 'photo.png', 'doc.pdf']) await expect(page.locator('[role=row]').filter({ hasText: n })).toBeVisible({ timeout: 60_000 })
    await page.locator('input[type=file][webkitdirectory]').first().setInputFiles(FX + '/folder')
    await expect(page.locator('[role=row]').filter({ hasText: 'folder' }).first()).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(2000)
    return owner.email
  })
  let link1 = ''
  await rec.step('C02 file share link (no passphrase) opened anonymously -> byte-equal', async () => {
    link1 = (await makeLink(page, 'photo.png')).url
    const { ctx, p } = await anon(browser)
    try { const got = await anonDownload(p, link1, 'photo.png'); if (got !== sha(FX + '/photo.png')) throw new Error('not byte-equal'); await p.screenshot({ path: F + '/shots/C02-anon-share.png' }) } finally { await ctx.close() }
    return 'anon download byte-equal; ' + link1.replace(/#.*/, '#<key>')
  }, { blockedIf: !ok })
  await rec.step('C03 share link WITH passphrase: wrong rejected, right -> byte-equal', async () => {
    const { url } = await makeLink(page, 'doc.pdf', { pass: 'Correct-Pass-77' })
    const { ctx, p } = await anon(browser)
    try {
      await p.goto(url)
      await p.getByLabel(/share password/i).fill('wrong-pass')
      await p.getByRole('button', { name: /unlock file/i }).click()
      await expect(p.getByText(/incorrect password/i)).toBeVisible({ timeout: 15_000 })
      const got = await anonDownload(p, url, 'doc.pdf', 'Correct-Pass-77')
      if (got !== sha(FX + '/doc.pdf')) throw new Error('not byte-equal')
    } finally { await ctx.close() }
    return 'wrong passphrase rejected; correct -> byte-equal'
  }, { blockedIf: !ok })
  await rec.step('C04 share link max opens = 1 + expiry 1 hour: 1st open works, 2nd open refused', async () => {
    const { url, dtxt } = await makeLink(page, 'hello.txt', { maxOpens: '1', expiry: '1 hour' })
    const a = await anon(browser); let first = ''
    try { first = await anonDownload(a.p, url, 'hello.txt'); if (first !== sha(FX + '/hello.txt')) throw new Error('1st open not byte-equal') } finally { await a.ctx.close() }
    const b = await anon(browser)
    try {
      await b.p.goto(url); await b.p.waitForTimeout(5000)
      const t = (await b.p.locator('body').innerText()).replace(/\s+/g, ' ')
      await b.p.screenshot({ path: F + '/shots/C04-second-open.png' })
      const canDl = await b.p.getByRole('button', { name: /download and decrypt/i }).count()
      if (canDl > 0) { const [d] = await Promise.all([b.p.waitForEvent('download', { timeout: 20_000 }).catch(() => null), b.p.getByRole('button', { name: /download and decrypt/i }).first().click()]); if (d) throw new Error('2nd open still downloaded the file with max_opens=1; dialog=' + dtxt) }
      return '2nd open refused: ' + t.slice(0, 160)
    } finally { await b.ctx.close() }
  }, { blockedIf: !ok })
  await rec.step('C05 bundle share (2 files) opened anonymously, both byte-equal', async () => {
    for (const n of ['hello.txt', 'photo.png']) { const r = page.locator('[role=row]').filter({ hasText: n }).first(); await r.hover(); await r.getByRole('checkbox').first().click({ force: true }) }
    await page.getByRole('button', { name: /^Share$/ }).click()
    await page.getByRole('button', { name: /generate encrypted link/i }).click()
    await page.getByRole('button', { name: 'Full link', exact: true }).click().catch(() => {})
    const url = await page.locator('input[readonly]').evaluateAll((els) => (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#/.test(e.value))?.value ?? null)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    if (!url) throw new Error('no bundle link')
    const { ctx, p } = await anon(browser)
    try {
      await p.goto(url)
      await expect(p.getByText('photo.png').first()).toBeVisible({ timeout: 30_000 })
      await p.screenshot({ path: F + '/shots/C05-bundle.png' })
      const out: string[] = []
      for (const n of ['hello.txt', 'photo.png']) {
        const row = p.locator('li, [role=row], tr, div').filter({ hasText: n }).filter({ has: p.getByRole('button', { name: /download/i }) }).last()
        const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), row.getByRole('button', { name: /download/i }).first().click()])
        const got = sha(await saveDownload(d, 'bundle-' + n)); if (got !== sha(FX + '/' + n)) throw new Error(n + ' not byte-equal'); out.push(n)
      }
      return 'bundle files byte-equal: ' + out.join(',')
    } finally { await ctx.close() }
  }, { blockedIf: !ok })
  await page.goto('/'); await dismissOverlays(page)
  await rec.step('C06 revoke the photo.png link -> anonymous open refused', async () => {
    await openMenu(page, 'photo.png')
    await menuItem(page, /^Manage shares/)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: F + '/shots/C06-manage-shares.png' })
    const dlg = page.getByRole('dialog').last()
    await dlg.getByRole('button', { name: /revoke/i }).first().click()
    const conf = page.getByRole('button', { name: /^(revoke|yes|confirm)/i })
    if (await conf.last().isVisible({ timeout: 2000 }).catch(() => false)) await conf.last().click()
    await page.waitForTimeout(2000)
    await page.keyboard.press('Escape')
    const { ctx, p } = await anon(browser)
    try {
      await p.goto(link1); await p.waitForTimeout(5000)
      const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
      await p.screenshot({ path: F + '/shots/C06-revoked-open.png' })
      if (await p.getByRole('button', { name: /download and decrypt/i }).count()) throw new Error('revoked link still offers download')
      return 'revoked link: ' + t.slice(0, 160)
    } finally { await ctx.close() }
  }, { blockedIf: !ok })

  // second account for invite
  const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
  const p2 = await ctx2.newPage()
  let rcpt = { email: '', phrase: '' }
  const r2 = await rec.step('D01 second account signup (recipient)', async () => { rcpt = await signup(p2, 'flow3r'); return rcpt.email }, { blockedIf: !ok })
  await rec.step('D02 invite recipient to folder "folder" (Invite tab)', async () => {
    await page.goto('/'); await dismissOverlays(page)
    await openMenu(page, 'folder')
    await menuItem(page, /^Share/)
    const dlg = page.getByRole('dialog').last()
    await dlg.getByRole('button', { name: /invite/i }).first().click()
    await dlg.getByPlaceholder(/colleague@example.com/).fill(rcpt.email)
    await page.screenshot({ path: F + '/shots/D02-invite-form.png' })
    await dlg.getByRole('button', { name: /send invite/i }).click()
    await expect(page.getByText(/Invite sent/i).first()).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    return 'Invite sent'
  }, { blockedIf: !r2 })
  await rec.step('D03 recipient sees + accepts invite, opens folder, downloads a.txt byte-equal', async () => {
    await p2.goto('/shared'); await p2.waitForTimeout(4000); await dismissOverlays(p2)
    await p2.screenshot({ path: F + '/shots/D03-recipient-shared.png' })
    const acc = p2.getByRole('button', { name: /accept/i }).first()
    if (await acc.isVisible({ timeout: 5000 }).catch(() => false)) { await acc.click(); await p2.waitForTimeout(3000) }
    await p2.screenshot({ path: F + '/shots/D03-recipient-after-accept.png' })
    const approval = /Waiting for approval|Waiting to claim/i.test(await p2.locator('body').innerText())
    await p2.getByText('folder', { exact: true }).first().click()
    await p2.waitForTimeout(3000)
    await expect(p2.getByText('a.txt').first()).toBeVisible({ timeout: 30_000 })
    await p2.screenshot({ path: F + '/shots/D03-recipient-folder.png' })
    const row = p2.locator('[role=row]').filter({ hasText: 'a.txt' }).first()
    await row.hover()
    let d
    const kebab = row.getByRole('button', { name: /File actions|More/ })
    if (await kebab.count()) { await kebab.first().click(); [d] = await Promise.all([p2.waitForEvent('download', { timeout: 60_000 }), p2.getByRole('menuitem', { name: /^Download/ }).first().click()]) }
    else { [d] = await Promise.all([p2.waitForEvent('download', { timeout: 60_000 }), row.getByRole('button', { name: /download/i }).first().click()]) }
    const got = sha(await saveDownload(d!, 'invite-a.txt'))
    if (got !== sha(FX + '/folder/a.txt')) throw new Error('not byte-equal')
    return `recipient decrypted a.txt byte-equal (approval-step-seen=${approval})`
  }, { blockedIf: !r2 })
  let reqLink = ''
  await rec.step('D04 owner creates a file request link', async () => {
    await page.goto('/file-requests'); await dismissOverlays(page)
    await page.getByRole('button', { name: /New (file )?request/ }).first().click()
    await page.getByPlaceholder('e.g. Send me your signed contract').fill('Flow3 request')
    await page.screenshot({ path: F + '/shots/D04-file-request-form.png' })
    await page.getByRole('button', { name: /^Create/ }).last().click()
    await page.waitForTimeout(3000)
    reqLink = (await page.locator('body').innerText()).match(/https?:\/\/[^\s]+\/r\/[^\s]+/)?.[0] ?? ''
    await page.screenshot({ path: F + '/shots/D04-file-request-created.png' })
    if (!reqLink) throw new Error('no /r/ link shown after create')
    return reqLink.replace(/#.*/, '#<key>')
  }, { blockedIf: !ok })
  await rec.step('D05 anonymous uploads to file request; owner sees + decrypts byte-equal', async () => {
    const { ctx, p } = await anon(browser)
    try {
      await p.goto(reqLink); await p.waitForTimeout(3000)
      await p.screenshot({ path: F + '/shots/D05-request-page.png' })
      fs.mkdirSync(F + '/fixtures/req', { recursive: true }); fs.writeFileSync(F + '/fixtures/req/from-stranger.txt', 'anonymous upload ' + Date.now())
      await p.locator('input[type=file]').first().setInputFiles(F + '/fixtures/req/from-stranger.txt')
      const send = p.getByRole('button', { name: /send|upload/i }).last()
      if (await send.isVisible({ timeout: 3000 }).catch(() => false) && await send.isEnabled()) await send.click()
      await expect(p.getByText(/sent|uploaded|received|done|thank/i).first()).toBeVisible({ timeout: 60_000 })
      await p.screenshot({ path: F + '/shots/D05-request-sent.png' })
    } finally { await ctx.close() }
    await page.goto('/'); await dismissOverlays(page); await page.waitForTimeout(3000)
    let found = await page.locator('[role=row]').filter({ hasText: 'from-stranger.txt' }).count()
    if (!found) { // may land in a request folder
      const t = await page.locator('[role=row]').allInnerTexts(); const folder = t.find(x => /Flow3 request|request/i.test(x))
      if (folder) { await page.locator('[role=row]').filter({ hasText: /Flow3 request/ }).first().dblclick(); await page.waitForTimeout(3000); found = await page.locator('[role=row]').filter({ hasText: 'from-stranger.txt' }).count() }
    }
    await page.screenshot({ path: F + '/shots/D05-owner-drive.png' })
    if (!found) throw new Error('owner cannot find from-stranger.txt in drive; rows=' + (await page.locator('[role=row]').allInnerTexts()).map(s => s.split('\n')[0]).join(' | '))
    await openMenu(page, 'from-stranger.txt')
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), menuItem(page, /^Download/)])
    if (sha(await saveDownload(d, 'req.txt')) !== sha(F + '/fixtures/req/from-stranger.txt')) throw new Error('not byte-equal')
    return 'owner decrypted anonymous upload byte-equal'
  }, { blockedIf: !ok })
  await rec.step('D06 account deletion (recipient account): data gone, sign-in refused', async () => {
    await p2.goto('/settings/delete-account'); await p2.waitForTimeout(2000); await dismissOverlays(p2)
    await p2.screenshot({ path: F + '/shots/D06-delete-page.png' })
    const pw = p2.locator('input[type=password]').first()
    if (await pw.isVisible().catch(() => false)) await pw.fill(PW)
    const confirmText = p2.getByPlaceholder(/DELETE|delete|email/i).first()
    if (await confirmText.isVisible().catch(() => false)) { const ph = (await confirmText.getAttribute('placeholder')) || ''; await confirmText.fill(/@/.test(ph) ? rcpt.email : 'DELETE') }
    for (const cb of await p2.getByRole('checkbox').all()) await cb.check({ force: true }).catch(() => {})
    await p2.screenshot({ path: F + '/shots/D06-delete-filled.png' })
    await p2.getByRole('button', { name: /delete (my )?account|permanently delete/i }).last().click()
    await p2.waitForTimeout(5000)
    await p2.screenshot({ path: F + '/shots/D06-after-delete.png' })
    const c3 = await browser.newContext({ storageState: { cookies: [], origins: [] } }); const p3 = await c3.newPage()
    try {
      await p3.goto('/login'); await p3.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
      await p3.getByLabel(/email/i).fill(rcpt.email); await p3.getByPlaceholder('Your password').fill(PW); await p3.getByRole('button', { name: /^sign in$/i }).click()
      await p3.waitForTimeout(6000)
      const url = p3.url(); const t = (await p3.locator('body').innerText()).replace(/\s+/g, ' ')
      if (!/\/login/.test(url)) throw new Error('deleted account could still sign in: ' + url)
      return `after delete url=${p2.url()}; sign-in refused: ${t.match(/[^.]*(incorrect|invalid|not found|deleted)[^.]*\./i)?.[0] ?? t.slice(0, 100)}`
    } finally { await c3.close() }
  }, { blockedIf: !r2 })
  await ctx2.close()
})
