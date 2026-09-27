/**
 * Task 1585 — office editor follow-ups, against the REAL LibreOffice-WASM
 * engine (same prerequisites and skip gates as e2e/1567-office-editor.spec.ts):
 *
 *   (item 2) a document LibreOffice cannot read reaches the user as a
 *            specific, honest message with a real error kind — not the old
 *            generic "Failed to open this document" (the engine's rejection
 *            comes from the iframe's realm, so `instanceof Error` never held);
 *   (item 3) at phone-portrait width the outline starts collapsed to its
 *            32 px rail, opens as an overlay that does not resize the canvas,
 *            and returns to the docked pane at desktop width;
 *   (licenses) the editor links the engine's THIRD_PARTY_NOTICES.txt for the
 *            running version and names github.com/beebeeb-io/office.
 *
 * Run with the private-port harness:
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:38201 E2E_API_PORT=38201 E2E_VITE_PORT=38202 \
 *     E2E_DB_NAME=beebeeb_web_e2e_1585 ./e2e/scripts/web-e2e.sh e2e/1585-office-followups.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { strToU8, zipSync } from 'fflate'
import { writePptxFixture, writeRichDocxFixture, RICH_DOCX_HEADINGS } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'
import { OFFICE_BOOT_BUDGET_MS, autoDismissDevBanner, waitOfficeSettled } from './helpers/office-ready'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1585'

test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — this suite exercises the real feature-flagged engine')

test.setTimeout(OFFICE_BOOT_BUDGET_MS + 120_000)

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

async function dismissDevBanner(page: Page): Promise<void> {
  // Task 1585: a locator handler dismisses the banner before any later
  // action, whenever it appears (see autoDismissDevBanner). Deliberately NO
  // explicit wait-and-click as well: clicking the handler's own locator
  // triggers the handler inside that click's actionability check, and the
  // two deadlocked for the whole test timeout (seen once in the 1585 gate:
  // "locator.click: Test timeout of 300000ms exceeded" on the dismiss button).
  await autoDismissDevBanner(page)
}

async function uploadFixture(page: Page, file: string): Promise<string> {
  await page.goto('/')
  await dismissDevBanner(page)
  const base = await uploadAndWait(page, file)
  await dismissDevBanner(page)
  return base
}

/** Drive → preview → Edit → the office editor's own tab (not yet waiting on the engine). */
async function openOfficeTab(page: Page, context: BrowserContext, base: string): Promise<Page> {
  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 10_000 })
  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const tab = await popupPromise
  await tab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(tab)
  await page.keyboard.press('Escape')
  return tab
}

/**
 * The status bar is one line and inside the viewport, and its right cluster
 * (encryption state, save state, Licenses) is fully visible. Codex P2 on PR
 * #123: Calc's stats, Impress's slide label and the post-save clock could
 * push those off-screen at phone width.
 */
async function expectStatusBarFits(tab: Page, width: number): Promise<void> {
  const bar = tab.getByTestId('office-status-bar')
  const fit = await bar.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(fit.scroll, 'status bar does not overflow').toBeLessThanOrEqual(fit.client)
  for (const id of ['office-status-saved', 'office-about-button']) {
    const box = await tab.getByTestId(id).boundingBox()
    expect(box, id).not.toBeNull()
    expect(box!.height, `${id} is a single line`).toBeLessThan(20)
    expect(box!.x, `${id} starts on screen`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${id} ends on screen`).toBeLessThanOrEqual(width)
  }
}

/** Opens the same /office/<id> route fresh in a phone-width page (the initial state a phone user gets). */
async function openOnPhone(context: BrowserContext, officeUrl: string): Promise<Page> {
  const tab = await context.newPage()
  await tab.setViewportSize(PHONE)
  await autoDismissDevBanner(tab)
  await tab.goto(officeUrl)
  await waitOfficeSettled(tab)
  return tab
}

/** A .docx that IS a zip (so the 1584 magic-byte guard lets it through) but holds no Word document at all. */
function writeNotADocumentDocx(name: string): string {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, zipSync({ 'notes.txt': strToU8('This zip has no word/document.xml in it.') }, { level: 6 }))
  return file
}

test('(item 2) a document the engine cannot read gets a specific, honest error with its kind', async ({ page, context }) => {
  const base = await uploadFixture(page, writeNotADocumentDocx(`1585-not-a-doc-${process.pid}.docx`))
  const tab = await openOfficeTab(page, context, base)
  const consoleErrors: string[] = []
  tab.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  const error = tab.getByTestId('office-open-error')
  await expect(error).toBeVisible({ timeout: OFFICE_BOOT_BUDGET_MS })
  const kind = await error.getAttribute('data-kind')
  const message = (await tab.getByTestId('office-open-error-message').textContent()) ?? ''
  const detail = (await tab.getByTestId('office-open-error-detail').textContent().catch(() => '')) ?? ''
  console.log(`[1585 item 2] kind=${kind} message=${JSON.stringify(message)} detail=${JSON.stringify(detail)}`)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'item2-invalid-document.png') })

  expect(kind, 'a real error kind crossed the iframe boundary').toBe('invalid-document')
  expect(message).toContain("isn't a document the editor can read")
  expect(message).not.toContain('Failed to open this document')
  expect(detail.length, 'the raw engine text is kept as the detail line').toBeGreaterThan(0)
  expect(consoleErrors.some((t) => t.includes('[office] open failed (invalid-document)'))).toBe(true)
  // No outline, no loading label: the editor is in its error state.
  await expect(tab.getByTestId('office-outline-pane')).toHaveCount(0)
  await tab.close()
})

test('(item 3) phone portrait: the outline starts collapsed and opens over the canvas', async ({ page, context }) => {
  const base = await uploadFixture(page, writeRichDocxFixture(`1585-phone-${process.pid}.docx`))
  const desktopTab = await openOfficeTab(page, context, base)
  const officeUrl = desktopTab.url()
  await desktopTab.close()

  const tab = await openOnPhone(context, officeUrl)

  const rail = tab.getByTestId('office-outline-rail')
  const pane = tab.getByTestId('office-outline-pane')
  const frame = tab.getByTestId('office-engine-frame-crop')
  await expect(rail).toBeVisible()
  await expect(pane).toHaveCount(0)
  const frameCollapsed = await frame.boundingBox()
  expect(frameCollapsed, 'engine canvas area').not.toBeNull()
  console.log(`[1585 item 3] phone canvas width collapsed=${frameCollapsed!.width} of ${PHONE.width}`)
  // Only the 32 px rail is taken: the canvas keeps at least 90 % of the width.
  expect(frameCollapsed!.width).toBeGreaterThanOrEqual(PHONE.width * 0.9)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'item3-phone-collapsed.png') })
  await expectStatusBarFits(tab, PHONE.width)

  // Open: an overlay, and the canvas is NOT resized underneath it.
  await tab.getByTestId('office-outline-show').click()
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('data-overlay', 'true')
  await expect(pane).toContainText(RICH_DOCX_HEADINGS[0], { timeout: 30_000 })
  const frameOpen = await frame.boundingBox()
  expect(frameOpen!.width).toBe(frameCollapsed!.width)
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'item3-phone-outline-open.png') })

  // Picking a heading closes the overlay again on a phone.
  await tab.getByTestId('outline-item-1').click()
  await expect(pane).toHaveCount(0)
  await expect(rail).toBeVisible()

  // Desktop width: the docked pane, expanded by default, not an overlay.
  await tab.setViewportSize(DESKTOP)
  await expect(pane).toBeVisible()
  await expect(pane).not.toHaveAttribute('data-overlay', 'true')
  const paneBox = await pane.boundingBox()
  expect(paneBox!.width).toBe(216)
  // And back to phone width: collapsed again.
  await tab.setViewportSize(PHONE)
  await expect(pane).toHaveCount(0)
  await expect(rail).toBeVisible()

  // After a save the save state is "saved as version 2 · <time>" — the
  // longest it gets. Still one line, still on screen at phone width.
  const engine = tab.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(engine, 'engine frame').toBeTruthy()
  await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').click()
  await engine!.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice.dispatch('.uno:SelectAll')
  })
  await tab.keyboard.type(' phone edit', { delay: 30 })
  await expect(tab.getByTestId('office-unsaved-dot')).toBeVisible({ timeout: 30_000 })
  await tab.getByTestId('office-save').click()
  await expect(tab.getByTestId('office-status-saved')).toHaveText(/^saved as version 2/, { timeout: 60_000 })
  await expectStatusBarFits(tab, PHONE.width)
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'item3-phone-after-save.png') })
  await tab.close()
})

test('(item 3) phone portrait, Impress: the slide label and the save state share one line', async ({ page, context }) => {
  const base = await uploadFixture(page, writePptxFixture(`1585-phone-${process.pid}.pptx`))
  const desktopTab = await openOfficeTab(page, context, base)
  const officeUrl = desktopTab.url()
  await desktopTab.close()

  const tab = await openOnPhone(context, officeUrl)
  const bar = tab.getByTestId('office-status-bar')
  await expect(bar).toContainText(/Slide \d+ of \d+/, { timeout: 30_000 })
  await expectStatusBarFits(tab, PHONE.width)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'item3-phone-impress.png') })
  await tab.close()
})

test('(licenses) the editor links the running engine version’s THIRD_PARTY_NOTICES.txt and names the source repo', async ({ page, context }) => {
  const base = await uploadFixture(page, writeRichDocxFixture(`1585-licenses-${process.pid}.docx`))
  const tab = await openOfficeTab(page, context, base)
  await waitOfficeSettled(tab)

  const manifest = (await (await tab.request.get('/office/manifest.json')).json()) as { version: string }
  await tab.getByTestId('office-about-button').click()
  const panel = tab.getByTestId('office-about-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('github.com/beebeeb-io/office')
  await expect(tab.getByTestId('office-about-source')).toHaveAttribute('href', 'https://github.com/beebeeb-io/office')
  const link = tab.getByTestId('office-licenses-link')
  const expectedHref = `/office/${manifest.version}/THIRD_PARTY_NOTICES.txt`
  await expect(link).toHaveAttribute('href', expectedHref)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await tab.screenshot({ path: path.join(EVIDENCE_DIR, 'licenses-panel.png') })

  // The link resolves to the real notices, served as text.
  const resp = await tab.request.get(expectedHref)
  expect(resp.status()).toBe(200)
  expect(resp.headers()['content-type'] ?? '').toContain('text/plain')
  const body = await resp.text()
  expect(body).toContain('Mozilla Public License')
  expect(body).toContain('Source Code Form')
  expect(body).toContain('https://github.com/beebeeb-io/office')

  // Clicking it opens the notices in a new tab.
  const noticesPromise = context.waitForEvent('page')
  await link.click()
  const notices = await noticesPromise
  await notices.waitForLoadState('domcontentloaded')
  expect(new URL(notices.url()).pathname).toBe(expectedHref)
  await expect(notices.locator('body')).toContainText('third-party notices')

  // Escape closes the panel.
  await tab.bringToFront()
  await tab.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await notices.close()
  await tab.close()
})
