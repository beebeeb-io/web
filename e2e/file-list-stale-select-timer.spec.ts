/**
 * Regression guard for a follow-up bug in #107's own fix (task 1565's
 * debounced non-previewable-click → onSelectFile, see file-list.tsx's
 * `pendingSelectTimerRef` doc comment and src/lib/pending-select-timer.ts's
 * header comment for the full story): a single click on a non-previewable
 * file (e.g. a legacy .doc) arms a 300ms timer that will call onSelectFile
 * for that file. The original fix only ever cleared that timer from the
 * SAME row's own onDoubleClick. A single click on a folder, a single click
 * on a previewable file, or keyboard activation of a DIFFERENT row within
 * the 300ms window left the timer armed — it fired ~300ms after the
 * ORIGINAL click and opened that file's details panel over whatever the
 * user had since navigated to or opened.
 *
 * Two cases here:
 *   1. The exact scenario named in the fix brief — click the non-previewable
 *      file, then within 300ms double-click into a folder.
 *   2. A single click on a non-previewable file, then within 300ms a single
 *      click on a PREVIEWABLE file in the SAME folder.
 *
 * RED proof (2026-09-27, mutation testing against a LIVE isolated harness —
 * this is the real finding, not a prediction, and case 1's own result
 * contradicts what an earlier draft of this comment assumed before actually
 * running it): reverted src/lib/pending-select-timer.ts's handleRowClick to
 * the pre-fix shape (unconditional clear removed from the top; only the
 * non-previewable branch cleared its OWN previous timer before rescheduling
 * — see that file's own header comment for the exact diff) and re-ran this
 * spec:
 *   - case 2 (previewable file, same folder) FAILED, deterministically:
 *     "the .doc file's details panel must not pop open over the image
 *     preview ... Expected: 0 Received: 1". This is the real RED→GREEN
 *     proof for this fix.
 *   - case 1 (folder) stayed GREEN even with the bug reintroduced. Root
 *     cause: FileDetailsPanel's `file` prop is looked up LIVE from the
 *     current folder's `files` array (drive.tsx: `files.find(f => f.id ===
 *     selectedFileId)`) — by the time the 300ms stale timer fires, the
 *     folder-navigation fetch has already replaced `files` with the (empty,
 *     freshly-created) target folder's contents, so the lookup returns null
 *     and the panel silently doesn't render even though `onSelectFile` DID
 *     fire for the wrong file. The symptom self-masks specifically when the
 *     second action is a folder navigation; it does NOT self-mask for any
 *     click that stays within the same folder (case 2, or the shift/mod-key
 *     click branches the unit tests in test/file-list-stale-select-timer.test.ts
 *     cover directly). Case 1 is kept anyway because it's the literal
 *     scenario named in the fix brief and still exercises the real
 *     click→dblclick→navigate path end-to-end (screen reader label, real
 *     folder creation, real navigation) even though it cannot itself prove
 *     the timer bug — case 2 and the unit suite carry that proof.
 * Reverted the mutation — both cases green again immediately after.
 *
 * Run (isolated harness, does not touch the shared :3001/:3002 dev stack):
 *   E2E_API_PORT=38331 E2E_VITE_PORT=38332 E2E_DB_NAME=beebeeb_web_e2e_timer \
 *   E2E_API_BIN=<repos/server>/target/debug/beebeeb-api \
 *   ./e2e/scripts/web-e2e.sh e2e/file-list-stale-select-timer.spec.ts
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import path from 'path'
import { signupAndUnlock } from './helpers/signup'
import { uploadAndWait, escapeRe, previewOverlay } from './helpers/thumb-fixtures'
import { FIXTURES_ROOT } from './helpers/preview-matrix'

test.use({ storageState: { cookies: [], origins: [] } })

/** Waits up to `timeoutMs` for `locator` to become visible, clicks it if it
 *  does, swallows the timeout if it never appears — same pattern as
 *  e2e/1565-code-ext-regression.spec.ts's dismissIfShown (see that file's
 *  comment for why a non-waiting isVisible() check is not sufficient here). */
async function dismissIfShown(locator: Locator, timeoutMs = 6_000): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs })
    await locator.click()
  } catch {
    // Never appeared within the budget — nothing to dismiss.
  }
}

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  await dismissIfShown(page.getByRole('button', { name: 'Essential only' }))
  await dismissIfShown(page.getByRole('button', { name: /^Skip for now$/ }))
  await dismissIfShown(
    page.getByRole('dialog', { name: /Upload your first file/i }).getByRole('button', { name: /Skip tour/i }),
  )
  await dismissIfShown(page.getByRole('button', { name: 'Dismiss verification banner' }))
}

/** The file-details panel's own click-to-close backdrop — `fixed inset-0
 *  z-40 flex justify-end` is unique to file-details-panel.tsx (confirmed:
 *  drive-layout.tsx's own z-40 overlay is `bg-black/30 md:hidden`, a
 *  different class combination — grepped both before relying on this). */
function detailsPanelCloseButton(page: Page): Locator {
  return page.locator('div.fixed.inset-0.z-40.flex.justify-end').getByRole('button', { name: 'Close' })
}

/** Create a folder via the toolbar's "New folder" dialog and wait for its row. */
async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New folder' }).first().click()
  await page.getByRole('dialog', { name: 'New folder' }).getByPlaceholder('e.g. Contracts').fill(name)
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Create' }).click()
  await page.getByRole('row', { name: new RegExp(`${escapeRe(name)}, folder`) }).first().waitFor({ timeout: 15_000 })
}

test.describe('file-list stale select-timer regression', () => {
  test.describe.configure({ retries: 0 })

  test('case 1 — non-previewable click then within 300ms a double-click into a folder: no stale details panel', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'StaleTimerFolder-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const docPath = path.join(FIXTURES_ROOT, 'office', 'sample.doc')
    const docBase = await uploadAndWait(page, docPath)
    await createFolder(page, 'Target folder')

    const docRow = page.getByRole('row', { name: new RegExp(escapeRe(docBase)) }).first()
    const folderRow = page.getByRole('row', { name: /Target folder, folder/ }).first()

    // Click #1: the non-previewable .doc — arms the 300ms debounced select.
    await docRow.click()
    // Within the window: double-click straight into the folder.
    await folderRow.dblclick()

    // The navigation itself must still work — this fix must not break it.
    await expect(page).toHaveURL(/[?&]folder=/, { timeout: 10_000 })

    // Give the stale timer (300ms) plenty of margin to fire if it's still armed.
    await page.waitForTimeout(800)
    await expect(
      detailsPanelCloseButton(page),
      'the .doc file\'s details panel must not pop open over the folder we navigated into',
    ).toHaveCount(0)
  })

  test('case 2 — non-previewable click then within 300ms a click on a previewable file in the same folder: no stale details panel over the preview', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'StaleTimerPreview-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const docPath = path.join(FIXTURES_ROOT, 'office', 'sample.doc')
    const imgPath = path.join(FIXTURES_ROOT, 'images', 'sample.jpg')
    const docBase = await uploadAndWait(page, docPath)
    const imgBase = await uploadAndWait(page, imgPath)

    const docRow = page.getByRole('row', { name: new RegExp(escapeRe(docBase)) }).first()
    const imgRow = page.getByRole('row', { name: new RegExp(escapeRe(imgBase)) }).first()

    // Click #1: the non-previewable .doc — arms the 300ms debounced select.
    await docRow.click()
    // Within the window: a PLAIN single click on the previewable image —
    // opens the preview immediately via a different code path entirely.
    await imgRow.click()

    // The preview itself must still open — this fix must not break that.
    await expect(previewOverlay(page).first()).toBeVisible({ timeout: 10_000 })

    // Give the stale timer plenty of margin to fire if it's still armed.
    await page.waitForTimeout(800)
    await expect(
      detailsPanelCloseButton(page),
      'the .doc file\'s details panel must not pop open over the image preview',
    ).toHaveCount(0)
  })
  test('case 3 — non-previewable click then within 300ms a click on ANOTHER row\'s selection checkbox (a nested control that stopPropagation()s): no stale details panel', async ({ page }) => {
    // Codex P2 on web #114: the checkbox / star / share badge / lock /
    // row-actions controls all stopPropagation, so the row's bubble-phase
    // onClick (and its unconditional timer clear) never runs for them. Fixed
    // with a row-level onClickCapture — see handleRowInteractionCapture in
    // src/lib/pending-select-timer.ts.
    //
    // RED proof (2026-09-27, live isolated harness): with
    // handleRowInteractionCapture's body mutated to a no-op, this case
    // case 3 failed (cases 1-2 stayed green, 3 passed / 1 failed) at the
    // final assertion: "Error: the .doc file's details panel must not pop
    // open after ticking a different row's checkbox ... toHaveCount ...
    // Expected: 0 Received: 1". Restored → 4 passed.
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'StaleTimerCheckbox-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const docPath = path.join(FIXTURES_ROOT, 'office', 'sample.doc')
    const imgPath = path.join(FIXTURES_ROOT, 'images', 'sample.jpg')
    const docBase = await uploadAndWait(page, docPath)
    const imgBase = await uploadAndWait(page, imgPath)

    const docRow = page.getByRole('row', { name: new RegExp(escapeRe(docBase)) }).first()
    const imgRow = page.getByRole('row', { name: new RegExp(escapeRe(imgBase)) }).first()
    const imgCheckbox = imgRow.getByRole('checkbox')

    // Click #1: the non-previewable .doc — arms the 300ms debounced select.
    await docRow.click()
    // Within the window: tick the OTHER row's selection checkbox.
    await imgCheckbox.click()

    // The checkbox action itself must still work — the image row is selected.
    await expect(imgRow).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })

    // Give the stale timer (300ms) plenty of margin to fire if it's still armed.
    await page.waitForTimeout(800)
    await expect(
      detailsPanelCloseButton(page),
      'the .doc file\'s details panel must not pop open after ticking a different row\'s checkbox',
    ).toHaveCount(0)
  })
})
