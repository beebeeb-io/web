/**
 * Task 1567 SHIP GATES — Visual gate (independent verification lane).
 *
 * Screenshots of Writer, Calc and Impress, light + dark, against the REAL
 * engine — for side-by-side comparison with the approved mockup
 * (design/office-editor-shots/{writer,calc,impress}-{light,dark}.png).
 * Reuses the exact readiness/fixture patterns the Writer/Calc/Impress
 * lanes' own e2e specs and 1567-office-impress-screens.spec.ts already
 * established. Writes into an absolute path outside the repo (session
 * evidence dir) so these don't collide with test-results/ cleanup.
 *
 * Run: VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:38001 \
 *   E2E_API_PORT=38001 E2E_VITE_PORT=38002 E2E_DB_NAME=beebeeb_web_e2e_visual \
 *   ./e2e/scripts/web-e2e.sh e2e/1567-visual-gate-screens.spec.ts
 */
import { test, type Page, type BrowserContext } from '@playwright/test'
import fs from 'fs'
import { writeDocxFixture, writePptxFixture } from './helpers/office-fixtures'
import { writeXlsxFixture } from './helpers/office-fixtures-calc'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'
import { OFFICE_SETTLE_BUDGET_MS, waitOfficeSettled } from './helpers/office-ready'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true')

// Task 1585: 1 engine boot(s) at the ready helper's budget, plus the test's own work.
test.setTimeout(OFFICE_SETTLE_BUDGET_MS + 120_000)

// Task 1585: the default was one lane's own Mac scratchpad path, which does
// not exist (EACCES) on any other machine; repo-relative now.
const OUT_DIR = process.env.VISUAL_GATE_OUT_DIR || 'test-results/1567-visual'
fs.mkdirSync(OUT_DIR, { recursive: true })

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

async function openOfficeTab(
  page: Page,
  context: BrowserContext,
  theme: 'light' | 'dark',
  fixturePath: string,
): Promise<Page> {
  await page.addInitScript((t) => localStorage.setItem('beebeeb-theme', t), theme)
  await page.goto('/')
  await dismissDevBanner(page)
  const base = await uploadAndWait(page, fixturePath)
  await dismissDevBanner(page)
  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 10_000 })
  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const officeTab = await popupPromise
  await officeTab.addInitScript((t) => localStorage.setItem('beebeeb-theme', t), theme)
  await officeTab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(officeTab)
  return officeTab
}

async function shootWriter(page: Page, context: BrowserContext, theme: 'light' | 'dark') {
  const fixturePath = writeDocxFixture(`office-visual-writer-${theme}-${process.pid}.docx`, [
    'Visual gate fixture paragraph — Writer.',
    'Second paragraph for the outline pane / word count.',
  ])
  const officeTab = await openOfficeTab(page, context, theme, fixturePath)
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab)
  await officeTab.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 15_000 })
  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  await officeTab.waitForTimeout(1000)
  await officeTab.screenshot({ path: `${OUT_DIR}/writer-${theme}.png` })
  await officeTab.close()
}

async function shootCalc(page: Page, context: BrowserContext, theme: 'light' | 'dark') {
  const fixturePath = writeXlsxFixture(`office-visual-calc-${theme}-${process.pid}.xlsx`, [10, 20, 30])
  const officeTab = await openOfficeTab(page, context, theme, fixturePath)
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab)
  await officeTab.getByTestId('calc-formula-bar').waitFor({ state: 'visible', timeout: 15_000 })
  await officeTab.getByTestId('calc-sheet-tabs').waitFor({ state: 'visible', timeout: 15_000 })
  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  await officeTab.waitForTimeout(1000)
  await officeTab.screenshot({ path: `${OUT_DIR}/calc-${theme}.png` })
  await officeTab.close()
}

async function shootImpress(page: Page, context: BrowserContext, theme: 'light' | 'dark') {
  const fixturePath = writePptxFixture(`office-visual-impress-${theme}-${process.pid}.pptx`)
  const officeTab = await openOfficeTab(page, context, theme, fixturePath)
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab)
  await officeTab.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 15_000 })
  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  await officeTab.waitForTimeout(1000)
  await officeTab.screenshot({ path: `${OUT_DIR}/impress-${theme}.png` })
  await officeTab.close()
}

test('screenshot: Writer, light', async ({ page, context }) => shootWriter(page, context, 'light'))
test('screenshot: Writer, dark', async ({ page, context }) => shootWriter(page, context, 'dark'))
test('screenshot: Calc, light', async ({ page, context }) => shootCalc(page, context, 'light'))
test('screenshot: Calc, dark', async ({ page, context }) => shootCalc(page, context, 'dark'))
test('screenshot: Impress, light', async ({ page, context }) => shootImpress(page, context, 'light'))
test('screenshot: Impress, dark', async ({ page, context }) => shootImpress(page, context, 'dark'))
