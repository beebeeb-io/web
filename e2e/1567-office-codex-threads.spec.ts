/**
 * Task 1567 — regression coverage for the three Codex P1 threads on web PR
 * #113, against the REAL LibreOffice-WASM engine (same prerequisites and
 * skip gates as e2e/1567-office-editor.spec.ts):
 *
 *   (a) the top-level /office/:fileId route arms a `beforeunload` guard while
 *       the document is dirty, and only then;
 *   (b) "Discard" while a save is genuinely in flight (initUpload committed,
 *       a chunk PUT stuck) abandons the upload server-side before the tab
 *       exits — the file is not left wedged and the previous version stays;
 *   (c) after "Keep Both" the session is retargeted at the sibling: the next
 *       Save lands on the sibling as its version 2, and the original is not
 *       touched again.
 *
 * Run with the private-port harness:
 *   VITE_STATUS_URL=http://localhost:38611 VITE_FEATURE_OFFICE_EDITOR=true E2E_API_PORT=38611 E2E_VITE_PORT=38612 \
 *     E2E_DB_NAME=beebeeb_web_e2e_113 ./e2e/scripts/web-e2e.sh e2e/1567-office-codex-threads.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import { writeDocxFixture } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — this suite exercises the real feature-flagged engine')

test.setTimeout(300_000)

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

/** Drive → preview → Edit → the office editor's own tab, engine booted and document open. */
async function openInOffice(page: Page, context: BrowserContext, base: string): Promise<Page> {
  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 10_000 })
  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const tab = await popupPromise
  await tab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(tab)
  await tab.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 120_000 })
  await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  // Close the preview overlay on the Drive tab so a later openPreview() starts clean.
  await page.keyboard.press('Escape')
  return tab
}

/** Replace the whole document text through the real engine (select-all is awaited — see 1567-office-editor.spec.ts). */
async function typeIntoDoc(tab: Page, text: string): Promise<void> {
  const frame = tab.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frame, 'engine frame').toBeTruthy()
  await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').click()
  await frame!.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice.dispatch('.uno:SelectAll')
  })
  await tab.keyboard.type(text, { delay: 30 })
  await expect(tab.getByTestId('office-unsaved-dot')).toBeVisible({ timeout: 10_000 })
}

function fileIdOf(tab: Page): string {
  const m = new URL(tab.url()).pathname.match(/^\/office\/([^/]+)$/)
  expect(m, `office tab URL ${tab.url()}`).not.toBeNull()
  return m![1]
}

async function currentVersion(page: Page, fileId: string): Promise<number> {
  const resp = await page.request.get(`${API_URL}/api/v1/files/${fileId}/versions`)
  expect(resp.ok(), `GET versions for ${fileId}: ${resp.status()}`).toBe(true)
  return (await resp.json()).current_version as number
}

async function setup(page: Page, name: string): Promise<string> {
  await page.addInitScript(() => localStorage.setItem('bb-office-labs', 'true'))
  await page.goto('/')
  await dismissDevBanner(page)
  const base = await uploadAndWait(page, writeDocxFixture(name, ['Original fixture paragraph.']))
  await dismissDevBanner(page)
  return base
}

test('(a) beforeunload guard: armed while dirty, released once saved', async ({ page, context }) => {
  const base = await setup(page, `1567-unload-${process.pid}.docx`)
  const tab = await openInOffice(page, context, base)

  const dialogs: string[] = []
  tab.on('dialog', async (d) => {
    dialogs.push(d.type())
    await d.dismiss() // "Stay on page"
  })

  await typeIntoDoc(tab, 'Unsaved edit that must not vanish on tab close')
  await tab.close({ runBeforeUnload: true })
  await expect.poll(() => dialogs, { timeout: 10_000 }).toEqual(['beforeunload'])
  expect(tab.isClosed(), 'dismissing the beforeunload prompt keeps the tab open').toBe(false)

  // Save → clean → the guard is released: closing now prompts nothing.
  await tab.getByTestId('office-save').click()
  await expect(tab.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 30_000 })
  const closed = tab.waitForEvent('close', { timeout: 10_000 })
  await tab.close({ runBeforeUnload: true })
  await closed
  expect(dialogs, 'no prompt on a clean document').toEqual(['beforeunload'])
})

test('(b) Discard while a save is genuinely in flight abandons the upload server-side before exit', async ({ page, context }) => {
  const base = await setup(page, `1567-discard-${process.pid}.docx`)
  const tab = await openInOffice(page, context, base)
  const fileId = fileIdOf(tab)

  // Context-level listeners: the office tab closes itself on exit, so a
  // page-level waitForResponse could be torn down with it.
  const abandonStatuses: number[] = []
  context.on('response', (r) => {
    if (r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/files/${fileId}/upload/abandon`) {
      abandonStatuses.push(r.status())
    }
  })

  // Hold every chunk PUT: by the time one is seen, initUpload has committed
  // server-side (is_uploading = TRUE for this real file id).
  await tab.route('**/chunks/*', async () => {
    await new Promise(() => {})
  })
  const chunkPutSeen = tab.waitForRequest((r) => r.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(r.url()).pathname), {
    timeout: 30_000,
  })

  await typeIntoDoc(tab, 'Draft that gets discarded mid-upload')
  await tab.getByTestId('office-save').click()
  await chunkPutSeen

  const tabClosed = tab.waitForEvent('close', { timeout: 30_000 })
  await tab.getByTestId('office-back').click()
  const guard = tab.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible({ timeout: 5_000 })
  await guard.getByTestId('unsaved-discard').click()
  await tabClosed

  expect(abandonStatuses, 'the abandon call must reach the server (200) before the tab goes away').toEqual([200])
  expect(await currentVersion(page, fileId), 'the discarded draft never became a version').toBe(1)

  // Not wedged: a real save on the same file succeeds as version 2.
  const tab2 = await openInOffice(page, context, base)
  await typeIntoDoc(tab2, 'Real save after the discard')
  await tab2.getByTestId('office-save').click()
  await expect(tab2.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 30_000 })
  expect(await currentVersion(page, fileId)).toBe(2)
  await tab2.close()
})

test('(c) Keep Both retargets the session: the next Save lands on the sibling, never the original', async ({ page, context }) => {
  const base = await setup(page, `1567-keepboth-${process.pid}.docx`)

  const initFileIds: string[] = []
  context.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/uploads/init') {
      const body = r.postDataJSON() as { file_id?: string }
      if (body?.file_id) initFileIds.push(body.file_id)
    }
  })

  // Client A opens (baseline version 1) and starts editing.
  const tabA = await openInOffice(page, context, base)
  const originalId = fileIdOf(tabA)
  await typeIntoDoc(tabA, 'A edit, based on version one')

  // Client B opens the same file and saves first → server version 2.
  const tabB = await openInOffice(page, context, base)
  await typeIntoDoc(tabB, 'B saved first')
  await tabB.getByTestId('office-save').click()
  await expect(tabB.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 30_000 })
  await tabB.close()
  expect(await currentVersion(page, originalId)).toBe(2)

  // A saves → conflict → Keep Both → a sibling is created.
  await tabA.bringToFront()
  await tabA.getByTestId('office-save').click()
  const dialog = tabA.getByTestId('office-conflict-dialog')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  initFileIds.length = 0
  await tabA.getByTestId('office-conflict-keep-both').click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  expect(initFileIds, 'Keep Both uploads exactly one new file').toHaveLength(1)
  const siblingId = initFileIds[0]
  expect(siblingId).not.toBe(originalId)
  // The session's baseline is now the sibling's own version 1.
  await expect(tabA.getByTestId('office-status-saved')).toHaveText(/saved as version 1/, { timeout: 10_000 })

  // Keep editing in the same tab and Save again: no conflict dialog, and the
  // upload targets the SIBLING.
  initFileIds.length = 0
  await typeIntoDoc(tabA, 'A keeps editing the copy')
  await tabA.getByTestId('office-save').click()
  await expect(tabA.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 30_000 })
  await expect(dialog).toBeHidden()
  expect(initFileIds, 'the post-Keep-Both save targets the sibling').toEqual([siblingId])

  expect(await currentVersion(page, siblingId), 'sibling got the second save').toBe(2)
  expect(await currentVersion(page, originalId), 'original untouched since B’s save').toBe(2)
  await tabA.close()
})
