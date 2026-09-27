/**
 * Task 1567 (web lane) — office editor e2e, against the REAL LibreOffice-WASM
 * engine (repos/office/evidence/artifacts/emscripten, assembled into
 * public/office/ by scripts/office-dev-assets.sh — run that first, or this
 * whole file skips itself; see beforeAll).
 *
 * Covers: upload a real .docx → preview → Edit (opens the office editor's
 * own top-level tab, /office/<fileId>, see office-editor-page.tsx's
 * header comment for why it's a separate tab, not an in-app overlay) → type
 * → Bold via our ribbon (ribbon button reflects pressed, driven by a REAL
 * bbOffice.onState subscription) → ⌘S → version count +1 → reopen shows the
 * edit (verified by reading the reopened document's own word/document.xml,
 * not just a screenshot) → zero egress to any non-self origin across the
 * whole session, including the nested engine iframe.
 *
 * Run with the private-port harness (task brief):
 *   VITE_FEATURE_OFFICE_EDITOR=true E2E_API_PORT=37831 E2E_VITE_PORT=37832 \
 *     E2E_DB_NAME=beebeeb_web_e2e_office ./e2e/scripts/web-e2e.sh e2e/1567-office-editor.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { unzipSync } from 'fflate'
import { writeDocxFixture } from './helpers/office-fixtures'
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

/** Reads word/document.xml out of a raw .docx (zip) byte array. */
function readDocumentXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const xml = files['word/document.xml']
  if (!xml) throw new Error('word/document.xml missing from saved docx')
  return new TextDecoder().decode(xml)
}

test('upload .docx, edit in the real engine, Bold via our ribbon, save as new version, reopen shows the edit — zero egress', async ({ page, context }) => {
  // Ship prep (task 1567, 2026-09-27): the office editor is now gated by
  // TWO flags — VITE_FEATURE_OFFICE_EDITOR (build-time, set by this spec's
  // own run line) AND a runtime Labs opt-in (office-labs.ts), default off
  // even on a build that carries the feature. Set here so this suite still
  // exercises the real feature, not the "not opted in" redirect — localStorage
  // is per-origin, so this covers the `/office/<fileId>` popup tab too (same
  // browser context, same origin).
  await page.addInitScript(() => localStorage.setItem('bb-office-labs', 'true'))
  await page.goto('/')
  await dismissDevBanner(page)

  const fixturePath = writeDocxFixture(`office-1567-${process.pid}.docx`, ['Original fixture paragraph.'])
  const base = await uploadAndWait(page, fixturePath)
  // uploadAndWait() reloads the page internally (steady-state drive) —
  // DevAuthGate's banner is local React state and reappears after every
  // navigation/reload (same gotcha documented in e2e/1563-text-editor.spec.ts's
  // dismissDevBanner), so it must be dismissed again here or it intercepts
  // the Edit button's click for the full test timeout.
  await dismissDevBanner(page)

  // ── Egress capture (whole session: main Drive tab + the office tab that's
  // about to open). Allowed origins: the app's own web origin AND the API
  // origin (the app talks to its own backend — that's not egress; "zero
  // egress" per docs/EGRESS.md means zero requests to any OTHER host,
  // notably never a network call from the office engine itself). ──
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
  // officeTab is a FRESH top-level navigation (window.open to /office/<fileId>,
  // not a client-side route change) — DevAuthGate's banner is local React
  // state and remounts on every fresh page load (same gotcha the dismissDevBanner
  // helper above documents for `page` after uploadAndWait's reload). Missing
  // this dismiss here left the banner (fixed, z-[9999]) covering the office
  // header's own Save button (found by actually running this spec: the click
  // on office-save retried for the full 180s test timeout against "<div
  // class=... z-[9999] ...> intercepts pointer events").
  await dismissDevBanner(officeTab)

  // Office editor's own top-level route mounted.
  await officeTab.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 15_000 })
  await officeTab.getByTestId('office-ribbon').waitFor({ state: 'visible', timeout: 15_000 })

  // Real engine boot + document open — generous timeout (cold WASM boot).
  await officeTab.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 120_000 })

  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  const canvas = engineFrame.locator('#qtcanvas')
  await canvas.waitFor({ state: 'visible', timeout: 30_000 })
  const frameHandle1 = officeTab.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frameHandle1).toBeTruthy()

  // Real keyboard typing into the LO-WASM canvas (not a dispatch shortcut) —
  // click to focus, select-all to replace the fixture's own paragraph, type.
  // Select-all goes through the REAL bbOffice.dispatch('.uno:SelectAll') and
  // is AWAITED, rather than simulating Ctrl+A — found by actually running
  // this spec repeatedly: a simulated Ctrl+A keypress returns to Playwright
  // immediately (a native key event, not a bridge call it can await), so
  // typing right after it raced the postMessage round trip to the pthread
  // that owns UNO/VCL and silently dropped a variable number of LEADING
  // characters (real runs saved " Beebeeb Office", "Lo Beebeeb Office",
  // "Ello Beebeeb Office" — never a middle/trailing drop, always the start).
  // A fixed settle delay after Ctrl+A reduced but did not eliminate this
  // (200ms still flaked once); waiting for `office-selection-toolbar` to
  // appear ALSO proved unreliable (Qt's own canvas input handling appears to
  // stop the pointerup event from ever reaching the host document's
  // listener, so the toolbar's POSITION half never arrives even though the
  // selection itself did — a real, separate finding, noted for whoever next
  // touches the floating-toolbar positioning). Awaiting the dispatch PROMISE
  // itself is the one signal that is actually synchronous with the engine
  // completing the select-all, because it is the exact same round trip
  // typing would otherwise race.
  await canvas.click()
  await frameHandle1!.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice.dispatch('.uno:SelectAll')
  })
  const typedText = 'Hello Beebeeb Office'
  await officeTab.keyboard.type(typedText, { delay: 30 })
  await officeTab.waitForTimeout(400) // let onModifiedChange/onSelectionChange settle

  // Bold via OUR ribbon button (not a raw dispatch call) — select what we
  // just typed first, so Bold has something to apply to.
  await officeTab.keyboard.press('ControlOrMeta+A')
  await officeTab.waitForTimeout(200)
  const boldButton = officeTab.getByTestId('ribbon-bold')
  await expect(boldButton).toHaveAttribute('aria-pressed', 'false')
  await boldButton.click()
  // The pressed state comes back through a REAL bbOffice.onState subscription,
  // not an optimistic local toggle — wait for it to actually arrive.
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })

  // Unsaved dot visible, status bar shows unsaved changes.
  await expect(officeTab.getByTestId('office-unsaved-dot')).toBeVisible()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/unsaved changes/)

  const statusBefore = await officeTab.getByTestId('office-status-saved').textContent()

  // ⌘S save as a new version.
  const saveButton = officeTab.getByTestId('office-save')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/saved as version \d+/, { timeout: 30_000 })
  const statusAfter = await officeTab.getByTestId('office-status-saved').textContent()
  expect(statusAfter).not.toBe(statusBefore)

  const versionMatch = statusAfter!.match(/saved as version (\d+)/)
  expect(versionMatch).not.toBeNull()
  const savedVersion = Number(versionMatch![1])
  expect(savedVersion).toBeGreaterThanOrEqual(2) // fixture uploaded as v1; this save is a NEW version

  await officeTab.close()

  // Reopen from Drive — a fresh tab, fresh engine boot, fresh decrypt —
  // proves the edit is durably saved server-side, not just in this session's
  // memory.
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
  await officeTab2.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 120_000 })
  const engineFrame2 = officeTab2.frameLocator('[data-testid="office-engine-frame"]')
  await engineFrame2.locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })

  // Read the REOPENED document's actual bytes back out through the real
  // engine (bbOffice.save() on the document that was just opened, not the
  // one we edited) and confirm our typed text survived the round trip.
  const frameHandle = officeTab2.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frameHandle).toBeTruthy()
  const savedBytesArray: number[] = await frameHandle!.evaluate(async () => {
    const bytes = await (window as unknown as { bbOffice: { save(): Promise<Uint8Array> } }).bbOffice.save()
    return Array.from(bytes)
  })
  const documentXml = readDocumentXml(new Uint8Array(savedBytesArray))
  expect(documentXml).toContain(typedText)

  await officeTab2.close()

  // ── Zero egress, across BOTH office tabs + the main Drive tab ──
  expect(foreignRequests).toEqual([])
})
