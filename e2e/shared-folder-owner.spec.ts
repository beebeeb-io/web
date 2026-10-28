// e2e-flags: shared_folders_v1
import { test, expect } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'
import {
  API_URL,
  closeSharePanel,
  createFolderLinkViaUi,
  dismissFirstRunOverlays,
  escapeRe,
  ownerFolderWithContent,
} from './fixtures/folder-link'

/**
 * Task 2237b — the owner side of a shared folder link.
 *
 * The panel is the only place a link can be minted, so every assertion here
 * goes through the real UI: the row that appears, the URL the Copy button
 * puts on the clipboard, and what the guest page does after the owner pauses
 * or revokes it. The link key lives ONLY in the `#key=` fragment — for a
 * passphrase link too (lead review on the p1b plan) — so a link that loses it
 * would strand every guest.
 */
test.describe('2237b — owner creates, pauses and revokes folder links', () => {
  test.describe.configure({ retries: 0 })

  test('the panel mints a /f link with #key=, and the guest page lists the folder', async ({ page, browser }) => {
    test.setTimeout(240_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-owner-link'),
      password: '2237bOwnerLink-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Shared folder')

    // Record the create calls so the link is proven to be a FOLDER link, not a
    // snapshot bundle (the pre-2237b shape).
    const posts: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/v1/shares')) {
        posts.push(request.url())
      }
    })

    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'add', label: 'Owner link' })
    expect(link.url, 'every folder link keeps #key=').toMatch(/\/f\/[^#]+#key=/)

    await expect
      .poll(() => posts.some((url) => url.includes('/api/v1/shares/folder-links')), {
        timeout: 10_000,
        message: 'the panel must mint the link through POST /api/v1/shares/folder-links',
      })
      .toBe(true)
    expect(
      posts.some((url) => /\/api\/v1\/shares(\?|$)/.test(url)),
      'a shared folder link must not also mint a bundle share',
    ).toBe(false)

    await closeSharePanel(page)

    // ── Guest: the real public page, no account ─────────────────────────────
    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)

    await expect(guest.getByText(folder.rootFile, { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(guest.getByText(folder.nestedFolder, { exact: true })).toBeVisible({ timeout: 20_000 })
    // The root crumb is the folder's decrypted name, not the placeholder.
    await expect(guest.getByText(folder.folderName, { exact: true }).first()).toBeVisible({ timeout: 20_000 })

    await guest.screenshot({ path: 'test-results/2237b-owner-guest-listing.png', fullPage: true })
    await guestCtx.close()
  })

  test('pause and revoke both dead-end the guest at the same message', async ({ page, browser }) => {
    test.setTimeout(240_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-owner-pause'),
      password: '2237bOwnerPause-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Paused folder')
    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'view' })

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()

    // The link works before the owner touches it.
    await guest.goto(link.url)
    await expect(guest.getByText(folder.rootFile, { exact: true })).toBeVisible({ timeout: 60_000 })

    // ── Pause ────────────────────────────────────────────────────────────────
    const row = page.getByTestId('folder-link-row').first()
    await row.getByRole('button', { name: 'Pause' }).click()
    await expect(row.getByText('Paused')).toBeVisible({ timeout: 20_000 })

    await guest.reload()
    await expect(guest.getByRole('heading', { name: "This link isn't available." }).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(guest.getByText(/It may have been turned off, expired/)).toBeVisible()

    // ── Revoke (two-step) ────────────────────────────────────────────────────
    await row.getByRole('button', { name: 'Resume' }).click()
    await row.getByRole('button', { name: 'Revoke' }).click()
    await row.getByRole('button', { name: 'Revoke link?' }).click()
    await expect(page.getByTestId('folder-link-row')).toHaveCount(0, { timeout: 20_000 })

    await guest.reload()
    await expect(guest.getByRole('heading', { name: "This link isn't available." }).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(guest.getByText(folder.rootFile, { exact: true })).toHaveCount(0)

    await guestCtx.close()
  })

  test('a passphrase link keeps #key= and the guest must get the passphrase right', async ({ page, browser }) => {
    test.setTimeout(240_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-owner-pass'),
      password: '2237bOwnerPass-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Protected folder')
    const passphrase = 'correct horse battery 2237b'
    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'view', passphrase })

    expect(link.url, 'a passphrase link still carries the link key in the fragment').toMatch(/\/f\/[^#]+#key=/)
    expect(link.fragmentKey.length, 'the fragment holds a base64url link key').toBeGreaterThan(20)

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)

    await expect(guest.getByText('This folder is protected', { exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await guest.getByLabel('Passphrase').fill('wrong passphrase')
    await guest.getByRole('button', { name: 'Open folder' }).click()
    await expect(guest.getByText("That passphrase isn't right.", { exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await guest.getByLabel('Passphrase').fill(passphrase)
    await guest.getByRole('button', { name: 'Open folder' }).click()
    await expect(guest.getByText(folder.rootFile, { exact: true })).toBeVisible({ timeout: 60_000 })

    await guest.screenshot({ path: 'test-results/2237b-owner-passphrase-unlocked.png', fullPage: true })
    await guestCtx.close()
  })
})
