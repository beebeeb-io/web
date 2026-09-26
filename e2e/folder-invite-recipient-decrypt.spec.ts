import { test, expect, type Browser, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { signupAndUnlock } from './helpers/signup'

/**
 * P0 (flow web-core, 2026-09-25) — folder invite: the recipient could not
 * decrypt anything.
 *
 * The owner invites an EXISTING account to a folder. The server auto-claims,
 * the share dialog seals the random folder key for the recipient and calls
 * /approve. Before the fix the recipient's shared-folder page listed every
 * child as "Encrypted file": the server stored the sealed key in
 * `encrypted_file_key` while the recipient only read `encrypted_folder_key`
 * (left as an empty bytea by the invite creation). Server PR #100 routes new
 * approvals to the right column; the web client now also opens invites
 * approved before that fix (src/lib/recipient-folder-key.ts).
 *
 * This spec drives the real two-account flow in the browser and asserts the
 * recipient sees the decrypted child name and downloads byte-equal content.
 * It passes against either server version, which is the point: invites
 * already stored in production must open too.
 */

const PASSWORD = 'Folder-invite-correct-horse-9'
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3003'}`

async function freshContext(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
  const page = await ctx.newPage()
  // Keep the dev auto-login away from these accounts: each context must be
  // exactly the account it signed up as.
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

test('folder invite to an existing account: recipient decrypts names and downloads byte-equal', async ({ browser }) => {
  test.setTimeout(300_000)

  const stamp = Date.now()
  const folderName = `inv-folder-${stamp}`
  const childName = `inside-${stamp}.txt`
  const childContent = `folder invite P0 :: ${stamp} :: ${crypto.randomUUID()}`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-folder-invite-'))
  fs.mkdirSync(path.join(tmp, folderName))
  fs.writeFileSync(path.join(tmp, folderName, childName), childContent)

  const owner = await freshContext(browser)
  const rcpt = await freshContext(browser)
  try {
    // Recipient must exist first so the server auto-claims the invite.
    const recipient = await signupAndUnlock(rcpt.page, { password: PASSWORD })
    await signupAndUnlock(owner.page, { password: PASSWORD })
    await dismissOverlays(owner.page)

    await owner.page
      .locator('input[type=file][webkitdirectory]')
      .first()
      .setInputFiles(path.join(tmp, folderName))
    await expect(owner.page.locator('[role=row]').filter({ hasText: folderName }).first()).toBeVisible({
      timeout: 60_000,
    })

    await openRowMenu(owner.page, folderName)
    await owner.page.getByRole('menuitem', { name: /^Share/ }).first().click()
    const dlg = owner.page.getByRole('dialog', { name: /send securely/i })
    await dlg.getByRole('button', { name: 'Invite', exact: true }).click()
    await dlg.getByPlaceholder(/colleague@example.com/).fill(recipient.email)
    await dlg.getByRole('button', { name: /send invite/i }).click()
    await expect(owner.page.getByText(/Invite sent/i).first()).toBeVisible({ timeout: 30_000 })

    // The auto-approve path is the one under test: the invite must be approved
    // without any manual step by the owner.
    let invite: { id: string; file_id: string; status: string; is_folder_share?: boolean } | undefined
    await expect
      .poll(
        async () => {
          const res = await rcpt.page.request.get(`${API}/api/v1/shares/invites/incoming`)
          if (!res.ok()) return `http ${res.status()}`
          const body = (await res.json()) as { invites: (typeof invite)[] }
          invite = body.invites.find((i) => i?.is_folder_share)
          return invite?.status ?? 'none'
        },
        { timeout: 30_000 },
      )
      .toBe('approved')

    await rcpt.page.goto(`/shared-folder/${invite!.file_id}?invite=${invite!.id}`)
    await dismissOverlays(rcpt.page)
    const main = rcpt.page.locator('main')
    await expect(main.getByText(childName).first()).toBeVisible({ timeout: 30_000 })
    await expect(main.getByText('Encrypted file')).toHaveCount(0)
    await expect(rcpt.page.getByTestId('shared-folder-key-missing')).toHaveCount(0)

    // The row shows the plain name, not the raw JSON metadata envelope.
    await expect(main.getByText('{"name"')).toHaveCount(0)
    await expect(main.getByText(childName, { exact: true })).toBeVisible()

    // Sidebar entry (drive-layout) for the approved folder share is present.
    // Its label is the generic 'Shared folder': the recipient holds no key
    // for the ROOT folder's own name (folder_keys covers descendants only).
    await expect(
      rcpt.page.locator(`a[href="/shared-folder/${invite!.file_id}?invite=${invite!.id}"]`).first(),
    ).toBeVisible({ timeout: 30_000 })

    // Download the child and compare bytes.
    const row = main.locator('.group').filter({ hasText: childName }).first()
    await row.hover()
    const [download] = await Promise.all([
      rcpt.page.waitForEvent('download', { timeout: 60_000 }),
      row.getByRole('button').last().click(),
    ])
    const saved = path.join(tmp, `dl-${childName}`)
    await download.saveAs(saved)
    expect(fs.readFileSync(saved, 'utf8')).toBe(childContent)
  } finally {
    await owner.ctx.close()
    await rcpt.ctx.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
