import { test, expect, type Browser, type Page } from '@playwright/test'
import { uniqueEmail, signupAndUnlock } from './helpers/signup'
import {
  API_URL,
  dismissFirstRunOverlays,
  enterFolder,
  escapeRe,
  ownerFolderWithContent,
} from './fixtures/folder-link'

/**
 * Task 17 (2237b) — a member invited to a shared folder can add files, and the
 * owner sees both the file and the activity row the share produced.
 *
 * The invite is placed through the folder's bundle share dialog (the only
 * invite UI that exists today: the shared-folder panel deliberately shows
 * itself for a folder of at most one file, so a folder with two files keeps
 * the legacy dialog that carries "Invite"). The owner side of the activity
 * check therefore reads the folder's activity endpoint rather than the panel's
 * Activity tab, which is unreachable while the bundle dialog is in charge —
 * recorded as a deviation in the Task 17 commit.
 */

const PASSWORD = 'Shared-folder-member-horse-9'

async function freshContext(browser: Browser) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  return { ctx, page }
}

async function openRowMenu(page: Page, name: string) {
  const row = page.getByRole('row', { name: new RegExp(escapeRe(name)) }).first()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await dismissFirstRunOverlays(page)
      await row.hover({ timeout: 6_000 })
      await row.getByRole('button', { name: 'File actions' }).click({ timeout: 6_000 })
      return
    } catch (error) {
      if (attempt === 3) throw error
      await page.waitForTimeout(1_000)
    }
  }
}

async function inviteFromDialog(owner: Page, folderName: string, email: string) {
  await openRowMenu(owner, folderName)
  await owner.getByRole('menuitem', { name: /^Share/ }).first().click()
  const dialog = owner.getByRole('dialog', { name: /send securely/i })
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click()
  await dialog.getByPlaceholder(/colleague@example.com/).fill(email)
  await dialog.getByRole('button', { name: /send invite/i }).click()
  await expect(owner.getByText(/Invite sent/i).first()).toBeVisible({ timeout: 30_000 })
  await owner.keyboard.press('Escape')
}

async function approvedInvite(page: Page) {
  let invite: { id: string; file_id: string; status: string; is_folder_share?: boolean } | undefined
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${API_URL}/api/v1/shares/invites/incoming`)
        if (!response.ok()) return `http ${response.status()}`
        const body = (await response.json()) as { invites: (typeof invite)[] }
        invite = body.invites.find((row) => row?.is_folder_share)
        return invite?.status ?? 'none'
      },
      { timeout: 30_000 },
    )
    .toBe('approved')
  return invite!
}

test.describe.configure({ retries: 0 })

test('a member can add a file and the owner sees it with an activity row', async ({ browser }) => {
  test.setTimeout(300_000)

  const owner = await freshContext(browser)
  const member = await freshContext(browser)
  // The shared-folder panel replaces the folder share dialog on the drive, and
  // that panel has no invite form yet, so the owner places the invitation
  // through the dialog the flag-off path still renders. The member page is the
  // part under test and is not flag-gated.
  await owner.page.route('**/api/v1/feature-flags/evaluate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: { shared_folders_v1: false } }),
    }),
  )
  try {
    const memberEmail = uniqueEmail('member')
    await signupAndUnlock(member.page, { email: memberEmail, password: PASSWORD })
    await signupAndUnlock(owner.page, { password: PASSWORD })
    await dismissFirstRunOverlays(owner.page)

    const folder = await ownerFolderWithContent(owner.page, 'member-folder')
    console.log('checkpoint: folder ready', folder.folderName)

    await inviteFromDialog(owner.page, folder.folderName, memberEmail)
    console.log('checkpoint: invite sent')
    const invite = await approvedInvite(member.page)
    console.log('checkpoint: invite approved', invite.id)

    // The invite dialog has no permission picker and the server defaults an
    // invite to "read" (= view), so the add-level grant this task is about is
    // applied through the documented invite PATCH. Recorded as a deviation.
    const sent = await owner.page.request.get(`${API_URL}/api/v1/shares/invites/sent`)
    expect(sent.ok()).toBeTruthy()
    const sentBody = (await sent.json()) as { invites: { id: string; file_id: string; recipient_email: string }[] }
    const sentInvite = sentBody.invites.find((row) => row.file_id === invite.file_id)
    expect(sentInvite, 'the sent invite is not listed for the owner').toBeTruthy()
    const patched = await owner.page.request.patch(
      `${API_URL}/api/v1/shares/invites/${sentInvite!.id}`,
      { data: { permission: 'add' } },
    )
    expect(patched.ok(), `invite PATCH failed: ${patched.status()}`).toBeTruthy()
    console.log('checkpoint: invite raised to add')

    await member.page.goto(`/shared-folder/${invite.file_id}?invite=${invite.id}`)
    await dismissFirstRunOverlays(member.page)
    const memberMain = member.page.locator('main')
    await expect(memberMain.getByText(folder.rootFile, { exact: true })).toBeVisible({ timeout: 60_000 })
    console.log('checkpoint: member page lists the folder')
    await expect(member.page.getByTestId('shared-folder-key-missing')).toHaveCount(0)
    await expect(memberMain.getByText('Encrypted file')).toHaveCount(0)

    await expect(member.page.getByTestId('member-actions'), 'no member toolbar for an add-level member').toHaveCount(1, {
      timeout: 20_000,
    })
    console.log('checkpoint: member toolbar present')

    const addedName = `from-member-${Date.now()}.txt`
    const addedBody = `member payload ${addedName}`
    await member.page.getByTestId('member-upload-input').setInputFiles({
      name: addedName,
      mimeType: 'text/plain',
      buffer: Buffer.from(addedBody, 'utf8'),
    })
    await expect(memberMain.getByText(addedName, { exact: true })).toBeVisible({ timeout: 120_000 })
    console.log('checkpoint: member upload landed')

    // The owner's own view refreshes to show the member's upload.
    await owner.page.reload()
    await dismissFirstRunOverlays(owner.page)
    await enterFolder(owner.page, folder.folderName)
    await expect(owner.page.locator('main').getByText(addedName, { exact: true })).toBeVisible({
      timeout: 60_000,
    })
    console.log('checkpoint: owner sees the member upload')

    // Activity: the folder's own record says one file arrived through a share.
    console.log('checkpoint: reading activity')
    const activity = await owner.page.request.get(
      `${API_URL}/api/v1/shared-folders/${folder.folderId}/activity?limit=50`,
    )
    expect(activity.ok()).toBeTruthy()
    const body = (await activity.json()) as {
      activity: { kind: string; item_count?: number; actor_name_encrypted?: string | null }[]
    }
    const added = body.activity.filter((row) => row.kind === 'files_added')
    expect(added.length, 'no files_added activity row for the member upload').toBeGreaterThan(0)
    expect(added.reduce((sum, row) => sum + (row.item_count ?? 0), 0)).toBeGreaterThan(0)
  } finally {
    await owner.ctx.close()
    await member.ctx.close()
  }
})
