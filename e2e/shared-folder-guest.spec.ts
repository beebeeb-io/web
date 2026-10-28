// e2e-flags: shared_folders_v1
import type { Browser, Download, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'
import {
  API_URL,
  closeSharePanel,
  createFolder,
  createFolderLinkViaUi,
  dismissFirstRunOverlays,
  escapeRe,
  enterFolder,
  folderIdFromUrl,
  openFolderSharePanel,
  ownerFolderWithContent,
  uniqueName,
} from './fixtures/folder-link'

/**
 * A guest has no account. In a dev build the app would auto-log this context
 * in as the dev user and pin the DEV banner over the top of the page (that
 * banner, not the page, is what clipped the title in the first screenshots).
 * Keep dev auto-login off, as on a real guest's browser.
 */
async function guestContext(browser: Browser) {
  const context = await anonymousContext(browser)
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('bb_dev_authed', 'skipped')
    } catch {
      /* storage unavailable: nothing to skip */
    }
  })
  return context
}

/**
 * Design-review screenshots of each guest state at a laptop and a phone size.
 * Default: e2e-artifacts/2237b-guest-screens/ (gitignored). Not test-results/:
 * the harness runs Playwright once per spec file and every run empties
 * test-results/. E2E_GUEST_SCREENSHOTS=<prefix> writes them elsewhere.
 */
async function captureGuest(page: Page, state: string) {
  const prefix = process.env.E2E_GUEST_SCREENSHOTS ?? 'e2e-artifacts/2237b-guest-screens/2237b-guest'
  for (const [label, width, height] of [['desktop', 1280, 720], ['phone', 390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: `${prefix}-${state}-${label}.png` })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}

/**
 * Task 2237b — the guest side of a shared folder link.
 *
 * Everything below happens in a context with no account at all: the link URL
 * (token plus the `#key=` fragment) is the only credential, and the proof the
 * server hands back after `POST /verify` is the only session state. The specs
 * therefore also prove that protected keys stay in page memory and a link
 * that is wrong or gone dead-ends on
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

    // L2: once the panel is closed, the link can still be copied again: the URL
    // is rebuilt from the owner's wrapped token and K_c, and it is the SAME link.
    const again = await openFolderSharePanel(page, folder.folderName)
    const linkRow = again.getByTestId('folder-link-row').first()
    await expect(linkRow.getByRole('button', { name: 'Copy link' })).toBeEnabled({ timeout: 30_000 })
    await linkRow.getByRole('button', { name: 'Copy link' }).click()
    await expect(linkRow.getByText('Link copied.')).toBeVisible({ timeout: 10_000 })
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link.url)
    await closeSharePanel(page)

    const guestCtx = await guestContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)

    // Folders sort first, so the nested folder is the first cell.
    const cells = guest.getByTestId('guest-grid-cell')
    await expect(cells).toHaveCount(2, { timeout: 60_000 })
    await expect(cells.first()).toContainText(folder.nestedFolder)
    await expect(cells.last()).toContainText(folder.rootFile)
    await captureGuest(guest, 'grid')

    // The list toggle persists across a reload (localStorage, per browser).
    await guest.getByRole('button', { name: 'List' }).click()
    await expect(guest.getByTestId('guest-list-row')).toHaveCount(2)
    await captureGuest(guest, 'list')
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

    const guestCtx = await guestContext(browser)
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
    const guestCtx = await guestContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(`/f/${'a'.repeat(43)}#key=${'b'.repeat(43)}`)
    await expect(
      guest.getByRole('heading', { name: "This link isn't available." }).first(),
    ).toBeVisible({ timeout: 60_000 })
    await expect(guest.getByText(/It may have been turned off, expired/)).toBeVisible()
    await captureGuest(guest, 'unavailable')
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

    const guestCtx = await guestContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)
    await expect(guest.getByText('This folder is empty.')).toBeVisible({ timeout: 60_000 })

    await enterFolder(page, folderName)
    const folderId = folderIdFromUrl(page)
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

    await captureGuest(guest, 'after-upload')

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

    const response = await page.request.get(`${API_URL}/api/v1/shared-folders/${folderId}/activity`)
    expect(response.status()).toBe(200)
    const activity = (await response.json()).activity.filter((row: { kind: string }) => row.kind === 'files_added')
    expect(activity.reduce((n: number, row: { item_count: number }) => n + row.item_count, 0)).toBe(3)
    expect(activity.every((row: { actor_name_encrypted: string | null }) => !!row.actor_name_encrypted)).toBe(true)
    await guestCtx.close()
  })

  test('a passphrase link prompts again after reload without persisting its folder key', async ({ page, browser }) => {
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

    const guestCtx = await guestContext(browser)
    const guest = await guestCtx.newPage()
    await guest.goto(link.url)
    await expect(guest.getByRole('heading', { name: 'This folder is protected' })).toBeVisible({
      timeout: 60_000,
    })
    await captureGuest(guest, 'passphrase')
    await guest.getByLabel('Passphrase').fill(passphrase)
    await guest.getByRole('button', { name: 'Open folder' }).click()
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })

    await guest.reload()
    await expect(guest.getByRole('heading', { name: 'This folder is protected' })).toBeVisible({ timeout: 60_000 })
    await guest.getByLabel('Passphrase').fill(passphrase)
    await guest.getByRole('button', { name: 'Open folder' }).click()
    await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })

    // A brand-new context has no proof: the link asks again.
    const freshCtx = await guestContext(browser)
    const fresh = await freshCtx.newPage()
    await fresh.goto(link.url)
    await expect(fresh.getByRole('heading', { name: 'This folder is protected' })).toBeVisible({
      timeout: 60_000,
    })

    await freshCtx.close()
    await guestCtx.close()
  })
})

async function downloadedBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('download stream missing')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/**
 * Open a file the way a person would and check the bytes. The owner's Files
 * list previews on double-click when the type has a viewer (text, images,
 * PDF); a type with no viewer (`.bin`) is downloaded from the row menu. The
 * guest page previews on a tap and downloads from the preview.
 */
async function assertPreviewDownload(page: Page, name: string, bytes: Buffer, owner = false) {
  const row = owner
    ? page.getByRole('row').filter({ hasText: name })
    : page.getByTestId('guest-grid-cell').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 60_000 })
  const previewable = !name.endsWith('.bin')
  if (owner && !previewable) {
    const download = page.waitForEvent('download', { timeout: 120_000 })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Download/ }).first().click()
    expect(await downloadedBytes(await download)).toEqual(bytes)
    return
  }
  if (owner) await row.dblclick()
  else await row.click()
  await expect(page.getByTestId('preview-close-button')).toBeVisible({ timeout: 60_000 })
  const download = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: 'Download', exact: true }).first().click()
  expect(await downloadedBytes(await download)).toEqual(bytes)
  await page.keyboard.press('Escape')
}

test('2237b >5MiB guest upload opens byte-for-byte for owner and second guest; late additions refresh keys', async ({ page, browser }) => {
  test.setTimeout(360_000)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('2237b-roundtrip'), password: 'Roundtrip-correct-horse-2237b' })
  await dismissFirstRunOverlays(page)
  const folderName = uniqueName('Roundtrip')
  await createFolder(page, folderName)
  const link = await createFolderLinkViaUi(page, folderName, { level: 'add' })
  await closeSharePanel(page)
  await enterFolder(page, folderName)
  const guestCtx = await guestContext(browser)
  const guest = await guestCtx.newPage()
  await guest.goto(link.url)
  await expect(guest.getByText('This folder is empty.')).toBeVisible({ timeout: 60_000 })
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 337)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  const name = 'guest-multiframe.bin'
  await guest.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes })
  await guest.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(guest.locator('li[data-state=added]').first()).toBeVisible({ timeout: 120_000 })
  // SSE updates the owner's already-open folder: no reload to repair keys.
  await assertPreviewDownload(page, name, bytes, true)
  const secondCtx = await guestContext(browser)
  const second = await secondCtx.newPage()
  await second.goto(link.url)
  await assertPreviewDownload(second, name, bytes)
  const late = Buffer.from('added after the owner already cached the first key')
  await guest.locator('input[type=file]').first().setInputFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: late })
  await assertPreviewDownload(page, 'late.txt', late, true)
  await secondCtx.close()
  await guestCtx.close()
})

test('2237b guest nested folder names and bytes open for owner and second guest', async ({ page, browser }) => {
  test.setTimeout(360_000)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('2237b-nested'), password: 'Nested-correct-horse-2237b' })
  await dismissFirstRunOverlays(page)
  const folderName = uniqueName('Nested roundtrip')
  await createFolder(page, folderName)
  const link = await createFolderLinkViaUi(page, folderName, { level: 'add' })
  await closeSharePanel(page)
  await enterFolder(page, folderName)
  const guestCtx = await guestContext(browser)
  const guest = await guestCtx.newPage()
  await guest.goto(link.url)
  await expect(guest.getByText('This folder is empty.')).toBeVisible({ timeout: 60_000 })
  await guest.locator('input[webkitdirectory]').evaluate((element: HTMLInputElement) => {
    const file = new File(['nested guest payload'], 'invoice.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Receipts/2026/invoice.txt' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    element.files = transfer.files
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await guest.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(guest.locator('li[data-state=added]').first()).toBeVisible({ timeout: 120_000 })
  const secondCtx = await guestContext(browser)
  const second = await secondCtx.newPage()
  await second.goto(link.url)
  for (const folder of ['Receipts', '2026']) {
    await expect(page.getByRole('row').filter({ hasText: folder })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('row').filter({ hasText: folder }).dblclick()
    await expect(second.getByTestId('guest-grid-cell').filter({ hasText: folder })).toBeVisible({ timeout: 60_000 })
    await second.getByTestId('guest-grid-cell').filter({ hasText: folder }).click()
  }
  await assertPreviewDownload(page, 'invoice.txt', Buffer.from('nested guest payload'), true)
  await assertPreviewDownload(second, 'invoice.txt', Buffer.from('nested guest payload'))
  // Owner upload after sharing uses the new owner-only publication route.
  const published = page.waitForResponse(response => /\/shared-folders\/[^/]+\/keys$/.test(response.url()) && response.request().method() === 'POST')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'owner-late.txt', mimeType: 'text/plain', buffer: Buffer.from('owner after sharing') })
  expect((await published).status()).toBe(200)
  await second.reload()
  await second.getByTestId('guest-grid-cell').filter({ hasText: 'Receipts' }).click()
  await second.getByTestId('guest-grid-cell').filter({ hasText: '2026' }).click()
  await assertPreviewDownload(second, 'owner-late.txt', Buffer.from('owner after sharing'))
  await secondCtx.close()
  await guestCtx.close()
})

test('2237b a guest drops a file on the page, and an upload lands in the folder they are viewing', async ({ page, browser }) => {
  test.setTimeout(300_000)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('2237b-drop'), password: 'Drop-correct-horse-2237b' })
  await dismissFirstRunOverlays(page)
  const folder = await ownerFolderWithContent(page, 'Guest drop')
  const link = await createFolderLinkViaUi(page, folder.folderName, { level: 'add' })
  await closeSharePanel(page)

  const guestCtx = await guestContext(browser)
  const guest = await guestCtx.newPage()
  await guest.goto(link.url)
  await expect(guest.getByTestId('guest-grid-cell')).toHaveCount(2, { timeout: 60_000 })

  // The Files drop zone: a drop is an upload, with no file picker involved.
  const dataTransfer = await guest.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['dropped on the page'], 'dropped.txt', { type: 'text/plain' }))
    return transfer
  })
  const zone = guest.getByRole('region', { name: 'Drop files here to upload' })
  await zone.dispatchEvent('dragenter', { dataTransfer })
  await zone.dispatchEvent('drop', { dataTransfer })
  await guest.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: 'dropped.txt' })).toBeVisible({ timeout: 120_000 })

  // Inside the nested folder, an upload goes into that folder, not the root.
  await guest.getByTestId('guest-grid-cell').filter({ hasText: folder.nestedFolder }).click()
  await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: folder.nestedFile })).toBeVisible({ timeout: 60_000 })
  await guest.locator('input[type=file]').first().setInputFiles({
    name: 'inside.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded inside the subfolder'),
  })
  await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: 'inside.txt' })).toBeVisible({ timeout: 120_000 })
  await guest.getByRole('button', { name: folder.folderName }).click()
  await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: 'dropped.txt' })).toBeVisible({ timeout: 60_000 })
  await expect(guest.getByTestId('guest-grid-cell').filter({ hasText: 'inside.txt' })).toHaveCount(0)
  await guestCtx.close()
})
