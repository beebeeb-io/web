import { test, expect } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'
import {
  closeSharePanel,
  createFolder,
  createFolderLinkViaUi,
  dismissFirstRunOverlays,
  escapeRe,
  ownerFolderWithContent,
  uniqueName,
} from './fixtures/folder-link'

/**
 * Task 2237b — the guest side of a shared folder link.
 *
 * Everything below happens in a context with no account at all: the link URL
 * (token plus the `#key=` fragment) is the only credential, and the proof the
 * server hands back after `POST /verify` is the only session state. The specs
 * therefore also prove the two properties that matter most: a reload keeps
 * working from sessionStorage, and a link that is wrong or gone dead-ends on
 * one message instead of leaking which part failed.
 */
test.describe('2237b — a guest browses, previews and downloads a linked folder', () => {
  test.describe.configure({ retries: 0 })

  test('grid, list, breadcrumb, preview and the zip all work from the link alone', async ({ page, browser }) => {
    test.setTimeout(300_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-guest-browse'),
      password: '2237bGuestBrowse-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Guest browse')
    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'view', label: 'Browse only' })
    await closeSharePanel(page)

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)

    // Folders sort first, so the nested folder is the first cell.
    const cells = guest.getByTestId('guest-grid-cell')
    await expect(cells).toHaveCount(2, { timeout: 60_000 })
    await expect(cells.first()).toContainText(folder.nestedFolder)
    await expect(cells.last()).toContainText(folder.rootFile)

    // The list toggle persists across a reload (localStorage, per browser).
    await guest.getByRole('button', { name: 'List' }).click()
    await expect(guest.getByTestId('guest-list-row')).toHaveCount(2)
    await guest.reload()
    await expect(guest.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true', {
      timeout: 60_000,
    })

    // Into the nested folder, then back out through the root crumb.
    await guest.getByTestId('guest-list-row').filter({ hasText: folder.nestedFolder }).click()
    await expect(guest.getByTestId('guest-list-row')).toHaveCount(1, { timeout: 30_000 })
    await expect(guest.getByTestId('guest-list-row').first()).toContainText(folder.nestedFile)
    await guest.getByRole('button', { name: folder.folderName }).click()
    await expect(guest.getByTestId('guest-list-row')).toHaveCount(2, { timeout: 30_000 })

    // Preview opens from the row and Escape closes it.
    await guest.getByTestId('guest-list-row').filter({ hasText: folder.rootFile }).click()
    await expect(guest.getByTestId('preview-close-button')).toBeVisible({ timeout: 60_000 })
    await expect(guest.getByText(folder.rootFile).first()).toBeVisible()
    await guest.keyboard.press('Escape')
    await expect(guest.getByTestId('preview-close-button')).toHaveCount(0)

    // Download all streams a zip named after the folder.
    const download = guest.waitForEvent('download', { timeout: 120_000 })
    await guest.getByRole('button', { name: 'Download all' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`${folder.folderName}.zip`)

    await guestCtx.close()
  })

  test('search narrows the listing and name-desc keeps folders first', async ({ page, browser }) => {
    test.setTimeout(300_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-guest-search'),
      password: '2237bGuestSearch-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Guest search')
    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'view' })
    await closeSharePanel(page)

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })

    await guest.getByLabel('Sort').selectOption('name-desc')
    const ordered = guest.getByTestId('guest-grid-cell')
    await expect(ordered.first()).toContainText(folder.nestedFolder)

    const search = guest.getByRole('searchbox', { name: 'Search this folder' })
    await search.fill(folder.rootFile.replace(/\.txt$/, '').slice(0, 12))
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(1, { timeout: 30_000 })
    await expect(guest.getByTestId('guest-grid-cell').first()).toContainText(folder.rootFile)

    await search.fill('nothing-matches-this-2237b')
    await expect(guest.getByText(/Nothing matches/)).toBeVisible({ timeout: 30_000 })

    await guestCtx.close()
  })

  test('an unknown token dead-ends on the one unavailable message', async ({ browser }) => {
    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(`/f/${'a'.repeat(43)}#key=${'b'.repeat(43)}`)
    await expect(
      guest.getByRole('heading', { name: "This link isn't available." }).first(),
    ).toBeVisible({ timeout: 60_000 })
    await expect(guest.getByText(/It may have been turned off, expired/)).toBeVisible()
    await guestCtx.close()
  })
})

test.describe('2237b — a guest with an add link uploads into the folder', () => {
  test.describe.configure({ retries: 0 })

  test('the name prompt appears once, the file survives a reload, and a clash is renamed', async ({ page, browser }) => {
    test.setTimeout(360_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-guest-upload'),
      password: '2237bGuestUpload-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folderName = uniqueName('Guest uploads')
    await createFolder(page, folderName)
    const link = await createFolderLinkViaUi(page, folderName, { level: 'add', label: 'Drop here' })
    await closeSharePanel(page)

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)
    await expect(guest.getByText('This folder is empty.')).toBeVisible({ timeout: 60_000 })

    const name = `dropped-${Date.now()}.txt`
    await guest.locator('input[type=file]').first().setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('dropped from a link'),
    })

    // The prompt comes before any upload request, once per browser.
    await expect(guest.getByText('What should we call you?')).toBeVisible({ timeout: 30_000 })
    await guest.getByLabel('Your name').fill('Mum')
    await guest.getByRole('button', { name: 'Continue' }).click()
    await expect(guest.locator('li[data-state=added]').first()).toBeVisible({ timeout: 120_000 })
    await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: name })).toBeVisible({
      timeout: 60_000,
    })

    // Reload: the proof in sessionStorage is enough to list the folder again.
    await guest.reload()
    await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: name })).toBeVisible({
      timeout: 60_000,
    })

    // The second upload is not asked again.
    const second = `again-${Date.now()}.txt`
    await guest.locator('input[type=file]').first().setInputFiles({
      name: second,
      mimeType: 'text/plain',
      buffer: Buffer.from('second drop'),
    })
    await expect(guest.getByText('What should we call you?')).toHaveCount(0)
    await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: second })).toBeVisible({
      timeout: 120_000,
    })

    // A file the folder already holds is renamed rather than overwritten.
    await guest.locator('input[type=file]').first().setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('same name again'),
    })
    await expect(
      guest.getByTestId('guest-grid-cell').filter({ hasText: new RegExp(`${escapeRe(name.replace(/\.txt$/, ''))} \\(2\\)`) }),
    ).toBeVisible({ timeout: 120_000 })

    await guestCtx.close()
  })

  test('a passphrase link asks once, then the proof carries the reload', async ({ page, browser }) => {
    test.setTimeout(300_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2237b-guest-proof'),
      password: '2237bGuestProof-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folder = await ownerFolderWithContent(page, 'Guest proof')
    const passphrase = 'proof survives 2237b'
    const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'view', passphrase })
    await closeSharePanel(page)

    const guestCtx = await anonymousContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)
    await expect(guest.getByRole('heading', { name: 'This folder is protected' })).toBeVisible({
      timeout: 60_000,
    })
    await guest.getByLabel('Passphrase').fill(passphrase)
    await guest.getByRole('button', { name: 'Open folder' }).click()
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })

    await guest.reload()
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })
    await expect(guest.getByRole('heading', { name: 'This folder is protected' })).toHaveCount(0)

    // A brand-new context has no proof: the link asks again.
    const freshCtx = await anonymousContext(browser)
    const fresh = await freshCtx.newPage()
    await fresh.goto(link.url)
    await expect(fresh.getByRole('heading', { name: 'This folder is protected' })).toBeVisible({
      timeout: 60_000,
    })

    await freshCtx.close()
    await guestCtx.close()
  })
})
