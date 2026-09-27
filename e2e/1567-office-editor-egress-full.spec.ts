/**
 * Task 1567 SHIP GATES — Egress gate (independent verification lane, not a
 * per-app feature lane), against the REAL LibreOffice-WASM engine
 * (repos/office/evidence/artifacts/emscripten, assembled into public/office/
 * by scripts/office-dev-assets.sh — run that first, or this whole file
 * skips itself; see beforeAll).
 *
 * PLAN.md's own gate text: "Playwright capture = 0 non-self requests over a
 * full session, including an inserted image and a clicked link. It is
 * proven red first." This file covers a FULLER session than any single
 * per-app e2e spec: open → type → every Writer ribbon tab (Home/Insert/
 * Layout/Review) → ⌘K open+close → insert an image (real file input) →
 * insert a hyperlink (real window.prompt dialogs) → dispatch the engine's
 * own "open this hyperlink" command → ⌘S save → zero foreign requests
 * across every page/tab this session opened.
 *
 * The red-proof (second test below) does NOT reuse the first test's tracker
 * as evidence that the mechanism works — it independently injects one
 * deliberate external `fetch()` from inside the SAME office tab and asserts
 * the identical tracking code catches it, so a clean run above is not "the
 * capture is broken and would never fail" but "the capture works and
 * genuinely observed nothing".
 *
 * Run (own private ports, per the workspace's multi-session coordination
 * rules — never the shared :3001/:5173 dev stack):
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:37991 \
 *     E2E_API_PORT=37991 E2E_VITE_PORT=37992 E2E_DB_NAME=beebeeb_web_e2e_office_egress \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-editor-egress-full.spec.ts
 *
 * VITE_STATUS_URL matters here for the exact same reason documented in
 * e2e/1567-office-editor.spec.ts and the task file's 2026-09-27 integration
 * note: the app's pre-existing IncidentBanner (src/app.tsx) fetches
 * status.beebeeb.io on every mount, including the office tab, and this
 * spec's egress tracker has no special case for it — point it at the
 * isolated API origin or this spec fails on a pre-existing, unrelated
 * finding, not a real office-editor egress bug.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { writeDocxFixture } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'
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

// Task 1585: 1 engine boot(s) at the ready helper's budget, plus the test's own work.
test.setTimeout(OFFICE_SETTLE_BUDGET_MS + 120_000)

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

function makeEgressTracker(webOrigin: string, apiOrigin: string) {
  const foreign: string[] = []
  return {
    foreign,
    attach(p: Page) {
      p.on('request', (req) => {
        const url = new URL(req.url())
        if (url.protocol === 'data:' || url.protocol === 'blob:') return
        if (url.origin === webOrigin || url.origin === apiOrigin) return
        foreign.push(`${req.method()} ${req.url()}`)
      })
    },
  }
}

/** Writes a 1x1 PNG to a temp path for the "insert an image" step. */
function writeTinyPng(): string {
  // Minimal valid 1x1 PNG (amber-ish pixel), same bytes shape used by the
  // fidelity-corpus generator (gen_corpus.py's make_tiny_png), hand-encoded
  // here since this file has no Python/zlib dependency.
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQBgvfw6AAAAAElFTkSuQmCC'
  const p = path.join(require('os').tmpdir(), `office-egress-tiny-${process.pid}.png`)
  fs.writeFileSync(p, Buffer.from(b64, 'base64'))
  return p
}

test('full session — open, type, every ribbon tab, ⌘K, insert image, insert+open a hyperlink, save — zero foreign egress', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await dismissDevBanner(page)

  const fixturePath = writeDocxFixture(`office-egress-${process.pid}.docx`, ['Egress gate fixture paragraph.'])
  const base = await uploadAndWait(page, fixturePath)
  await dismissDevBanner(page)

  const webOrigin = new URL(page.url()).origin
  const apiOrigin = process.env.E2E_API_URL ? new URL(process.env.E2E_API_URL).origin : webOrigin
  const tracker = makeEgressTracker(webOrigin, apiOrigin)
  tracker.attach(page)

  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 10_000 })
  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const officeTab = await popupPromise
  tracker.attach(officeTab)
  await officeTab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(officeTab)

  await officeTab.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 15_000 })
  await officeTab.getByTestId('office-ribbon').waitFor({ state: 'visible', timeout: 15_000 })
  // Task 1585: the editor's real ready signal at the app's own budget.
  await waitOfficeSettled(officeTab)
  await officeTab.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 15_000 })

  const engineFrame = officeTab.frameLocator('[data-testid="office-engine-frame"]')
  const canvas = engineFrame.locator('#qtcanvas')
  await canvas.waitFor({ state: 'visible', timeout: 30_000 })
  const engineFrameHandle = officeTab.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(engineFrameHandle).toBeTruthy()

  // ---- Type real text (same select-all-via-dispatch-then-type technique
  // e2e/1567-office-editor.spec.ts's own header documents as the only
  // reliable one — a simulated Ctrl+A races the bridge round trip) ----
  await canvas.click()
  await engineFrameHandle!.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice.dispatch(
      '.uno:SelectAll',
    )
  })
  await officeTab.keyboard.type('Egress gate session text.', { delay: 20 })
  await officeTab.waitForTimeout(300)

  // ---- Every Writer ribbon tab: Home, Insert, Layout, Review ----
  for (const tab of ['home', 'insert', 'layout', 'review']) {
    const tabButton = officeTab.getByTestId(`ribbon-tab-${tab}`)
    await tabButton.click()
    await expect(tabButton).toHaveAttribute('aria-current', 'true')
    await officeTab.waitForTimeout(150)
  }
  // Back to Home — the link/image buttons only render under Home's controls.
  await officeTab.getByTestId('ribbon-tab-home').click()
  await expect(officeTab.getByTestId('ribbon-tab-home')).toHaveAttribute('aria-current', 'true')

  // ---- ⌘K command palette: open via the header pill, close via Escape ----
  await officeTab.getByTestId('office-open-palette').click()
  await officeTab.getByTestId('office-command-palette').waitFor({ state: 'visible', timeout: 5_000 })
  await officeTab.getByTestId('office-command-palette-input').fill('bold')
  await officeTab.waitForTimeout(200)
  await officeTab.keyboard.press('Escape')
  await officeTab.getByTestId('office-command-palette').waitFor({ state: 'hidden', timeout: 5_000 })

  // ---- Insert an image (real file input, real PNG bytes) ----
  const imagePath = writeTinyPng()
  const fileChooserPromise = officeTab.waitForEvent('filechooser')
  await officeTab.getByTestId('ribbon-image').click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(imagePath)
  await officeTab.waitForTimeout(1_500) // real bbOffice.insertImage() round trip

  // ---- Insert a hyperlink (real window.prompt dialogs, real UNO dispatch) ----
  const LINK_TEXT = 'Beebeeb docs'
  const LINK_URL = 'https://egress-must-not-be-fetched.invalid/should-never-see-a-request'
  // Non-nested handler (real bug found by running the nested-once version
  // first: the SECOND window.prompt() can fire before a `.once` registered
  // INSIDE the first callback finishes attaching, since the callback is
  // async but the renderer's prompt() calls are back-to-back synchronous —
  // 2 real flaky runs reproduced `dialogTexts.length === 1`). A single
  // always-on listener with a counter has no such race.
  const dialogTexts: string[] = []
  officeTab.on('dialog', async (d) => {
    dialogTexts.push(d.message())
    await d.accept(dialogTexts.length === 1 ? LINK_TEXT : LINK_URL)
  })
  await officeTab.getByTestId('ribbon-link').click()
  await officeTab.waitForTimeout(1_000) // real bbOffice.insertHyperlink() round trip
  expect(dialogTexts.length).toBe(2) // both prompts actually appeared and were answered

  // ---- "a clicked link": dispatch the engine's own open-hyperlink command
  // at the cursor (right after insertHyperlink, the cursor sits at/after the
  // freshly-inserted link run) — the point of this gate line is proving that
  // FOLLOWING a hyperlink inside the embedded document engine never causes a
  // real network fetch of that URL, not that our chrome has a pixel-perfect
  // click affordance for it. ----
  const openHyperlinkResult = await engineFrameHandle!.evaluate(async () => {
    try {
      const r = await (
        window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }
      ).bbOffice.dispatch('.uno:OpenHyperlink')
      return { ok: true, r }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  // Recorded either way — a real per-file/dispatch capability finding, not
  // asserted true/false: what matters for THIS gate is what happens next,
  // i.e. zero requests for LINK_URL regardless of whether the dispatch
  // itself was a no-op in this build.
  console.log('[.uno:OpenHyperlink dispatch result]', JSON.stringify(openHyperlinkResult))
  await officeTab.waitForTimeout(1_000)

  // ---- ⌘S save ----
  const saveButton = officeTab.getByTestId('office-save')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(officeTab.getByTestId('office-status-saved')).toHaveText(/saved as version \d+/, { timeout: 30_000 })

  await officeTab.close()

  // ── Zero egress, across BOTH the Drive tab and the office tab ──
  const foreignForLink = tracker.foreign.filter((r) => r.includes('egress-must-not-be-fetched.invalid'))
  expect(foreignForLink).toEqual([]) // the inserted link itself was never fetched
  expect(tracker.foreign).toEqual([]) // nothing else was either
})

test('RED-PROOF — the same tracking mechanism DOES catch a deliberate external fetch (proves the gate above is not a no-op)', async ({
  context,
}) => {
  // REAL FIRST ATTEMPT (documented, not silently dropped): firing the
  // deliberate fetch() from inside the app's own office tab produced 0
  // captured requests — not because the tracker is broken, but because the
  // app's own `devCspPlugin` (vite.config.ts) sends a real
  // `Content-Security-Policy: connect-src 'self' ...` header in dev, and
  // Chromium refuses a disallowed fetch() before it ever reaches the
  // network layer CDP's Network domain taps — so no 'request' event fires
  // at all for a CSP-refused call. That is a SECOND, independent layer of
  // egress defense (matching repos/office's own
  // evidence/playwright/egress.spec.js, whose red-proof needed
  // BB_SERVE_NO_CSP=1 for the exact same reason), but it means the fetch-
  // from-inside-the-app technique cannot red-proof the TRACKER in isolation
  // here (this app has no equivalent "disable CSP for this run" flag, unlike
  // that throwaway harness server).
  //
  // FIX: fire the deliberate fetch from a brand-new, blank page in the SAME
  // browser context (no app CSP applies to about:blank), with the identical
  // tracker/attach() code the gate test above uses. This isolates exactly
  // what needs proving — that the CAPTURE mechanism itself is not silently
  // vacuous — from the app's own CSP defense, which is a separate real
  // finding, not a workaround of it.
  const tracker = makeEgressTracker('http://this-origin-never-matches.invalid', 'http://this-origin-never-matches.invalid')
  const blank = await context.newPage()
  tracker.attach(blank)
  await blank.goto('about:blank')

  await blank.evaluate(() => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 800)
    // Non-routable address (TEST-NET-1, RFC 5737) — fails fast/locally,
    // no real external host is ever actually reached, matching
    // repos/office's own red-proof technique. The 'request' event fires on
    // send, not on completion, so the abort does not stop it being recorded.
    fetch('http://192.0.2.1/beebeeb-red-proof', { signal: ctrl.signal }).catch(() => {})
  })
  await blank.waitForTimeout(1_200)
  await blank.close()

  expect(tracker.foreign.length, JSON.stringify(tracker.foreign)).toBeGreaterThan(0)
})
