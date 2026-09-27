/**
 * Task 1563, phase 1 (web) — CodeMirror 6 text/markdown/code editor.
 *
 * Covers the task's phase-1 verification list end to end, against the real
 * stack (run via e2e/scripts/web-e2e.sh):
 *   1. .md opens as a formatted preview; Edit → change text → ⌘S → the
 *      version list shows a new version; reload → content persists.
 *   2. .ts shows syntax colours + line numbers in the editor.
 *   3. Find & replace works.
 *   4. Unsaved change + navigate away (close preview) → guard dialog.
 *   5. Concurrent edit (a second client saves a newer version first) → the
 *      conflict dialog offers Keep both / Save as new version / Show
 *      differences.
 *   6. A file over 2 MB opens read-only with a notice.
 *   7. The save request's chunk body is ciphertext — no plaintext marker.
 *
 * All tests share the "authenticated" project's dev auto-login account
 * (dev@beebeeb.dev — see e2e/global.setup.ts), so every fixture filename is
 * unique per test run (embeds process.pid) to avoid cross-test collisions
 * within that one shared vault.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import fs from 'fs'
import { writeText, uploadAndWait, openPreview, previewOverlay, escapeRe } from './helpers/thumb-fixtures'

const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? 'evidence-1563'
// web-e2e.sh exports this for its isolated backend (see other specs, e.g.
// e2e/1536-pat-create-step-up.spec.ts). page.request with a RELATIVE path
// resolves against the Vite origin, not the API — the SPA's own catch-all
// route answers with index.html (200, DOCTYPE html) for any unmatched path,
// which is not JSON.
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

function shot(page: Page, name: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  return page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png` })
}

/** DevAuthGate's fixed top banner (z-[9999], full width) sits directly over
 *  PreviewChrome's own top bar — including the Edit button — and intercepts
 *  its clicks. Its dismissal is local React state, so it reappears after
 *  every navigation/reload; call this after each `goto`/`reload`. */
async function dismissDevBanner(page: Page): Promise<void> {
  // `locator.isVisible()` does NOT auto-wait (a `timeout` option has no
  // effect on it) — it checks the CURRENT state only. DevAuthGate's banner
  // mounts asynchronously (after the dev auto-login fetch resolves), so an
  // immediate isVisible() check right after goto() often ran BEFORE the
  // banner existed, returned false, and left it to intercept a later click
  // (reproduced: a second browser context's Edit-button click retried
  // against the banner for the test's entire timeout budget). waitFor()
  // actually waits.
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session — nothing to dismiss.
  }
}

async function gotoAndSettle(page: Page): Promise<void> {
  await page.goto('/')
  await dismissDevBanner(page)
}

/** Click a file's row Edit button and wait for the editor to mount. */
async function enterEdit(page: Page) {
  await previewOverlay(page).getByTestId('preview-edit-button').click()
  const editor = previewOverlay(page).getByTestId('file-editor')
  await editor.waitFor({ state: 'visible', timeout: 10_000 })
  return editor
}

/** Replace the whole CodeMirror document with `text` (click into it, select
 *  all, type). Uses ControlOrMeta so it works whichever platform Playwright's
 *  Chromium reports itself as. */
async function replaceDoc(page: Page, editor: Locator, text: string) {
  const content = editor.locator('.cm-content')
  await content.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
}

/** Uploads a file WITHOUT the page reload `uploadAndWait` does (that reload
 *  would close any preview already open — needed for the prev/next test
 *  below, which keeps file A's preview open while uploading file B). The
 *  new file reaches the live `files` list via the app's own real-time sync
 *  (drive.tsx's `useWsEvent(['file.created', 'file.uploaded', …])` ->
 *  `fetchFiles()`), which this waits for explicitly — the row itself can't
 *  be waited on visually since the preview overlay covers it. */
async function uploadWithoutReload(page: Page, filePath: string): Promise<string> {
  const base = filePath.split('/').pop()!
  const uploadCompleted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/v1\/uploads\/[^/]+\/complete$/.test(r.url()) && r.ok(),
    { timeout: 30_000 },
  )
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  await uploadCompleted
  // Wait for the row to actually land in the app's `files` REACT STATE (via
  // the live 'file.created'/'file.uploaded' WS event -> fetchFiles(), no
  // reload) — not just for the refetch's network response to arrive.
  // `waitFor({state: 'visible'})` only checks the CSS box model (display/
  // visibility/size), not real occlusion, so this resolves correctly even
  // though the row sits behind the open preview overlay; a bare "the GET
  // /api/v1/files response arrived" wait raced React's own render/effect
  // cycle and pressed the next arrow key before `onPrev`/`onNext` had been
  // rebound with the new file included (task 1563 PR #103 review test —
  // first attempt at this fixed intermittently for exactly that reason).
  await page
    .getByRole('row', { name: new RegExp(escapeRe(base)) })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
  // The "Uploaded <name>" toast (top-right, same corner as the preview's
  // Edit/Download buttons) sits on top of them for its ~5s auto-dismiss
  // window — dismiss it explicitly rather than letting a subsequent click
  // in that corner hang waiting for an element it can't actually reach.
  const toastDismiss = page.getByRole('button', { name: 'Dismiss' }).last()
  await toastDismiss.click({ timeout: 3_000 }).catch(() => {})
  return base
}

test.describe('Task 1563 — text editor', () => {
  test('markdown: read renders formatted, edit + ⌘S creates a new version, reload persists it, save body is ciphertext', async ({ page }) => {
    test.setTimeout(120_000)
    const name = `1563-notes-${process.pid}.md`
    const marker = `EDITED-1563-${process.pid}`
    const path = writeText(name, '# Lisbon offsite\n\nThree days in Alfama.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)

    const overlay = previewOverlay(page)
    // Read mode: markdown rendered formatted (a real <h1>, not raw '# ' text).
    await expect(overlay.getByRole('heading', { name: 'Lisbon offsite', level: 1 })).toBeVisible({
      timeout: 15_000,
    })
    await expect(overlay).not.toContainText('# Lisbon offsite')
    await shot(page, '01-read-formatted')

    // Edit button visible (pencil, ⌘E hint) — enter edit mode.
    await expect(overlay.getByTestId('preview-edit-button')).toBeVisible()
    const editor = await enterEdit(page)
    // The unsaved dot lives in PreviewChrome's merged top bar now (task 1563
    // PR #103 review: "double header" — the editor no longer has its own
    // separate header row), not inside the file-editor testid subtree.
    // False right after opening, before any edit (task 1563 PR #103 review
    // item 11 — a screenshot showed it lit on a freshly-opened, untouched
    // file).
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeHidden()
    await shot(page, '02-edit-mode')

    await replaceDoc(page, editor, `# Lisbon offsite\n\nThree days in Alfama — ${marker}.\n`)
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    await expect(editor.getByTestId('editor-status-saved')).toContainText('unsaved changes')

    // Capture the chunk PUT that ⌘S triggers — its body must be ciphertext,
    // never the plaintext marker we just typed (encrypt-before-upload proof).
    const chunkPutBody = page.waitForRequest(
      (r) => r.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(r.url()).pathname),
      { timeout: 20_000 },
    )
    await page.keyboard.press('ControlOrMeta+S')
    const chunkReq = await chunkPutBody
    const body = chunkReq.postDataBuffer()
    expect(body, 'chunk PUT had no body').toBeTruthy()
    expect(body!.includes(Buffer.from(marker, 'utf-8'))).toBe(false)
    expect(body!.includes(Buffer.from('Lisbon offsite', 'utf-8'))).toBe(false)

    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeHidden()
    await shot(page, '03-saved-version-2')

    // Back to read mode via "Done" — portaled into PreviewChrome's merged
    // top bar now (task 1563 PR #103 review "double header"), so it's found
    // via `overlay`, not `editor` (it's no longer a DOM descendant of the
    // file-editor container).
    await overlay.getByTestId('editor-done').click()
    await expect(overlay.getByText(marker)).toBeVisible({ timeout: 10_000 })

    // Reload the whole page and reopen the same file: content persists.
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await openPreview(page, base)
    await expect(previewOverlay(page).getByText(marker)).toBeVisible({ timeout: 15_000 })
    await shot(page, '04-reload-persisted')

    // Dark theme evidence — reuses this file (already uploaded, known-good)
    // rather than a fresh upload, since a dedicated dark-mode-only test that
    // uploads its own fixtures proved flaky this late in a long run
    // (elevated load from everything before it). `beebeeb-theme` is read
    // once at ThemeProvider mount (theme-context.tsx) — setting it live
    // doesn't re-apply until a reload.
    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'dark'))
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await expect(page.locator('html.dark')).toHaveCount(1)
    await openPreview(page, base)
    await shot(page, '14-design-dark-read')
    const editorDark = await enterEdit(page)
    await expect(editorDark.locator('[class*="tok-"]').first()).toBeVisible({ timeout: 10_000 })
    await shot(page, '15-design-dark-edit-markdown')
    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'light'))
  })

  test('.ts file: the editor shows syntax colours and line numbers', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-code-${process.pid}.ts`
    const path = writeText(
      name,
      'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    )

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)

    await overlay.getByTestId('preview-edit-button').click()
    const editor = overlay.getByTestId('file-editor')
    await editor.waitFor({ state: 'visible' })

    // False right after opening, before any edit (task 1563 PR #103 review
    // item 11 — a screenshot showed the unsaved dot lit on a freshly-opened
    // .ts file with zero edits made).
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeHidden()

    // The editor's font is the app's own mono font, not the browser's
    // generic monospace fallback (task 1563 PR #103 review — CodeMirror's
    // own base theme set `font-family: monospace` directly on `.cm-scroller`,
    // which beat our `.cm-editor` ancestor rule regardless of stylesheet
    // order; see editor.css).
    // getComputedStyle quotes a multi-word font name (e.g. `"JetBrains
    // Mono", ui-monospace, …`) — strip a leading quote before the
    // startsWith check.
    const editorFont = await editor
      .locator('.cm-content')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(editorFont.replace(/^"/, '').startsWith('JetBrains Mono')).toBe(true)

    // Line numbers gutter. CodeMirror's gutter pool can hold transient
    // hidden/recycled elements during a re-layout (e.g. right as the async
    // TS language chunk loads and reconfigures the editor) — filter to
    // :visible so `.first()` can't land on one of those. 4 gutter rows: the
    // 3 code lines plus the trailing blank line from the fixture's final \n.
    const gutterCells = editor.locator('.cm-gutters .cm-lineNumbers .cm-gutterElement:visible')
    await expect(gutterCells.first()).toBeVisible({ timeout: 10_000 })
    await expect(gutterCells).toHaveCount(4)

    // At least one syntax-highlighted token (keyword/type/function class from
    // classHighlighter, styled by editor.css) — proves the TS grammar loaded
    // and applied, not just plain monospace text.
    const highlighted = editor.locator('.cm-content [class*="tok-"]')
    await expect(highlighted.first()).toBeVisible({ timeout: 10_000 })
    expect(await highlighted.count()).toBeGreaterThan(0)

    // Modern editor affordances (task 1563 design screen 02):
    // bracket-pair colourisation — the fixture's `{`/`}`/`(`/`)` get a
    // cm-bracket-N class, not just tok-punctuation.
    const coloredBrackets = editor.locator('.cm-content [class*="cm-bracket-"]')
    await expect(coloredBrackets.first()).toBeVisible({ timeout: 10_000 })
    // indentation guides (@replit/codemirror-indentation-markers) on the
    // fixture's indented `return` line.
    await expect(editor.locator('.cm-indent-markers, [class*="indent-marker"]').first()).toBeVisible({
      timeout: 10_000,
    })
    // minimap (@replit/codemirror-minimap, lazy-loaded) — gives it a moment
    // since it loads via a dynamic import() after the editor itself mounts.
    await expect(editor.locator('.cm-minimap-gutter')).toBeVisible({ timeout: 10_000 })

    // Selection-match highlighting (@codemirror/search's
    // highlightSelectionMatches): double-click the SECOND "number" (a
    // one-word occurrence, unambiguous to target) and confirm the OTHER
    // two occurrences get marked.
    await editor.locator('.cm-content').getByText('number', { exact: true }).nth(1).dblclick()
    await expect(editor.locator('.cm-selectionMatch')).toHaveCount(2, { timeout: 5_000 })

    await shot(page, '05-ts-syntax-colours')

    // Dark theme evidence — reuses this already-uploaded file rather than a
    // fresh upload (see the markdown test's dark-mode block above for why).
    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'dark'))
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await expect(page.locator('html.dark')).toHaveCount(1)
    await openPreview(page, base)
    const editorDark = await enterEdit(page)
    await expect(editorDark.locator('.cm-minimap-gutter')).toBeVisible({ timeout: 10_000 })
    await expect(editorDark.locator('[class*="tok-"]').first()).toBeVisible({ timeout: 10_000 })
    await shot(page, '16-design-dark-edit-code-minimap')
    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'light'))
  })

  test('find & replace works', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-findreplace-${process.pid}.txt`
    const path = writeText(name, 'alpha bravo alpha charlie alpha\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)

    await editor.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+F')
    const panel = editor.locator('.cm-search')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    await panel.locator('input[aria-label="Find"]').fill('alpha')
    await panel.locator('input[aria-label="Replace"]').fill('ALPHA')
    await panel.locator('button[name="replaceAll"]').click()

    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    // Read the doc back via the CodeMirror content text.
    const text = await editor.locator('.cm-content').innerText()
    expect(text).toContain('ALPHA bravo ALPHA charlie ALPHA')
    expect(text).not.toContain('alpha')
    await shot(page, '06-find-replace')
  })

  test('unsaved change + closing the preview shows a guard dialog', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-guard-${process.pid}.md`
    const path = writeText(name, 'Original content.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)

    await replaceDoc(page, editor, 'Changed but not saved.\n')
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()

    // Closing the whole preview while dirty → guard dialog, not a silent close.
    await overlay.getByTestId('preview-close-button').click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5_000 })
    await shot(page, '07-unsaved-guard')

    // Keep editing → dialog closes, preview + editor still open, edit intact.
    await guard.getByTestId('unsaved-keep-editing').click()
    await expect(guard).toBeHidden()
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()

    // Try again and discard this time → preview actually closes.
    await overlay.getByTestId('preview-close-button').click()
    await expect(guard).toBeVisible()
    await guard.getByTestId('unsaved-discard').click()
    await expect(overlay).toBeHidden({ timeout: 5_000 })
  })

  test('concurrent edit: a second client saves first → conflict dialog offers all three actions', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const name = `1563-conflict-${process.pid}.md`
    const path = writeText(name, 'Shared draft, version one.\n')

    // Client A uploads and opens the file, enters edit mode (captures
    // openedVersionNumber = 1) but does NOT save yet.
    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlayA = previewOverlay(page)
    const editorA = await enterEdit(page)
    await replaceDoc(page, editorA, 'Shared draft — A is still typing.\n')

    // Client B: a second browser context on the SAME dev account (dev
    // auto-login is deterministic — see e2e/global.setup.ts), opens the same
    // file fresh, edits, and saves first → server version becomes 2.
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await gotoAndSettle(pageB)
    await pageB.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await openPreview(pageB, base)
    const editorB = await enterEdit(pageB)
    await replaceDoc(pageB, editorB, 'Shared draft — B saved first.\n')
    await pageB.keyboard.press('ControlOrMeta+S')
    await expect(editorB.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await contextB.close()

    // Client A now saves its own (still version-1-based) edit → conflict.
    await page.keyboard.press('ControlOrMeta+S')
    const dialog = overlayA.getByTestId('editor-conflict-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await shot(page, '08-conflict-dialog')

    const keepBoth = dialog.getByRole('button', { name: 'Keep both' })
    const saveAsNew = dialog.getByRole('button', { name: /^Save as version \d+$/ })
    const showDiffs = dialog.getByRole('button', { name: 'Show differences' })
    await expect(keepBoth).toBeVisible()
    await expect(saveAsNew).toBeVisible()
    await expect(saveAsNew).toHaveText('Save as version 3')
    await expect(showDiffs).toBeVisible()

    // "Show differences" reveals the diff without uploading anything.
    await showDiffs.click()
    await expect(dialog.getByTestId('editor-conflict-diff')).toBeVisible({ timeout: 10_000 })
    await shot(page, '09-conflict-diff-shown')

    // Keep both → a sibling file is created; A's own file is untouched, and
    // A lands back in read mode showing the ORIGINAL content (not its own
    // discarded edit, not B's).
    await dialog.getByRole('button', { name: 'Keep both' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect(editorA).toBeHidden({ timeout: 15_000 })
    await expect(overlayA).toBeVisible()
    await expect(overlayA).toContainText('Shared draft, version one.')
    await expect(overlayA).not.toContainText('A is still typing')
    await expect(overlayA).not.toContainText('B saved first')
    await shot(page, '10-keep-both-back-to-read')

    // The Keep Both copy exists as its own row in the drive.
    await gotoAndSettle(page)
    await expect(page.getByRole('row', { name: /\(edited on web\)\.md/ })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('a file over 2 MB opens read-only with a notice, no Edit button', async ({ page }) => {
    test.setTimeout(90_000)
    const name = `1563-big-${process.pid}.txt`
    // 2 MB + a bit, all valid UTF-8 ASCII text.
    const line = 'A'.repeat(99) + '\n'
    const big = line.repeat(21_000) // 100 bytes * 21000 = 2,100,000 bytes
    const path = writeText(name, big)

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)

    const notice = overlay.getByTestId('editor-readonly-notice')
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await expect(notice).toContainText('larger than 2 MB')
    await expect(overlay.getByTestId('preview-edit-button')).toHaveCount(0)
    await shot(page, '10-readonly-too-large')
  })

  // ── PR #103 review threads ────────────────────────────────────────────

  test('prev/next resets the save-conflict baseline when switching files', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const nameA = `1563-nav-a-${process.pid}.md`
    const nameB = `1563-nav-b-${process.pid}.md`
    const pathA = writeText(nameA, 'File A, version one.\n')
    const pathB = writeText(nameB, 'File B, version one.\n')

    await gotoAndSettle(page)
    const baseA = await uploadAndWait(page, pathA)
    await dismissDevBanner(page)
    await openPreview(page, baseA)
    const overlay = previewOverlay(page)

    // Edit + save file A to version 2, then return to READ mode (still the
    // SAME open preview — no close/reopen). This is the stale baseline the
    // bug carries forward: currentVersionNumber becomes 2 here.
    let editor = await enterEdit(page)
    await replaceDoc(page, editor, 'File A, edited.\n')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await overlay.getByTestId('editor-done').click()
    await expect(editor).toBeHidden()

    // Upload file B (version 1) WITHOUT reloading — A's preview instance
    // must survive so the file.id switch below is a real prev/next swap on
    // the SAME React component, not a fresh mount (a fresh mount would
    // initialize currentVersionNumber correctly from scratch, defeating the
    // whole point of this test).
    await uploadWithoutReload(page, pathB)

    // Navigate from A to B via keyboard prev/next — NOT a re-open. The
    // server orders files newest-first, and B was created after A, so B is
    // "prev" from A; try both directions since this is the one implementation
    // detail this test doesn't want to hard-depend on.
    await page.keyboard.press('ArrowLeft')
    let onB = await overlay.getByText(nameB).first().isVisible().catch(() => false)
    if (!onB) {
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      onB = await overlay.getByText(nameB).first().isVisible().catch(() => false)
    }
    expect(onB, 'prev/next navigation did not reach file B').toBe(true)

    // Second client saves file B to version 2 BEFORE this session ever
    // touches it — a real, live conflict.
    const contextC = await browser.newContext()
    const pageC = await contextC.newPage()
    await gotoAndSettle(pageC)
    await pageC.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await openPreview(pageC, nameB)
    const editorC = await enterEdit(pageC)
    await replaceDoc(pageC, editorC, 'File B — saved by a second client.\n')
    await pageC.keyboard.press('ControlOrMeta+S')
    await expect(editorC.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await contextC.close()

    // Now edit + save file B in THIS session (still in read mode after the
    // prev/next nav above — enter edit fresh, on B). With the bug, the
    // conflict baseline is still 2 (stale, from file A) — the server's real
    // version 2 isn't seen as "ahead" of a baseline that's ALSO 2, so no
    // conflict dialog appears and the save silently proceeds. Fixed: the
    // baseline was reset to B's real opened version (1) when the file
    // switched, so 2 > 1 correctly triggers the conflict dialog.
    editor = await enterEdit(page)
    await replaceDoc(page, editor, 'File B — this session, unaware of the other save.\n')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(overlay.getByTestId('editor-conflict-dialog')).toBeVisible({ timeout: 15_000 })
    await shot(page, '11-nav-conflict-baseline-reset')
  })

  test('markdown split-preview links open in a new tab, never bypassing the unsaved-changes guard', async ({ page, context }) => {
    test.setTimeout(60_000)
    const name = `1563-link-${process.pid}.md`
    const path = writeText(name, '# Notes\n\nSee [the floor plan](https://example.com/floorplan) for details.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)

    // Dirty the draft, then turn on split preview so the link renders.
    await editor.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited.')
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    // The Split preview toggle is portaled into PreviewChrome's merged top
    // bar now (task 1563 PR #103 review "double header") — found via
    // `overlay`, not `editor`.
    await overlay.getByTestId('editor-split-toggle').click()
    const splitPreview = editor.getByTestId('editor-split-preview')
    await expect(splitPreview).toBeVisible()

    const link = splitPreview.getByRole('link', { name: 'the floor plan' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)

    // Clicking it must open a NEW TAB — the current tab (and its dirty
    // draft) never navigates away. With the bug (react-markdown's default
    // same-tab anchor), this click instead navigates page AWAY from the
    // app, so no 'page' event fires and the editor is torn down.
    const popupPromise = context.waitForEvent('page', { timeout: 8_000 }).catch(() => null)
    await link.click()
    const popup = await popupPromise
    expect(popup, 'link click did not open a new tab').not.toBeNull()
    if (popup) await popup.close()

    // The CURRENT tab is unaffected: still on the app, editor still open,
    // draft still dirty and intact — the guard was never even needed
    // because nothing tried to navigate this tab away.
    expect(new URL(page.url()).pathname).not.toBe('')
    await expect(editor).toBeVisible()
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    await expect(editor.locator('.cm-content')).toContainText('Edited.')
    await shot(page, '12-split-preview-link-new-tab')
  })

  test('discarding changes cancels an in-flight save — it can never persist', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-abort-${process.pid}.md`
    const path = writeText(name, 'Original content.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)

    // Delay the write-ahead `GET .../versions` call (handleSave's FIRST
    // await, before the upload machinery even starts) rather than the chunk
    // PUT itself. This is deliberate, not incidental: `page.route()` PAUSES
    // a request at the CDP layer before it ever reaches the real network —
    // it does NOT observe the page's own AbortController the way a request
    // that's genuinely in flight over a real (slow) connection would.
    // Empirically (this test, first attempt): delaying the CHUNK PUT via
    // page.route() and discarding mid-delay still let the PUT complete
    // (`chunkPutSucceeded` was true both with and without the fix) — a
    // Playwright/CDP interception artifact, not something the app's abort
    // wiring can affect from the page side. Delaying the EARLIER
    // `listVersions()` call instead avoids that artifact entirely: it gives
    // a real window to discard BEFORE any upload request would even be
    // constructed, so proving "no chunk PUT is ever dispatched" is a clean,
    // reliable, Playwright-native assertion — and still exercises the exact
    // code path this thread is about (`inFlightUploadRef` must already hold
    // the controller by the time this discard lands, or `abortSave()` is a
    // no-op — see file-editor.tsx `handleSave`'s comment).
    await page.route('**/versions', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000))
      await route.continue().catch(() => {})
    })
    let chunkPutStarted = false
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(req.url()).pathname)) {
        chunkPutStarted = true
      }
    })

    await replaceDoc(page, editor, 'This edit must NEVER be saved.\n')
    await page.keyboard.press('ControlOrMeta+S')
    // The write-ahead versions check is now in flight (delayed by the route
    // above) — `dirty` is still true, so closing the preview now hits the
    // unsaved-changes guard exactly as the review thread describes.
    await overlay.getByTestId('preview-close-button').click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5_000 })
    await guard.getByTestId('unsaved-discard').click()
    await expect(overlay).toBeHidden({ timeout: 5_000 })

    // Past the artificial delay: with the bug (no AbortSignal registered
    // before this await), handleSave's `if (controller.signal.aborted)
    // return` guard doesn't exist yet, so the save proceeds straight into
    // performUpload() and dispatches a real chunk PUT a moment later. Fixed:
    // the controller was already registered and aborted before `listVersions`
    // even resolved, so the code returns immediately afterward and no chunk
    // PUT is ever constructed.
    await page.waitForTimeout(3_500)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    expect(chunkPutStarted, "a chunk PUT was dispatched for a discarded edit").toBe(false)

    // NOTE (server-side gap found while wiring this fix, out of scope for
    // this web-only PR): if a discard instead lands WHILE a chunk PUT is
    // genuinely in flight over the real network (not the write-ahead check —
    // this test's window), aborting it after `initUpload` has already
    // committed leaves the file's `is_uploading` flag stuck TRUE server-side.
    // There is no cancel/abandon endpoint (repos/server/beebeeb-api/src/
    // routes/uploads.rs has init/chunks/complete only), so a read of the file
    // in that window 409s ("upload is still in progress", download_chunk()
    // in files.rs) until a LATER successful save on the same file id resumes
    // and completes that same session. See the task file's Notes.
  })

  // task 1571 closes the exact gap the note above describes: the server now
  // has POST /api/v1/files/:id/upload/abandon (previous version restored
  // untouched, or the row deleted if there was none), plus a TTL sweep as a
  // backstop. This test wires the OTHER half — the client actually calling
  // it — and proves the end-to-end result: a discard while a chunk PUT is
  // GENUINELY in flight (initUpload already committed server-side, unlike
  // the test above) no longer wedges the file; a later save on the same file
  // succeeds, and the version the discarded draft would have replaced comes
  // back byte-for-byte intact.
  test('discarding while a chunk PUT is genuinely mid-flight abandons server-side — a later save succeeds and the previous version survives intact (task 1571)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const name = `1571-abandon-${process.pid}.md`
    const original = 'Original content that must survive the discard.\n'
    const discardedDraft = 'This draft gets discarded mid-upload and must NEVER be saved.\n'
    const realSecondSave = 'This is the real second save, made after the discard.\n'
    const path = writeText(name, original)

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    let overlay = previewOverlay(page)
    let editor = await enterEdit(page)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    // Pause every chunk PUT before it's sent (Fetch-domain interception, CDP)
    // and never resume it — by the time ANY chunk PUT is observed at all,
    // `performUpload` has already `await`ed a successful `initUpload`
    // (encrypted-upload.ts calls init, THEN loops chunk PUTs — see that
    // file), so the server has genuinely already set `is_uploading = TRUE`
    // for this real file_id. This is the "genuinely in flight" case the note
    // on the test above says is out of that (web-only) PR's scope.
    await page.route('**/chunks/*', async () => {
      await new Promise(() => {}) // never continue() — released by unrouteAll below
    })
    const chunkPutSeen = page.waitForRequest(
      (r) => r.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    )

    await replaceDoc(page, editor, discardedDraft)
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+S')
    await chunkPutSeen // initUpload has committed server-side; is_uploading is TRUE for real

    // Discard while that chunk PUT is still stuck. abortSave() (file-editor.tsx)
    // both aborts the client fetch AND fires the new abandon call — assert
    // the app actually issues it, and that the server answers 200 (a 404/500
    // here would mean the wiring is calling the wrong file id or is broken).
    const abandonCall = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/upload\/abandon$/.test(new URL(r.url()).pathname),
      { timeout: 10_000 },
    )
    await overlay.getByTestId('preview-close-button').click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5_000 })
    await guard.getByTestId('unsaved-discard').click()
    await expect(overlay).toBeHidden({ timeout: 5_000 })
    const abandonResp = await abandonCall
    expect(abandonResp.status(), 'the abandon call must succeed').toBe(200)
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    // Reopen: the file must NOT be wedged (no 409, no permanent "uploading"
    // state) — it opens showing the untouched previous version, not the
    // discarded draft.
    await openPreview(page, base)
    overlay = previewOverlay(page)
    await expect(overlay.getByText(original.trim())).toBeVisible({ timeout: 10_000 })
    await expect(overlay).not.toContainText(discardedDraft.trim())
    editor = await enterEdit(page)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    // The actual bug report (task 1563/1571): a real save on this SAME file
    // must succeed now, not 409 forever.
    await replaceDoc(page, editor, realSecondSave)
    await page.keyboard.press('ControlOrMeta+S')
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await shot(page, '1571-abandon-then-resave')

    // Server-truth check on the ACTUAL persisted version count — via the
    // real API (GET .../versions, the same endpoint handleSave's own
    // write-ahead check uses), not the editor's optimistic UI text. Reuses
    // the file id straight out of the abandon call's own URL rather than a
    // separate lookup. Deliberately NOT re-asserted from `editor-status-saved`
    // after a reload below: re-opening a file via the Drive LISTING seeds
    // `openedVersionNumber` from `file.version_number` on the listing's
    // `DriveFile` objects, and `GET /api/v1/files` does not select that
    // column (only `GET .../versions` and a save's own direct response do)
    // — a pre-existing, unrelated display gap, not something task 1571
    // touches. `page.request` shares this page's auth automatically.
    const fileId = new URL(abandonResp.url()).pathname.match(/\/files\/([^/]+)\/upload\/abandon$/)![1]
    const versionsResp = await page.request.get(`${API_URL}/api/v1/files/${fileId}/versions`)
    expect(versionsResp.ok(), 'versions lookup must succeed').toBe(true)
    const versionsBody = await versionsResp.json()
    expect(
      versionsBody.current_version,
      'the real second save must be version 2 server-side — the abandoned draft must not have consumed a version slot',
    ).toBe(2)

    // Reload + reopen: the FINAL content is the real second save, not the
    // discarded draft and not a stale v1.
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await openPreview(page, base)
    overlay = previewOverlay(page)
    await expect(overlay.getByText(realSecondSave.trim())).toBeVisible({ timeout: 15_000 })
    await expect(overlay).not.toContainText(discardedDraft.trim())
  })

  // Codex P1 on web PR #106 (task 1571 follow-up): `encryptedUpload` passed
  // the save's AbortSignal to `withNetworkRetry` but never to `initUpload`
  // itself, so aborting the client's controller did nothing to the actual
  // `/api/v1/uploads/init` fetch — and the old `abortInFlightSave` fired
  // `abandonUpload` immediately (fire-and-forget) instead of waiting for
  // that fetch to settle. Sequence this closes: discard fires while init is
  // still pending → abandon sees `is_uploading = false` (nothing to
  // abandon, no-op) → init's response THEN lands and sets
  // `is_uploading = true` — wedging the file exactly like task 1571 was
  // meant to fix, just one step earlier in the request chain than that
  // task's own "genuinely mid-flight CHUNK PUT" test above covers.
  //
  // This test delays `/api/v1/uploads/init`'s response by a fixed window
  // (same `setTimeout` + `route.continue()` pattern as the "discarding
  // changes cancels an in-flight save" test's `**/versions` delay above —
  // NOT an indefinite hold released manually: this file's own prior test
  // already found that a CDP-paused request does not observe the page's
  // AbortController the way a genuinely in-flight one does, so a manual
  // "release after discard" step doesn't reliably model "init resolving
  // after the discard" — a bounded delay that always keeps running
  // regardless of the page's own abort does) and fires Discard while that
  // response is still outstanding — literally "init resolving after the
  // discard" once the delay elapses. The abandon watcher is armed BEFORE
  // Discard is clicked (not after), since with the fix the abort settles
  // the save's own promise, and therefore fires `abandonUpload`, right
  // away — proving the SEQUENCING (settle-then-abandon), not a specific
  // wall-clock gap. What this test actually falsifies is the end state:
  // the abandon call lands, the previous version survives untouched, and a
  // real subsequent save on the same file lands as version 2 — never stuck
  // behind a phantom in-flight upload from the raced init.
  test('discarding while /api/v1/uploads/init is still pending does not wedge the file when init resolves after the discard (web PR #106, Codex P1)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const name = `1571-init-race-${process.pid}.md`
    const original = 'Original content that must survive the init race.\n'
    const discardedDraft = 'This draft races /uploads/init and must NEVER be saved.\n'
    const realSecondSave = 'This is the real second save, made after the init race.\n'
    const path = writeText(name, original)

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    let overlay = previewOverlay(page)
    let editor = await enterEdit(page)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    // Delay init's response by 3s, then let it through for real — the
    // request keeps running server-side on its own schedule regardless of
    // what the page does with its own AbortController meanwhile.
    await page.route('**/api/v1/uploads/init', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000))
      await route.continue().catch(() => {})
    })
    const initSeen = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/uploads/init',
      { timeout: 15_000 },
    )
    // Armed BEFORE Discard: the fix calls abandon as soon as this save's
    // own promise settles, which (once the AbortSignal is wired all the
    // way into `fetch`, this PR's actual fix) can happen essentially as
    // soon as the client aborts — well before init's artificial 3s delay
    // elapses. A watcher armed only after that delay would miss it
    // entirely (the exact failure mode this test's first draft hit).
    const abandonCall = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/upload\/abandon$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    )

    await replaceDoc(page, editor, discardedDraft)
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+S')
    await initSeen // init has been dispatched; its response is still 3s out

    await overlay.getByTestId('preview-close-button').click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5_000 })
    await guard.getByTestId('unsaved-discard').click()
    await expect(overlay).toBeHidden({ timeout: 5_000 })

    const abandonResp = await abandonCall
    expect(abandonResp.status(), 'the abandon call must succeed').toBe(200)
    // Let init's own 3s delay actually elapse and complete server-side
    // (whatever it does at this point — the point of this test is that it
    // no longer matters) before moving on, so it isn't still outstanding
    // when the reopen below issues its own requests.
    await page.waitForTimeout(3_500)
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    // Reopen: not wedged — shows the untouched previous version, never the
    // discarded draft.
    await openPreview(page, base)
    overlay = previewOverlay(page)
    await expect(overlay.getByText(original.trim())).toBeVisible({ timeout: 10_000 })
    await expect(overlay).not.toContainText(discardedDraft.trim())
    editor = await enterEdit(page)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    // The actual regression: a real save on this SAME file must succeed
    // now, not hang/409 behind a phantom `is_uploading = true` left by the
    // raced init.
    await replaceDoc(page, editor, realSecondSave)
    await page.keyboard.press('ControlOrMeta+S')
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await shot(page, '1571-init-race-then-resave')

    // Server-truth check, same pattern as the mid-flight-chunk test above.
    const fileId = new URL(abandonResp.url()).pathname.match(/\/files\/([^/]+)\/upload\/abandon$/)![1]
    const versionsResp = await page.request.get(`${API_URL}/api/v1/files/${fileId}/versions`)
    expect(versionsResp.ok(), 'versions lookup must succeed').toBe(true)
    const versionsBody = await versionsResp.json()
    expect(
      versionsBody.current_version,
      'the real second save must be version 2 server-side — the raced init must not have consumed a version slot',
    ).toBe(2)

    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await openPreview(page, base)
    overlay = previewOverlay(page)
    await expect(overlay.getByText(realSecondSave.trim())).toBeVisible({ timeout: 15_000 })
    await expect(overlay).not.toContainText(discardedDraft.trim())
  })

  test('conflict dialog: action buttons disable immediately while a resolution upload is in flight', async ({ page, browser }) => {
    test.setTimeout(90_000)
    const name = `1563-conflict-guard-${process.pid}.md`
    const path = writeText(name, 'Shared draft, version one.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)
    await replaceDoc(page, editor, 'This session is still typing.\n')

    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await gotoAndSettle(pageB)
    await pageB.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await openPreview(pageB, base)
    const editorB = await enterEdit(pageB)
    await replaceDoc(pageB, editorB, 'A second client saved first.\n')
    await pageB.keyboard.press('ControlOrMeta+S')
    await expect(editorB.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    await contextB.close()

    await page.keyboard.press('ControlOrMeta+S')
    const dialog = overlay.getByTestId('editor-conflict-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    // Slow the resolution upload so the disabled window is observable.
    await page.route('**/chunks/*', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000))
      await route.continue().catch(() => {})
    })

    const keepBoth = dialog.getByRole('button', { name: 'Keep both' })
    const saveAsNew = dialog.getByRole('button', { name: /^Save as version \d+$/ })
    await keepBoth.click()
    // Immediately (before the delayed upload resolves) — every action
    // button, including the one NOT clicked, must already be disabled so a
    // second click (or a slow double-click) can't launch a second upload.
    await expect(keepBoth).toBeDisabled({ timeout: 2_000 })
    await expect(saveAsNew).toBeDisabled()

    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    // Exactly ONE sibling file was created for THIS test's own base name —
    // not two (a double-submit would create a second one). Scoped to this
    // test's own pid-suffixed name, not the bare "(edited on web).md"
    // pattern: the vault is shared and persists across runs against the
    // same isolated DB (task instructions: reuse the same DB), so OTHER
    // tests'/runs' own "(edited on web)" siblings already accumulate there.
    await gotoAndSettle(page)
    const siblingName = name.replace(/\.md$/, ' (edited on web).md')
    await expect(page.getByRole('row', { name: new RegExp(escapeRe(siblingName)) })).toHaveCount(1, {
      timeout: 15_000,
    })
  })

  test('⌘S is ignored when the document is clean — no redundant version, no network request', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-clean-save-${process.pid}.md`
    const path = writeText(name, 'Nothing to save here.\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const overlay = previewOverlay(page)
    const editor = await enterEdit(page)
    await expect(overlay.getByTestId('editor-dirty-dot')).toBeHidden()
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    let chunkPutFired = false
    page.on('request', (r) => {
      if (r.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(r.url()).pathname)) chunkPutFired = true
    })

    // Focus the editor (so CodeMirror's own Mod-s keymap is in play, not
    // just the document-level fallback) and press ⌘S on a CLEAN document.
    await editor.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+S')
    await page.waitForTimeout(1_500)
    expect(chunkPutFired, 'a chunk PUT fired for a clean-document ⌘S').toBe(false)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('version 1')

    // Now actually edit + save (version 2), then press ⌘S AGAIN right after
    // — clean once more, must still be a no-op.
    await replaceDoc(page, editor, 'Now there is something to save.\n')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', {
      timeout: 20_000,
    })
    chunkPutFired = false
    await page.keyboard.press('ControlOrMeta+S')
    await page.waitForTimeout(1_500)
    expect(chunkPutFired, 'a chunk PUT fired for a clean-document ⌘S right after a save').toBe(false)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2')
  })
})
