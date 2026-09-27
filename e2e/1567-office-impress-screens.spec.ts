/**
 * Task 1567 (Impress lane) — light+dark screenshots of the real Impress
 * editor (ribbon + filmstrip + status bar), for comparison against the
 * approved mockup (design/office-editor-shots/impress-{light,dark}.png).
 * Not a functional assertion beyond "the editor is visibly up" — the real
 * behavioural coverage lives in 1567-office-impress.spec.ts. Screenshots
 * land in test-results/ (gitignored scratch), regenerate any time by
 * re-running this file against a real repos/office build via
 * scripts/office-dev-assets.sh + the e2e harness (same pattern the Writer
 * lane's own screenshot note documents).
 *
 * Run: VITE_FEATURE_OFFICE_EDITOR=true E2E_API_PORT=37851 E2E_VITE_PORT=37852 \
 *   E2E_DB_NAME=beebeeb_web_e2e_impress ./e2e/scripts/web-e2e.sh e2e/1567-office-impress-screens.spec.ts
 */
import { test, type Page } from '@playwright/test'
import fs from 'fs'
import { writePptxFixture } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true')

test.setTimeout(180_000)

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

async function shootImpressEditor(page: Page, context: import('@playwright/test').BrowserContext, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('beebeeb-theme', t), theme)
  await page.goto('/')
  await dismissDevBanner(page)

  const fixturePath = writePptxFixture(`office-1567-impress-shot-${theme}-${process.pid}.pptx`)
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

  await officeTab.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 120_000 })
  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  await officeTab.getByTestId('office-ribbon').getByTestId('impress-ribbon-new-slide').click()
  await officeTab.waitForTimeout(1500) // let the new slide's PageStatus event + filmstrip settle
  await officeTab.screenshot({ path: `test-results/1567-impress-${theme}.png` })
  await officeTab.close()
}

test('screenshot: Impress editor, light theme', async ({ page, context }) => {
  await shootImpressEditor(page, context, 'light')
})

test('screenshot: Impress editor, dark theme', async ({ page, context }) => {
  await shootImpressEditor(page, context, 'dark')
})
