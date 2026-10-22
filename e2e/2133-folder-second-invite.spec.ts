import { test, expect, type Browser, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { signupAndUnlock } from './helpers/signup'

/**
 * Task 2133 [P1] — a second folder invite must not lock out the first member.
 *
 * Before the fix the share dialog generated a NEW random folder key for every
 * invite and re-wrapped every child file key under it; the server upserts
 * shared_folder_keys per (folder_id, file_id), so after "share F with B" the
 * rows held folderKey2 while A (approved earlier) held folderKey1: A's
 * shared-folder page listed "Encrypted file" and a download failed to decrypt.
 *
 * Flow (real API, real browser, three accounts): the owner uploads a folder
 * with one file, invites A (auto-claim + auto-approve), invites B, then A
 * AND B each open the folder, see the decrypted child name and download
 * byte-equal content.
 *
 * Run (isolated harness; E2E_API_BIN = a debug beebeeb-api built from server
 * origin/main ee7f3f56):
 *   E2E_API_BIN=<bin> E2E_API_PORT=38431 E2E_VITE_PORT=38432 \
 *   E2E_DB_NAME=beebeeb_web_e2e_2133 ./e2e/scripts/web-e2e.sh e2e/2133-folder-second-invite.spec.ts
 */

const PASSWORD = 'Folder-second-invite-horse-9'
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3003'}`
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'bb-2133-evidence')

async function freshContext(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
  const page = await ctx.newPage()
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  return { ctx, page }
}

async function dismissOverlays(page: Page) {
  for (const re of [/^Essential only$/, /^(Skip for now|Skip tour|Close)$/]) {
    const b = page.getByRole('button', { name: re }).first()
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) await b.click().catch(() => {})
  }
}

async function openRowMenu(page: Page, name: string) {
  const row = page.locator('[role=row]').filter({ hasText: name }).first()
  for (let i = 0; i < 4; i++) {
    try {
      await dismissOverlays(page)
      await row.hover({ timeout: 6_000 })
      await row.getByRole('button', { name: 'File actions' }).click({ timeout: 6_000 })
      return
    } catch (e) {
      if (i === 3) throw e
      await page.waitForTimeout(1_000)
    }
  }
}

async function inviteFromDialog(owner: Page, folderName: string, email: string) {
  await openRowMenu(owner, folderName)
  await owner.getByRole('menuitem', { name: /^Share/ }).first().click()
  const dlg = owner.getByRole('dialog', { name: /send securely/i })
  await dlg.getByRole('button', { name: 'Invite', exact: true }).click()
  await dlg.getByPlaceholder(/colleague@example.com/).fill(email)
  await dlg.getByRole('button', { name: /send invite/i }).click()
  await expect(owner.getByText(/Invite sent/i).first()).toBeVisible({ timeout: 30_000 })
  await owner.keyboard.press('Escape')
}

async function approvedInvite(page: Page) {
  let invite: { id: string; file_id: string; status: string; is_folder_share?: boolean } | undefined
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API}/api/v1/shares/invites/incoming`)
        if (!res.ok()) return `http ${res.status()}`
        const body = (await res.json()) as { invites: (typeof invite)[] }
        invite = body.invites.find((i) => i?.is_folder_share)
        return invite?.status ?? 'none'
      },
      { timeout: 30_000 },
    )
    .toBe('approved')
  return invite!
}

async function expectDecryptsAndDownloads(
  page: Page,
  invite: { id: string; file_id: string },
  childName: string,
  childContent: string,
  tmp: string,
  shot: string,
) {
  await page.goto(`/shared-folder/${invite.file_id}?invite=${invite.id}`)
  await dismissOverlays(page)
  const main = page.locator('main')
  await page.screenshot({ path: path.join(EVIDENCE, `${shot}.png`) })
  await expect(page.getByTestId('shared-folder-key-missing'), `${shot}: "This folder can't be opened" (folder key mismatch)`).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(main.getByText('Encrypted file'), `${shot}: child shown as "Encrypted file" (folder key mismatch)`).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(main.getByText(childName, { exact: true }), `${shot}: decrypted child name not shown`).toBeVisible({
    timeout: 30_000,
  })
  const row = main.locator('.group').filter({ hasText: childName }).first()
  await row.hover()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    row.getByRole('button').last().click(),
  ])
  const saved = path.join(tmp, `dl-${shot}-${childName}`)
  await download.saveAs(saved)
  expect(fs.readFileSync(saved, 'utf8'), `${shot}: downloaded bytes differ`).toBe(childContent)
  await page.screenshot({ path: path.join(EVIDENCE, `${shot}-ok.png`) })
}

test('a second folder invite keeps the first member able to decrypt (and the second too)', async ({ browser }) => {
  test.setTimeout(420_000)
  fs.mkdirSync(EVIDENCE, { recursive: true })

  const stamp = Date.now()
  const folderName = `inv2-folder-${stamp}`
  const childName = `inside-${stamp}.txt`
  const childContent = `2133 second invite :: ${stamp} :: ${crypto.randomUUID()}`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-folder-invite2-'))
  fs.mkdirSync(path.join(tmp, folderName))
  fs.writeFileSync(path.join(tmp, folderName, childName), childContent)

  const owner = await freshContext(browser)
  const a = await freshContext(browser)
  const b = await freshContext(browser)
  try {
    const userA = await signupAndUnlock(a.page, { password: PASSWORD })
    const userB = await signupAndUnlock(b.page, { password: PASSWORD })
    await signupAndUnlock(owner.page, { password: PASSWORD })
    await dismissOverlays(owner.page)

    await owner.page.locator('input[type=file][webkitdirectory]').first().setInputFiles(path.join(tmp, folderName))
    await expect(owner.page.locator('[role=row]').filter({ hasText: folderName }).first()).toBeVisible({
      timeout: 60_000,
    })

    await inviteFromDialog(owner.page, folderName, userA.email)
    const inviteA = await approvedInvite(a.page)
    await expectDecryptsAndDownloads(a.page, inviteA, childName, childContent, tmp, 'A-before-B-invite')

    await inviteFromDialog(owner.page, folderName, userB.email)
    const inviteB = await approvedInvite(b.page)

    // The regression: A, approved BEFORE B was invited, must still decrypt.
    await expectDecryptsAndDownloads(a.page, inviteA, childName, childContent, tmp, 'A-after-B-invite')
    await expectDecryptsAndDownloads(b.page, inviteB, childName, childContent, tmp, 'B-after-B-invite')
  } finally {
    await owner.ctx.close()
    await a.ctx.close()
    await b.ctx.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
