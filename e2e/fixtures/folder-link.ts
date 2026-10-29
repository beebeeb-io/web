import { expect, type Locator, type Page } from '@playwright/test'
import { openRowMenu, uploadTextFile } from '../helpers/drive'

/**
 * Task 2237b — shared folder link fixture.
 *
 * Every spec in this group needs the same three things: a folder with content
 * the guest may browse, a link minted through the REAL owner panel, and the
 * `#key=` fragment the guest page needs. Doing it here keeps the specs about
 * behaviour rather than about the drive's chrome.
 */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A folder/file name unique to this run, so parallel lanes cannot collide. */
export const uniqueName = (prefix: string): string => `${prefix} ${Date.now()}`

async function dismissIfShown(locator: Locator, timeoutMs = 5_000): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs })
    await locator.click()
  } catch {
    // Never appeared within the budget — nothing to dismiss.
  }
}

/** The overlays a brand-new account sees before the drive is usable. */
export async function dismissFirstRunOverlays(page: Page): Promise<void> {
  await dismissIfShown(page.getByRole('button', { name: 'Essential only' }))
  await dismissIfShown(page.getByRole('button', { name: /^Skip for now$/ }))
  await dismissIfShown(
    page.getByRole('dialog', { name: /Upload your first file/i }).getByRole('button', { name: /Skip tour/i }),
  )
  await dismissIfShown(page.getByRole('button', { name: 'Dismiss verification banner' }))
}

export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-menu-trigger').click()
  await page.getByTestId('new-menu-folder').click()
  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.getByPlaceholder('e.g. Contracts').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await page
    .getByRole('row', { name: new RegExp(`${escapeRe(name)}, folder`) })
    .first()
    .waitFor({ timeout: 15_000 })
}

export async function enterFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('row', { name: new RegExp(`${escapeRe(name)}, folder`) }).first().dblclick()
  await expect(page).toHaveURL(/[?&]folder=/, { timeout: 10_000 })
  // The list re-fetches after the URL flips; uploading inside that window binds
  // to the folder we just left (the 2238 spec documents the same race).
  await page.waitForTimeout(1_500)
}

/** Upload and prove the row is the list's own, not a transient upload chip. */
export async function uploadAndConfirmRow(page: Page, filename: string, body: string): Promise<void> {
  await uploadTextFile(page, filename, body)
  await expect(
    page.getByRole('row', { name: new RegExp(escapeRe(filename)) }),
    'the uploaded file must be a persisted row in the folder we are looking at',
  ).toHaveCount(1, { timeout: 30_000 })
}

export async function goToDriveRoot(page: Page): Promise<void> {
  await page.goto('/?nodev=1')
  await page.getByTestId('new-menu-trigger').waitFor({ timeout: 20_000 })
}

/** The folder id the drive keeps in `?folder=` while a folder is open. */
export function folderIdFromUrl(page: Page): string {
  const id = new URL(page.url()).searchParams.get('folder')
  if (!id) throw new Error(`no ?folder= id in ${page.url()}`)
  return id
}

export interface GuestFolderLink {
  /** The whole `/f/<token>#key=…` string the owner copies. */
  url: string
  token: string
  fragmentKey: string
}

export function splitFolderLink(url: string): GuestFolderLink {
  const parsed = new URL(url)
  const token = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
  const match = /[#&]key=([^&]+)/.exec(parsed.hash)
  if (!token || !match) throw new Error(`not a folder link with a key fragment: ${url}`)
  return { url, token, fragmentKey: match[1] }
}

async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL })
}

/** Open the owner's folder share panel from the folder's row menu. */
export async function openFolderSharePanel(page: Page, folderName: string): Promise<Locator> {
  await openRowMenu(page, folderName)
  await page.getByRole('menuitem', { name: /^Share/ }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Share folder' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  return dialog
}

export interface CreateFolderLinkOptions {
  level?: 'view' | 'add' | 'edit'
  passphrase?: string
  label?: string
}

/**
 * Mint one link through the real panel and return what the Copy button put on
 * the clipboard. The URL is the only place the link key exists, so the
 * clipboard is the honest source — there is no other surface that has it.
 */
export async function createFolderLinkViaUi(
  page: Page,
  folderName: string,
  options: CreateFolderLinkOptions = {},
): Promise<GuestFolderLink> {
  await grantClipboard(page)
  const dialog = await openFolderSharePanel(page, folderName)
  if (options.label) {
    await dialog.getByPlaceholder('For the design team').fill(options.label)
  }
  if (options.level) {
    await dialog.getByLabel('Access').selectOption(options.level)
  }
  if (options.passphrase) {
    await dialog.getByLabel('Passphrase (optional)').fill(options.passphrase)
  }
  await dialog.getByRole('button', { name: 'Create link' }).click()

  const row = dialog.getByTestId('folder-link-row').first()
  await expect(row, 'the new link must appear in the panel').toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: 'Copy link' }).click()
  await expect(row.getByText('Link copied.')).toBeVisible({ timeout: 5_000 })
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied, 'the copied link must be a /f/<token>#key=… folder link').toMatch(/\/f\/[^#]+#key=/)
  return splitFolderLink(copied)
}

export async function closeSharePanel(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Share folder' })
  // The panel is an inline modal without an Escape handler; its own Close
  // button is the way out.
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 5_000 })
}

/**
 * Owner fixture: a folder with one text file plus a nested folder with one
 * text file, so both the listing and the breadcrumb have something real.
 */
export interface OwnerFolder {
  folderName: string
  folderId: string
  rootFile: string
  nestedFolder: string
  nestedFile: string
  bodies: Record<string, string>
}

export async function ownerFolderWithContent(page: Page, prefix: string): Promise<OwnerFolder> {
  const folderName = uniqueName(prefix)
  const rootFile = `note-${Date.now()}.txt`
  const nestedFolder = `Nested ${Date.now()}`
  const nestedFile = `inner-${Date.now()}.txt`
  const bodies = {
    [rootFile]: `root payload ${folderName}`,
    [nestedFile]: `nested payload ${folderName}`,
  }

  await createFolder(page, folderName)
  await enterFolder(page, folderName)
  const folderId = folderIdFromUrl(page)
  await uploadAndConfirmRow(page, rootFile, bodies[rootFile])
  await createFolder(page, nestedFolder)
  await enterFolder(page, nestedFolder)
  await uploadAndConfirmRow(page, nestedFile, bodies[nestedFile])
  await goToDriveRoot(page)
  await page
    .getByRole('row', { name: new RegExp(`${escapeRe(folderName)}, folder`) })
    .first()
    .waitFor({ timeout: 20_000 })

  return { folderName, folderId, rootFile, nestedFolder, nestedFile, bodies }
}
