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
import { writeText, uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? 'evidence-1563'

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
    await shot(page, '02-edit-mode')

    await replaceDoc(page, editor, `# Lisbon offsite\n\nThree days in Alfama — ${marker}.\n`)
    await expect(editor.getByTestId('editor-dirty-dot')).toBeVisible()
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
    await expect(editor.getByTestId('editor-dirty-dot')).toBeHidden()
    await shot(page, '03-saved-version-2')

    // Back to read mode → shows the just-saved content without a reload.
    await editor.getByTestId('editor-done').click()
    await expect(overlay.getByText(marker)).toBeVisible({ timeout: 10_000 })

    // Reload the whole page and reopen the same file: content persists.
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await openPreview(page, base)
    await expect(previewOverlay(page).getByText(marker)).toBeVisible({ timeout: 15_000 })
    await shot(page, '04-reload-persisted')
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

    await shot(page, '05-ts-syntax-colours')
  })

  test('find & replace works', async ({ page }) => {
    test.setTimeout(60_000)
    const name = `1563-findreplace-${process.pid}.txt`
    const path = writeText(name, 'alpha bravo alpha charlie alpha\n')

    await gotoAndSettle(page)
    const base = await uploadAndWait(page, path)
    await dismissDevBanner(page)
    await openPreview(page, base)
    const editor = await enterEdit(page)

    await editor.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+F')
    const panel = editor.locator('.cm-search')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    await panel.locator('input[aria-label="Find"]').fill('alpha')
    await panel.locator('input[aria-label="Replace"]').fill('ALPHA')
    await panel.locator('button[name="replaceAll"]').click()

    await expect(editor.getByTestId('editor-dirty-dot')).toBeVisible()
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
    await expect(editor.getByTestId('editor-dirty-dot')).toBeVisible()

    // Closing the whole preview while dirty → guard dialog, not a silent close.
    await overlay.getByTestId('preview-close-button').click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5_000 })
    await shot(page, '07-unsaved-guard')

    // Keep editing → dialog closes, preview + editor still open, edit intact.
    await guard.getByTestId('unsaved-keep-editing').click()
    await expect(guard).toBeHidden()
    await expect(overlay).toBeVisible()
    await expect(editor.getByTestId('editor-dirty-dot')).toBeVisible()

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
})
