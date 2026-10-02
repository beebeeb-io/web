import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { fillSignupForm, reachPasswordStep, createAccount, uniqueEmail } from '../e2e/helpers/signup'
import { F, FX, Recorder, dismissOverlays, saveDownload, openMenu, menuItem, sha, shaStream, lastEmailCode } from './lib'

const PW = 'Flow3-correct-horse-9'
test('journey A: new user files', async ({ page }) => {
  test.setTimeout(3_000_000)
  const rec = new Recorder(F + '/results-a.json', () => page)
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
    fs.writeFileSync(F + '/acct-a.json', JSON.stringify({ email, password: PW, phrase: phrase.join(' ') }))
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
  await rec.step('A04 upload small text file', async () => {
    await fileInput.setInputFiles(FX + '/hello.txt')
    await expect(page.locator('[role=row]').filter({ hasText: 'hello.txt' })).toBeVisible({ timeout: 60_000 })
    return 'hello.txt row visible'
  }, { blockedIf: !signedUp })
  await dismissOverlays(page)
  await rec.step('A05 upload image, pdf, video', async () => {
    await fileInput.setInputFiles([FX + '/photo.png', FX + '/doc.pdf', FX + '/clip.mp4'])
    for (const n of ['photo.png', 'doc.pdf', 'clip.mp4']) await expect(page.locator('[role=row]').filter({ hasText: n })).toBeVisible({ timeout: 90_000 })
    return 'photo.png, doc.pdf, clip.mp4 rows visible'
  }, { blockedIf: !signedUp })
  await rec.step('A06 upload 200 MB file (chunked)', async () => {
    const t0 = Date.now()
    await fileInput.setInputFiles(FX + '/big-200mb.bin')
    await expect(page.locator('[role=row]').filter({ hasText: 'big-200mb.bin' })).toBeVisible({ timeout: 900_000 })
    // wait for upload progress to settle
    await expect(page.getByText(/Uploading|Encrypting/i)).toHaveCount(0, { timeout: 900_000 }).catch(() => {})
    const row = await page.locator('[role=row]').filter({ hasText: 'big-200mb.bin' }).innerText()
    return `row visible after ${Date.now() - t0}ms: ${row.replace(/\s+/g, ' ')}`
  }, { blockedIf: !signedUp })
  const dirInput = page.locator('input[type=file][webkitdirectory]').first()
  await rec.step('A07 upload folder (Upload folder input; folder/ with sub/)', async () => {
    await dirInput.setInputFiles(FX + '/folder')
    await expect(page.locator('[role=row]').filter({ hasText: /^\s*folder/ }).first()).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(3000)
    await page.locator('[role=row]').filter({ hasText: 'folder' }).first().dblclick()
    for (const n of ['a.txt', 'b.bin', 'sub']) await expect(page.locator('[role=row]').filter({ hasText: n }).first()).toBeVisible({ timeout: 60_000 })
    await page.locator('[role=row]').filter({ hasText: 'sub' }).first().dblclick()
    await expect(page.locator('[role=row]').filter({ hasText: 'c.txt' }).first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'All files' }).click()
    await expect(page.locator('[role=row]').filter({ hasText: 'hello.txt' })).toBeVisible({ timeout: 20_000 })
    return 'folder/{a.txt,b.bin,sub/c.txt} tree present'
  }, { blockedIf: !signedUp })
  await page.screenshot({ path: F + '/shots/A07-drive-with-files.png' })

  // previews
  for (const [n, sel] of [['photo.png', 'img'], ['doc.pdf', 'canvas, iframe, embed, object, img'], ['clip.mp4', 'video'], ['hello.txt', 'pre, code, textarea, [data-preview-text]']] as const) {
    await rec.step(`A08 preview ${n}`, async () => {
      await page.keyboard.press('Escape')
      await openMenu(page, n)
      await menuItem(page, /^Preview/)
      await expect(page.getByText(/Decrypted locally/).first()).toBeVisible({ timeout: 20_000 })
      const dlg = page.locator('body')
      await page.waitForTimeout(4000)
      await page.screenshot({ path: `${F}/shots/A08-preview-${n}.png` })
      const txt = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 200)
      const count = await dlg.locator(sel).count()
      if (n === 'hello.txt' && !/hello flow3/.test(await dlg.innerText())) throw new Error('text content not rendered: ' + txt)
      if (n !== 'hello.txt' && count === 0) throw new Error(`no ${sel} element in preview; text=${txt}`)
      if (n === 'photo.png') { const w = await dlg.locator('img').first().evaluate((e: HTMLImageElement) => e.naturalWidth); if (!w) throw new Error('img naturalWidth=0') }
      if (n === 'clip.mp4') { await page.waitForTimeout(1500); const d = await dlg.locator('video').first().evaluate((e: HTMLVideoElement) => ({ d: e.duration, rs: e.readyState, err: e.error?.code ?? null })); if (!(d.d > 0)) throw new Error('video not loaded ' + JSON.stringify(d)); return `video duration=${d.d} readyState=${d.rs}` }
      return `${count}x ${sel} rendered; ${txt.slice(0, 100)}`
    }, { blockedIf: !signedUp })
    await page.keyboard.press('Escape')
    if (await page.getByText(/Decrypted locally/).first().isVisible().catch(() => false)) await page.getByRole('link', { name: 'All files' }).click().catch(() => {})
    await expect(page.locator('[role=row]').first()).toBeVisible({ timeout: 15_000 }).catch(() => {})
  }

  // downloads
  for (const [n, fx] of [['hello.txt', FX + '/hello.txt'], ['photo.png', FX + '/photo.png'], ['doc.pdf', FX + '/doc.pdf'], ['big-200mb.bin', FX + '/big-200mb.bin']] as const) {
    await rec.step(`A09 download ${n} byte-equal`, async () => {
      await page.keyboard.press('Escape')
      await openMenu(page, n)
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), menuItem(page, /^Download/)])
      const p = await saveDownload(d, n)
      const [a, b] = [await shaStream(p), await shaStream(fx)]
      if (a !== b) throw new Error(`sha mismatch ${a} != ${b} (size ${fs.statSync(p).size} vs ${fs.statSync(fx).size})`)
      return `suggested=${d.suggestedFilename()} sha256=${a.slice(0, 16)}… size=${fs.statSync(p).size}`
    }, { blockedIf: !signedUp })
  }

  await rec.step('A10 folder context-menu Download produces a file', async () => {
    await openMenu(page, 'folder')
    const items = await page.getByRole('menuitem').allInnerTexts()
    const hasDl = items.some(i => /Download/.test(i))
    if (!hasDl) return 'no Download item for folders (menu: ' + items.join('/') + ')'
    const dP = page.waitForEvent('download', { timeout: 30_000 }).then(d => d).catch(() => null)
    await menuItem(page, /^Download/)
    const d = await dP
    await page.screenshot({ path: F + '/shots/A10-folder-download.png' })
    if (!d) throw new Error('menu offers "Download" on a folder but clicking it produced no download and no feedback within 30s; menu=' + items.join('/'))
    return 'download ' + d.suggestedFilename()
  }, { blockedIf: !signedUp })
  await page.keyboard.press('Escape')

  await rec.step('A11 zip of folder via selection -> Download, contents byte-equal', async () => {
    const row = page.locator('[role=row]').filter({ hasText: 'folder' }).first()
    await row.hover()
    await row.getByRole('checkbox').first().check({ force: true })
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: /^Download/ }).last().click()])
    const p = await saveDownload(d, 'folder.zip')
    const out = F + '/downloads/unzipped-' + Date.now()
    execSync(`mkdir -p ${out} && cd ${out} && unzip -q ${p}`)
    const list = execSync(`cd ${out} && find . -type f | sort`).toString().trim().split('\n')
    const want = { 'a.txt': sha(FX + '/folder/a.txt'), 'b.bin': sha(FX + '/folder/b.bin'), 'c.txt': sha(FX + '/folder/sub/c.txt') }
    const got: Record<string, string> = {}
    for (const f of list) got[f.split('/').pop()!] = sha(out + '/' + f)
    for (const [k, v] of Object.entries(want)) if (got[k] !== v) throw new Error(`zip entry ${k} mismatch/missing; entries=${list.join(',')}`)
    await row.getByRole('checkbox').first().uncheck({ force: true }).catch(() => {})
    return `zip ${d.suggestedFilename()} entries=${list.join(',')} all byte-equal`
  }, { blockedIf: !signedUp })
  await page.keyboard.press('Escape')

  await rec.step('A12 rename hello.txt -> hello-renamed.txt', async () => {
    await openMenu(page, 'hello.txt')
    await menuItem(page, /^Rename/)
    const inp = page.getByLabel('New name')
    await inp.fill('hello-renamed.txt')
    await inp.press('Enter')
    await expect(page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' })).toBeVisible({ timeout: 15_000 })
    await page.reload(); await dismissOverlays(page)
    await expect(page.locator('[role=row]').filter({ hasText: 'hello-renamed.txt' })).toBeVisible({ timeout: 30_000 })
    return 'renamed and persists after reload'
  }, { blockedIf: !signedUp })
  await rec.step('A13 move doc.pdf into folder', async () => {
    await openMenu(page, 'doc.pdf')
    await menuItem(page, /^Move to/)
    const dlg = page.getByRole('dialog').last()
    await dlg.getByText('folder', { exact: true }).first().click()
    await dlg.getByRole('button', { name: /^Move/ }).last().click()
    await expect(page.locator('[role=row]').filter({ hasText: 'doc.pdf' })).toHaveCount(0, { timeout: 15_000 })
    await page.locator('[role=row]').filter({ hasText: 'folder' }).first().dblclick()
    await expect(page.locator('[role=row]').filter({ hasText: 'doc.pdf' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: 'All files' }).click()
    return 'doc.pdf now inside folder/'
  }, { blockedIf: !signedUp })
  await rec.step('A14 copy a file (Make a copy / Copy to)', async () => {
    await openMenu(page, 'photo.png')
    const items = await page.getByRole('menuitem').allInnerTexts()
    await page.keyboard.press('Escape')
    if (!items.some(i => /copy/i.test(i) && !/link/i.test(i))) throw new Error('no copy action in the file menu: ' + items.map(s => s.trim()).join(' / '))
    return 'copy present'
  }, { blockedIf: !signedUp })

  await rec.step('A15 versions: re-upload same name -> Replace -> 2 versions, v1 + v2 downloadable byte-equal', async () => {
    fs.writeFileSync(F + '/fixtures/notes.txt', 'version one\n')
    const v1 = sha(F + '/fixtures/notes.txt')
    await fileInput.setInputFiles(F + '/fixtures/notes.txt')
    await expect(page.locator('[role=row]').filter({ hasText: 'notes.txt' })).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(2000)
    const tmp2 = F + '/fixtures/v2'; fs.mkdirSync(tmp2, { recursive: true }); fs.writeFileSync(tmp2 + '/notes.txt', 'version TWO is longer\n')
    const v2 = sha(tmp2 + '/notes.txt')
    await fileInput.setInputFiles(tmp2 + '/notes.txt')
    await page.waitForTimeout(8000)
    const rows = await page.locator('[role=row]').filter({ hasText: 'notes' }).count()
    if (rows !== 1) throw new Error(`expected 1 notes row after Replace, got ${rows}`)
    await openMenu(page, 'notes.txt')
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), menuItem(page, /^Download/)])
    const cur = sha(await saveDownload(d, 'notes-current.txt'))
    if (cur !== v2) throw new Error('current download is not v2 content')
    await page.keyboard.press('Escape')
    await openMenu(page, 'notes.txt')
    await menuItem(page, /^See versions/)
    const panel = page.getByRole('dialog').last()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: F + '/shots/A15-versions.png' })
    const ptxt = (await panel.innerText()).replace(/\s+/g, ' ')
    const dls = panel.getByRole('button', { name: /^Download$/ })
    const n = await dls.count()
    if (n < 1) throw new Error('no per-version Download buttons; panel=' + ptxt.slice(0, 300))
    const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), dls.last().click()])
    const old = sha(await saveDownload(d1, 'notes-v1.txt'))
    if (old !== v1) throw new Error(`older version download != v1 content (buttons=${n}) panel=${ptxt.slice(0, 200)}`)
    await page.keyboard.press('Escape')
    return `current=v2 byte-equal; version panel buttons=${n}; oldest download byte-equal v1`
  }, { blockedIf: !signedUp })
  await page.keyboard.press('Escape')

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
  fs.writeFileSync(F + '/console-errors-a.txt', consoleErrs.join('\n'))
})
