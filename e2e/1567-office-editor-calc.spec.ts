/**
 * Task 1567 (Calc lane) — Calc editor e2e, against the REAL LibreOffice-WASM
 * engine (repos/office/evidence/artifacts/emscripten, assembled into
 * public/office/ by scripts/office-dev-assets.sh — run that first, or this
 * whole file skips itself; see beforeAll). Mirrors
 * e2e/1567-office-editor.spec.ts's (Writer lane) real-engine rigor and
 * private-port convention, for Calc's own chrome:
 *
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:37841 \
 *     E2E_API_PORT=37841 E2E_VITE_PORT=37842 E2E_DB_NAME=beebeeb_web_e2e_calc \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-editor-calc.spec.ts
 *
 * `VITE_STATUS_URL` matters here (integration lane, task 1567, found by
 * actually running this without it): the app's pre-existing `IncidentBanner`
 * (src/app.tsx) fetches `status.beebeeb.io` on every mount, including this
 * spec's own office tab, and the zero-egress assertion below has no special
 * case for it — same pre-existing app-wide behavior the Writer lane's own
 * e2e file already documents, not something Calc introduced. Omitting the
 * override does not reliably fail (the fetch can lose the race with the
 * assertion), so a clean run here is not proof the assertion is airtight —
 * always pass it.
 *
 * Covers: upload a real .xlsx (A1:A3 = 10/20/30) → preview → Edit (own
 * top-level tab) → OUR ref box navigates via a real `.uno:GoToCell` dispatch
 * → OUR status bar shows real Sum/Average/Count of that selection (the
 * clipboard-peek mechanism documented in
 * src/lib/office/use-calc-selection-stats.ts, exercised here for the first
 * time in the REAL nested-iframe architecture, not just a standalone probe
 * page) → edit a cell's value directly → Bold via OUR ribbon (real
 * `onState` round trip) → rename the sheet via OUR sheet tab (real
 * `.uno:RenameTable` round trip) → ⌘S saves as a new version → reopen in a
 * fresh tab shows the edited value, the renamed sheet, AND the bold format,
 * all durably persisted server-side → zero egress to any non-self origin
 * across the whole session.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { writeXlsxFixture } from './helpers/office-fixtures-calc'
import { uploadAndWait, openPreview, previewOverlay, escapeRe } from './helpers/thumb-fixtures'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'

test.skip(
  !OFFICE_ASSETS_PRESENT,
  'public/office/manifest.json missing — run scripts/office-dev-assets.sh against a real repos/office build first',
)
test.skip(
  !OFFICE_FLAG_ON,
  'VITE_FEATURE_OFFICE_EDITOR!=true — this suite exercises the real feature-flagged engine, not the default-off production build',
)

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

async function goToCell(page: Page, ref: string): Promise<void> {
  const box = page.getByTestId('calc-ref-box')
  await box.fill(ref)
  await box.press('Enter')
  await expect(page.getByTestId('calc-formula-bar-status')).toHaveText(`Went to ${ref}`, { timeout: 10_000 })
}

test('upload .xlsx, real Sum/Average/Count via our status bar, edit a cell, Bold via our ribbon, rename the sheet, save as new version, reopen shows every edit — zero egress', async ({ page, context }) => {
  // Clipboard permissions for THIS context, granted before either tab opens
  // — the Calc status bar's Sum/Average/Count reads the real system
  // clipboard (see use-calc-selection-stats.ts's header for why).
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  // Ship prep (task 1567, 2026-09-27): runtime Labs opt-in, see
  // 1567-office-editor.spec.ts's own comment for why this is needed
  // alongside VITE_FEATURE_OFFICE_EDITOR.
  await page.addInitScript(() => localStorage.setItem('bb-office-labs', 'true'))
  await page.goto('/')
  await dismissDevBanner(page)

  const fixturePath = writeXlsxFixture(`office-1567-calc-${process.pid}.xlsx`, [10, 20, 30])
  const base = await uploadAndWait(page, fixturePath)
  await dismissDevBanner(page)

  const webOrigin = new URL(page.url()).origin
  const apiOrigin = process.env.E2E_API_URL ? new URL(process.env.E2E_API_URL).origin : webOrigin
  const foreignRequests: string[] = []
  function trackEgress(p: Page) {
    p.on('request', (req) => {
      const url = new URL(req.url())
      if (url.protocol === 'data:' || url.protocol === 'blob:') return
      if (url.origin === webOrigin || url.origin === apiOrigin) return
      foreignRequests.push(`${req.method()} ${req.url()}`)
    })
  }
  trackEgress(page)

  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 10_000 })

  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const officeTab = await popupPromise
  trackEgress(officeTab)
  await officeTab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(officeTab)

  await officeTab.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 15_000 })
  await officeTab.getByTestId('office-ribbon').waitFor({ state: 'visible', timeout: 15_000 })
  // Calc-specific chrome, not Writer's outline pane — this is the readiness
  // gate for a Calc document (its own ribbon tabs + formula bar + sheet
  // tabs, all rendered only once bbOffice.open() has resolved).
  await officeTab.getByTestId('calc-formula-bar').waitFor({ state: 'visible', timeout: 120_000 })
  await officeTab.getByTestId('calc-sheet-tabs').waitFor({ state: 'visible', timeout: 15_000 })
  await expect(officeTab.getByTestId('ribbon-tab-home')).toHaveAttribute('aria-current', 'true')

  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  const canvas = engineFrame.locator('#qtcanvas')
  await canvas.waitFor({ state: 'visible', timeout: 30_000 })

  // ---- OUR ref box navigates a real range via .uno:GoToCell ----
  await goToCell(officeTab, 'A1:A3')

  // ---- OUR status bar's real Sum/Average/Count of that selection ----
  // use-calc-selection-stats.ts's own fallback poll picks this up (GoToCell
  // via our ref box never moves DOM focus into the canvas, so the
  // pointerup/keyup fast path doesn't fire for it — see that file's header).
  // Deliberately NOT clicking the canvas here first: a click would move the
  // engine's OWN selection away from A1:A3 before Copy ever runs.
  await expect(officeTab.getByTestId('calc-status-sum')).toHaveText('Sum 60', { timeout: 10_000 })
  await expect(officeTab.getByTestId('calc-status-average')).toHaveText('Average 20')
  await expect(officeTab.getByTestId('calc-status-count')).toHaveText('Count 3')

  // ---- Edit a cell's value directly (Calc replaces on type, no select-all
  // needed — unlike Writer's text-cursor model). Deliberately no canvas
  // click here: goToCell's own onNavigated callback (calc-formula-bar.tsx)
  // already hands DOM focus back to the canvas without disturbing the
  // engine's A2 selection the way a fresh click would. ----
  await goToCell(officeTab, 'A2')
  await officeTab.keyboard.type('99', { delay: 30 })
  await officeTab.keyboard.press('Enter')
  await officeTab.waitForTimeout(300)

  await expect(officeTab.getByTestId('office-unsaved-dot')).toBeVisible()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/unsaved changes/)

  // ---- Bold via OUR ribbon (real bbOffice.onState round trip) ----
  await goToCell(officeTab, 'A2')
  const boldButton = officeTab.getByTestId('calc-ribbon-bold')
  await expect(boldButton).toHaveAttribute('aria-pressed', 'false')
  await boldButton.click()
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })

  // ---- Rename the sheet via OUR sheet tab (real .uno:RenameTable round trip) ----
  const activeTab = officeTab.getByTestId('calc-sheet-tab-active')
  await expect(activeTab).toHaveText('Sheet1')
  await activeTab.dblclick()
  const renameInput = officeTab.getByTestId('calc-sheet-tab-rename-input')
  await renameInput.fill('Budget')
  await renameInput.press('Enter')
  await expect(officeTab.getByTestId('calc-sheet-tab-active')).toHaveText('Budget')

  // ---- ⌘S save as a new version ----
  const statusBefore = await officeTab.getByTestId('office-status-saved').textContent()
  const saveButton = officeTab.getByTestId('office-save')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/saved as version \d+/, { timeout: 30_000 })
  const statusAfter = await officeTab.getByTestId('office-status-saved').textContent()
  expect(statusAfter).not.toBe(statusBefore)
  const versionMatch = statusAfter!.match(/saved as version (\d+)/)
  expect(versionMatch).not.toBeNull()
  expect(Number(versionMatch![1])).toBeGreaterThanOrEqual(2)

  await officeTab.close()

  // ---- Reopen from Drive — fresh tab, fresh engine boot, fresh decrypt —
  // every edit durably persisted server-side, not just in-session ----
  await page.reload()
  await dismissDevBanner(page)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 15_000 })
  await openPreview(page, base)
  const editButton2 = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton2.waitFor({ state: 'visible', timeout: 10_000 })
  const popup2Promise = context.waitForEvent('page')
  await editButton2.click()
  const officeTab2 = await popup2Promise
  trackEgress(officeTab2)
  await dismissDevBanner(officeTab2)
  await officeTab2.getByTestId('calc-formula-bar').waitFor({ state: 'visible', timeout: 120_000 })
  await officeTab2.getByTestId('calc-sheet-tabs').waitFor({ state: 'visible', timeout: 15_000 })
  const engineFrame2 = officeTab2.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame2.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })

  // The renamed sheet persisted into the saved .xlsx.
  await expect(officeTab2.getByTestId('calc-sheet-tab-active')).toHaveText('Budget')

  // The edited cell value persisted — read it back through the real engine
  // (GoToCell + Copy + clipboard, the exact mechanism this lane's status bar
  // already relies on, now used as this test's own verification instead of
  // guessing at the saved XML's sharedStrings/inlineStr shape).
  const frameHandle2 = officeTab2.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frameHandle2).toBeTruthy()
  await goToCell(officeTab2, 'A2')
  const a2Value: string = await frameHandle2!.evaluate(async () => {
    const bo = (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice
    await bo.dispatch('.uno:Copy')
    return navigator.clipboard.readText()
  })
  expect(a2Value.trim()).toBe('99')

  // The Bold formatting on that same cell also persisted.
  await expect(officeTab2.getByTestId('calc-ribbon-bold')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })

  await officeTab2.close()

  // ── Zero egress, across every tab this session opened ──
  expect(foreignRequests).toEqual([])
})
