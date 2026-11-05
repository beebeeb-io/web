// LD-0071 (P0): the three web writes that go through the server's
// `validate_name_encrypted_format` (server `routes/files/names.rs:76`): New
// folder and folder import (`POST /api/v1/files/folder`, `create.rs:36`) and a
// file-request guest upload (`POST /api/v1/r/:token/upload`,
// `file_requests.rs:757`). Since web #218 all three answered 400 "name_encrypted
// must include cipher_suite field". Each flow runs through the real UI against
// a LOCAL API and asserts every validated request answered 2xx, with a
// screenshot per action.
import { expect, test, type Page, type Response } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { anonymousContext } from './helpers/auth'

test.use({ storageState: { cookies: [], origins: [] } })

const SHOTS = process.env.LD0071_SHOTS_DIR

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}

async function dismissIfShown(page: Page, name: RegExp | string): Promise<void> {
  const button = page.getByRole('button', { name })
  try {
    await button.first().waitFor({ state: 'visible', timeout: 4_000 })
    await button.first().click()
  } catch {
    // not shown on this run
  }
}

/** Every response to a POST whose path matches `re`, as "<status> <path>". */
function record(page: Page, re: RegExp): string[] {
  const seen: string[] = []
  page.on('response', (r: Response) => {
    const url = new URL(r.url())
    if (r.request().method() === 'POST' && re.test(url.pathname)) seen.push(`${r.status()} POST ${url.pathname}`)
  })
  return seen
}

const is2xx = (line: string) => /^2\d\d /.test(line)

test('LD-0071: New folder, folder import and a file-request guest upload all answer 2xx', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const folderCreates = record(page, /^\/api\/v1\/files\/folder$/)

  // The debug build's dev auto-login account (vault unlocked). Not a fresh
  // signup: `helpers/mail-sink.ts` no longer matches the signup email text of
  // server b5ead069 (the code moved to its own line). The name validator runs
  // per request, whatever the account's role.
  await page.goto('/')
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 30_000 })
  await dismissIfShown(page, 'Essential only')
  await dismissIfShown(page, /^Skip for now$/)
  await dismissIfShown(page, /Skip tour/i)

  // 1. New folder.
  await page.getByTestId('new-menu-trigger').click()
  await page.getByTestId('new-menu-folder').click()
  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.getByPlaceholder('e.g. Contracts').fill('LD0071 new folder')
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/files/folder'))
  await dialog.getByRole('button', { name: 'Create' }).click()
  expect((await created).status(), 'New folder').toBeLessThan(300)
  await page.getByRole('row', { name: /LD0071 new folder, folder/ }).first().waitFor({ timeout: 15_000 })
  await shot(page, '1-new-folder')
  expect(folderCreates).toHaveLength(1)

  // 2. Folder import: LD0071-import/{a.txt, sub/b.txt} creates two folders.
  const tree = path.join(testInfo.outputPath('fixture'), 'LD0071-import')
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(tree, 'a.txt'), 'alpha\n')
  fs.writeFileSync(path.join(tree, 'sub', 'b.txt'), 'bravo\n')
  await page.locator('input[type=file][webkitdirectory]').first().setInputFiles(tree)
  await page.getByRole('row', { name: /LD0071-import, folder/ }).first().waitFor({ timeout: 30_000 })
  await expect.poll(() => folderCreates.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3)
  await shot(page, '2-folder-import')

  // 3. File request: the owner creates one, an anonymous guest uploads to it.
  const requestCreates = record(page, /^\/api\/v1\/file-requests$/)
  await page.goto('/file-requests')
  await page.getByRole('button', { name: 'New request' }).first().click()
  await page.getByPlaceholder('e.g. Send me your signed contract').fill('LD0071 request')
  await page.getByRole('button', { name: 'Create & copy link' }).click()
  const link = (await page.locator('code', { hasText: '/r/' }).first().textContent({ timeout: 15_000 }))!.trim()
  expect(link).toContain('/r/')
  expect(requestCreates.every(is2xx)).toBe(true)

  const guestCtx = await anonymousContext(browser)
  const guest = await guestCtx.newPage()
  const guestUploads = record(guest, /^\/api\/v1\/r\/[^/]+\/upload$/)
  await guest.goto(link)
  await guest.locator('input[type="file"]').first().setInputFiles({
    name: 'ld0071-guest.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('guest upload for LD-0071\n'),
  })
  const uploaded = guest.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/r\/[^/]+\/upload$/.test(r.url()))
  await guest.getByRole('button', { name: /Send file securely/ }).click()
  expect((await uploaded).status(), 'file-request guest upload').toBeLessThan(300)
  await shot(guest, '3-file-request-guest-upload')
  await guestCtx.close()

  // The record per action, for the PR body.
  console.log(['[LD-0071] folder creates:', ...folderCreates, '[LD-0071] file-request creates:', ...requestCreates, '[LD-0071] guest uploads:', ...guestUploads].join('\n'))
  expect(folderCreates.length).toBeGreaterThanOrEqual(3)
  expect(folderCreates.every(is2xx), folderCreates.join(', ')).toBe(true)
  expect(guestUploads).toHaveLength(1)
  expect(guestUploads.every(is2xx), guestUploads.join(', ')).toBe(true)
})
