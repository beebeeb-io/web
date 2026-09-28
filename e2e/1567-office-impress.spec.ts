/**
 * Task 1567 (Impress lane) — Impress editor e2e, against the REAL
 * LibreOffice-WASM engine (repos/office/evidence/artifacts/emscripten,
 * assembled into public/office/ by scripts/office-dev-assets.sh — run that
 * first, or this whole file skips itself; see beforeAll). Mirrors
 * e2e/1567-office-editor.spec.ts's structure (Writer lane) adapted for
 * Impress's own ribbon/filmstrip/Present surface.
 *
 * Covers: upload a real .pptx → preview → Edit (own top-level tab) → our
 * OWN Impress ribbon + filmstrip (New/Duplicate/Delete slide, each a real
 * `.uno:` dispatch — impress-commands.ts documents which ones were probed
 * against the real engine) → apply a Design-tab layout → Present opens a
 * real full-screen overlay and Exit restores the chrome → ⌘S saves as a new
 * version → reopen shows the slide-count change durably (verified by
 * reading the reopened file's own `ppt/slides/*.xml` part COUNT, not just a
 * screenshot) → zero egress to any non-self origin across the whole
 * session, including the nested engine iframe.
 *
 * Run with the private-port harness (task brief):
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:37851 \
 *     E2E_API_PORT=37851 E2E_VITE_PORT=37852 E2E_DB_NAME=beebeeb_web_e2e_impress \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-impress.spec.ts
 *
 * `VITE_STATUS_URL` is required, not optional (integration lane, task 1567):
 * without it the pre-existing `IncidentBanner` (src/app.tsx) fetches the
 * real `status.beebeeb.io` on mount and the zero-egress assertion below has
 * no special case for it — see e2e/1567-office-editor.spec.ts's own header
 * for the original writeup of this pre-existing, app-wide behavior.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { unzipSync } from 'fflate'
import { writePptxFixture } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay, escapeRe } from './helpers/thumb-fixtures'
import { OFFICE_SETTLE_BUDGET_MS, waitOfficeSettled } from './helpers/office-ready'

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

// Task 1585: 2 engine boot(s) at the ready helper's budget, plus the test's own work.
test.setTimeout(2 * OFFICE_SETTLE_BUDGET_MS + 120_000)

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

/** Counts `ppt/slides/slideN.xml` parts in a raw .pptx (zip) byte array —
 *  the durable, independent signal that a slide-count edit actually
 *  persisted through save+reopen (no LibreOffice re-open involved in the
 *  check itself, same principle as the Writer suite's readDocumentXml). */
function countSlideParts(bytes: Uint8Array): number {
  const files = unzipSync(bytes)
  return Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length
}

test('upload .pptx, manage slides via our filmstrip/ribbon, Present opens+exits, save as new version, reopen shows the slide-count change — zero egress', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await dismissDevBanner(page)

  const fixturePath = writePptxFixture(`office-1567-impress-${process.pid}.pptx`)
  const base = await uploadAndWait(page, fixturePath)
  await dismissDevBanner(page)

  // ── Egress capture (whole session) — same allowance as the Writer suite:
  // the app's own web + API origins are not "egress"; zero requests to any
  // OTHER host is the assertion. ──
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

  // Real engine boot + document open — our OWN filmstrip only renders once
  // docReady flips true (office-editor.tsx), so waiting on it is already a
  // real-engine-ready signal, same role office-outline-pane plays for Writer.
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab)
  await officeTab.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 15_000 })

  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })

  // Fix pass round 2 (task 1567, 2026-09-27, Impress zoom-to-fit) —
  // use-impress-fit-zoom.ts's own applyFit() must have actually run and
  // pinned a real fit percent (not the engine's literal BY_VALUE/100%
  // default, which is what the round-1 fix left in place — see that hook's
  // header comment for the real, pixel-diffed evidence this was a genuine
  // regression, not a guess). Asserting != 100 rather than a specific
  // number: the exact fit percent is a function of viewport size (this
  // fixture's own slide is ~74-96% depending on the runner's exact window),
  // and pinning a specific number here would make this test change every
  // time Playwright's default viewport does.
  await expect(officeTab.getByTestId('office-zoom-slider')).not.toHaveValue('100', { timeout: 15_000 })
  // The native Impress vertical scrollbar is a confirmed engine no-op to
  // hide via UNO (bb-office-worker.js's own item-2 comment) — cropped in
  // the web shell instead (office-engine-host.tsx's IMPRESS_SCROLLBAR_CROP_PX).
  // Asserting the crop element itself exists (not a screenshot pixel diff,
  // which the visual-gate spec already does) keeps this a fast, reliable
  // regression guard against someone removing `cropScrollbar` from the
  // Impress OfficeEngineFrame call by accident.
  await expect(officeTab.getByTestId('office-engine-scrollbar-crop')).toBeVisible()

  // Starts at 1 slide (the fixture's own single slide) — .uno:PageStatus
  // read back through our OWN status bar.
  await expect(officeTab.getByTestId('office-status-saved')).toBeVisible()
  const statusBar = officeTab.getByTestId('office-status-bar')
  await expect(statusBar).toContainText('Slide 1 of 1', { timeout: 15_000 })
  await expect(officeTab.getByTestId('impress-slide-1')).toBeVisible()
  await expect(officeTab.getByTestId('impress-slide-2')).toHaveCount(0)

  // New slide, via our OWN ribbon button (Home tab is the default active
  // tab) — a real .uno:InsertPage dispatch (impress-commands.ts's header).
  await officeTab.getByTestId('impress-ribbon-new-slide').click()
  await expect(statusBar).toContainText('Slide 2 of 2', { timeout: 15_000 })
  await expect(officeTab.getByTestId('impress-slide-2')).toBeVisible()

  // Duplicate slide, via the filmstrip's own button — a real
  // .uno:DuplicatePage dispatch.
  await officeTab.getByTestId('impress-slide-duplicate').click()
  await expect(statusBar).toContainText('Slide 3 of 3', { timeout: 15_000 })
  await expect(officeTab.getByTestId('impress-slide-3')).toBeVisible()

  // Delete slide, via the filmstrip's own button — a real .uno:DeletePage
  // dispatch. Count goes back to 2.
  await officeTab.getByTestId('impress-slide-delete').click()
  await expect(statusBar).toContainText('Slide 2 of 2', { timeout: 15_000 })
  await expect(officeTab.getByTestId('impress-slide-3')).toHaveCount(0)

  // Design tab — apply a layout via our OWN ribbon, a real
  // .uno:AssignLayout dispatch (impress-commands.ts's header: verified
  // dispatchable; no bridge readback exists to assert which layout applied,
  // so this only asserts the click completes without our own UI erroring).
  await officeTab.getByTestId('ribbon-tab-design').click()
  await officeTab.getByTestId('impress-layout-layout-title-content').click()
  await officeTab.waitForTimeout(300)
  await expect(officeTab.getByTestId('office-editor')).toBeVisible() // still alive, no crash

  // Present — our own full-screen chrome takeover (task brief: "no external
  // windows"). Back to Home tab first (Present lives there).
  await officeTab.getByTestId('ribbon-tab-home').click()
  await officeTab.getByTestId('impress-ribbon-present').click()
  await expect(officeTab.getByTestId('impress-present-controls')).toBeVisible({ timeout: 10_000 })
  await expect(officeTab.getByTestId('office-header')).toHaveCount(0)
  await expect(officeTab.getByTestId('office-ribbon')).toHaveCount(0)
  await expect(officeTab.getByTestId('impress-filmstrip')).toHaveCount(0)
  // No second page/window/tab was ever opened by Present — the whole
  // session's own page list is exactly what it was.
  expect(context.pages().filter((p) => !p.isClosed())).toHaveLength(2) // Drive tab + officeTab only

  await officeTab.getByTestId('impress-present-exit').click()
  await expect(officeTab.getByTestId('office-header')).toBeVisible()
  await expect(officeTab.getByTestId('office-ribbon')).toBeVisible()
  await expect(officeTab.getByTestId('impress-filmstrip')).toBeVisible()

  // ⌘S save as a new version.
  const saveButton = officeTab.getByTestId('office-save')
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  const statusBefore = await officeTab.getByTestId('office-status-saved').textContent()
  await saveButton.click()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/saved as version \d+/, { timeout: 30_000 })
  const statusAfter = await officeTab.getByTestId('office-status-saved').textContent()
  expect(statusAfter).not.toBe(statusBefore)
  const versionMatch = statusAfter!.match(/saved as version (\d+)/)
  expect(versionMatch).not.toBeNull()
  expect(Number(versionMatch![1])).toBeGreaterThanOrEqual(2)

  await officeTab.close()

  // Reopen from Drive — a fresh tab, fresh engine boot, fresh decrypt —
  // proves the slide-count edit is durably saved server-side.
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
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab2)
  await officeTab2.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 15_000 })
  const engineFrame2 = officeTab2.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame2.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
  // A freshly-reopened document naturally boots on its FIRST slide (found by
  // actually running this: reopening landed on "Slide 1 of 2", not "Slide 2
  // of 2" — a correct, expected engine behaviour this test's own earlier
  // assumption had wrong, not a bug) — the COUNT is the durable signal this
  // step actually cares about, not which slide the engine happens to open on.
  await expect(officeTab2.getByTestId('office-status-bar')).toContainText(/Slide \d+ of 2/, { timeout: 15_000 })
  await expect(officeTab2.getByTestId('impress-slide-2')).toBeVisible()

  // Read the REOPENED document's actual bytes back out through the real
  // engine (bbOffice.save() on the document that was just opened) and
  // confirm the slide count survived the round trip independently of our
  // own status-bar readout above.
  const frameHandle = officeTab2.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frameHandle).toBeTruthy()
  const savedBytesArray: number[] = await frameHandle!.evaluate(async () => {
    const bytes = await (window as unknown as { bbOffice: { save(): Promise<Uint8Array> } }).bbOffice.save()
    return Array.from(bytes)
  })
  expect(countSlideParts(new Uint8Array(savedBytesArray))).toBe(2)

  await officeTab2.close()

  // ── Zero egress, across BOTH office tabs + the main Drive tab ──
  expect(foreignRequests).toEqual([])
})
