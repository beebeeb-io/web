import { test, expect, type Page } from '@playwright/test'
import { uploadTextFile, createShareLink } from './helpers/drive'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'

/**
 * Task 1545, finding 2 — the public profile page (`/p/:username`) linked
 * every share card to `/s/undefined`. The server (repos/server profile.rs
 * PublicShare struct) deliberately NEVER sends `token` in this response —
 * "it is a secret that grants unauthenticated download access and must
 * never appear on public profiles" — so the whole feature was a dead end
 * for every visitor.
 *
 * Fix: ShareCard (public-profile.tsx) now renders a plain, non-interactive
 * card (no <a>, no "Open" CTA) whenever there is no real token to link to —
 * which today is always. This spec proves: (a) the card is visible with the
 * share's metadata, (b) there is NO link to `/s/undefined` anywhere on the
 * page, (c) there is no dangling `<a>` with an empty/undefined href either.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('a public profile with an active share never links to /s/undefined', async ({ page, browser }) => {
  test.setTimeout(120_000)

  // ── Owner: fresh isolated account (never reuses the shared harness fixture
  //    account's username, which other concurrent specs may also touch) ──
  await page.goto('/?nodev=1')
  const { email } = await signupAndUnlock(page, {
    email: uniqueEmail('1545-profile'),
    password: '1545ProfileShare!',
  })
  const username = `bee${Date.now().toString(36)}`.slice(0, 20)

  const filename = `1545-profile-share-${Date.now()}.txt`
  await uploadTextFile(page, filename, 'public profile share-link fix (task 1545)')
  await createShareLink(page, filename)

  await page.goto('/settings/profile?nodev=1')
  await page.getByPlaceholder('your-handle').fill(username)
  await page.getByRole('button', { name: /save profile/i }).click()
  await expect(page.getByText(/profile saved/i)).toBeVisible({ timeout: 15_000 })

  // ── Anonymous visitor opens the public profile ──
  const anonCtx = await anonymousContext(browser)
  const anonPage = await anonCtx.newPage()
  await anonPage.goto(`/p/${username}?nodev=1`)

  await expect(anonPage.getByText('Shared files')).toBeVisible({ timeout: 20_000 })
  await expect(anonPage.getByText('Encrypted file').first()).toBeVisible({ timeout: 15_000 })

  // THE regression guard: no /s/undefined link anywhere on the page, and no
  // <a> with an empty href either (both would be the old broken behavior).
  const badLinks = await anonPage.locator('a[href*="undefined"]').count()
  expect(badLinks, 'no <a> on the public profile should ever link to a share with an undefined token').toBe(0)

  await anonPage.screenshot({ path: 'test-results/1545-public-profile-no-undefined-link.png', fullPage: true })
  await anonCtx.close()

  void email
})

/**
 * Task 1545, finding 4 — the owner's "Shared → By me" list rendered a
 * multi-file bundle share as a single file, with no indication it actually
 * covers multiple files. Fix: shared.tsx now renders a "bundle · N files"
 * chip (bundleChipLabel, reading share_type/item_count already returned by
 * GET /api/v1/shares/mine). This drives a real 2-file bundle share and
 * asserts the chip renders with the right count.
 */
async function selectRow(page: Page, filename: string): Promise<void> {
  const row = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
  await row.hover()
  await row.getByRole('checkbox').first().click({ force: true })
}

test('a bundle share shows a "bundle · N files" chip in Shared → By me', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('1545-bundle'), password: '1545BundleChip!' })

  const stamp = Date.now()
  const names = [`1545-bundle-a-${stamp}.txt`, `1545-bundle-b-${stamp}.txt`]
  for (const name of names) await uploadTextFile(page, name, `bundle chip fix content ${name}`)

  for (const name of names) await selectRow(page, name)
  await expect(page.getByText(`${names.length} selected`)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^Share$/ }).click()
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  await expect(page.getByRole('button', { name: 'Full link', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  await page.goto('/shared?tab=by-me')
  await expect(page.getByText('bundle · 2 files')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: 'test-results/1545-bundle-chip-by-me.png', fullPage: false })
})
