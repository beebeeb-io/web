/**
 * 1565 — regression guard for five real preview bugs found while building
 * the full preview-matrix spec (e2e/1565-preview-matrix.matrix.ts), fixed in
 * the same task:
 *
 *   1. `.cs` (C#) was entirely missing from file-preview.tsx's EXT_LANGUAGE
 *      map — a real .cs file fell through pickRenderer to the generic
 *      "Preview not available" card instead of the code viewer every other
 *      ~20 languages get.
 *   2. A bare `Dockerfile` (no dot at all) made getExtension() return '',
 *      which never reached the `dockerfile: 'docker'` entry that already
 *      existed in EXT_LANGUAGE — same downgrade.
 *   3. `.tsx` (and `.jsx`) were missing from src/lib/preview.ts's
 *      PREVIEWABLE_EXTENSIONS — the double-click/single-click GATE in
 *      file-list.tsx (`isPreviewable()`) runs BEFORE pickRenderer ever gets
 *      a chance, so a real .tsx upload (browser-reported mime empty or
 *      octet-stream — unlike `.ts`, which Chromium/macOS often resolves to
 *      the registered `video/mp2t` MPEG-transport-stream mime, incidentally
 *      passing the gate's mime check) never opened the preview OR showed
 *      the "can't be previewed" toast: a single click's isPreviewable()
 *      check returned false and file-list.tsx's handleRowClick silently
 *      just selected the row instead (`onSelectFile`, not `onFileAction`).
 *      Confirmed live via the full 59-fixture matrix run + a targeted repro
 *      that dumped the row's bounding box and retried a fresh dblclick —
 *      both attempts left `overlayCount=0` and `toastCount=0`, ruling out
 *      a timing race. pickRenderer/EXT_LANGUAGE already mapped BOTH `tsx`
 *      and `jsx` to a real language for CodeRenderer; only the gate list
 *      had drifted, same class of bug as #1 and #2 above.
 *   4. A double-click on a NON-previewable file (e.g. legacy .doc) could
 *      silently do nothing at all — not even the "can't be previewed" toast.
 *      file-list.tsx's handleRowClick fired onSelectFile SYNCHRONOUSLY on
 *      the double-click's first native 'click', mounting
 *      FileDetailsPanel's full-viewport click-to-close backdrop
 *      (`fixed inset-0 z-40` / `absolute inset-0 bg-ink/10`) before the
 *      SECOND click could land on the row — confirmed via a capture-phase
 *      click/dblclick event-log repro: click #1 hit the row's own metadata
 *      text, click #2 hit the backdrop instead. Both native clicks of a
 *      double-click must target the SAME element for the browser to fire
 *      'dblclick', so onDoubleClick (and its toast) never ran. Load-
 *      sensitive — worse under CPU contention, which is exactly when the
 *      full 59-fixture matrix first caught it as `office/sample.doc ->
 *      no-overlay`. Fixed by debouncing the onSelectFile side effect
 *      (300ms, cancelled if a dblclick follows) so the backdrop never
 *      mounts inside a genuine double-click's own click gap.
 *   5. An undecodable image (.tiff — Chromium has no native TIFF codec) left
 *      ImagePreview's plain `<img>` permanently broken with no `onError`
 *      handler at all — the matrix's own outcome classifier reads that as
 *      an unresolving 'spinner', a hard FAIL under the task's own cardinal
 *      rule. HeicPreview/RawPreview already had their own fallback to
 *      UnsupportedPreview on decode failure; ImagePreview (every OTHER
 *      image type's renderer) had none. Fixed with an onError handler.
 *
 * Deliberately small and fast (5 fixtures, not the full 59) so it can run on
 * every PR, not just this task's own verification pass. The full matrix
 * spec is the exploratory/coverage tool; this is the permanent guard against
 * these specific regressions recurring.
 *
 * Proven RED before GREEN this session (task file has all three pastes):
 *   - reverted `cs: 'csharp'` from EXT_LANGUAGE + the getExtension bare-
 *     filename fallback -> both assertions failed with "Preview not
 *     available for this file type" instead of rendered content.
 *   - restored both fixes -> green again.
 *   - reverted `'tsx', 'jsx'` from PREVIEWABLE_EXTENSIONS -> the tsx
 *     assertion failed with outcome 'no-overlay' (never even reached a
 *     card — see the module-level comment above on why single-click alone
 *     already opens previewable files and why this file's own
 *     `dismissFirstRunOverlays`+`openPreview` pattern was not itself the
 *     cause).
 *   - restored the fix -> green again.
 *   - (bug #4, separate dedicated repro spec, deleted after use) reverted
 *     the 300ms debounce in file-list.tsx's handleRowClick back to a bare
 *     synchronous `onSelectFile?.(file)` -> a capture-phase click-event-log
 *     repro showed click #2 of the dblclick landing on
 *     `absolute inset-0 bg-ink/10` (the details-panel backdrop) instead of
 *     the row, toastCount stayed 0 for the full 5s poll -> restored the
 *     debounce -> toastCount=1 at t+0ms, `openPreviewOrToast` returns the
 *     toast text immediately.
 *   - (bug #5) removed the `onError` handler from ImagePreview's `<img>` ->
 *     sample.tiff's outcome stayed 'spinner' ("img present but not decoded")
 *     for the full waitForOutcome budget, assertion failed expecting
 *     'cant-preview' -> restored the handler -> 'cant-preview' immediately.
 *
 * Run: E2E_API_PORT=… E2E_VITE_PORT=… bash e2e/scripts/web-e2e.sh e2e/1565-code-ext-regression.spec.ts
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import path from 'path'
import { signupAndUnlock } from './helpers/signup'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'
import { FIXTURES_ROOT, waitForOutcome, openPreviewOrToast } from './helpers/preview-matrix'

test.use({ storageState: { cookies: [], origins: [] } })

/** Waits up to `timeoutMs` for `locator` to become visible, clicks it if it
 *  does, swallows the timeout if it never appears. THREE real RED attempts
 *  at proving this task's own mutation failed for the WRONG reason before
 *  this landed — each one instructive, kept here rather than deleted per
 *  "leave a wrong claim visible, write the correction beneath it":
 *
 *   1. No dismissal at all -> `TimeoutError` waiting for the preview overlay;
 *      page snapshot showed the cookie-consent dialog still up, blocking the
 *      first upload's row double-click.
 *   2. Added `tourSkip.isVisible({ timeout: 5_000 })` for a "Skip tour"
 *      button inside a `role="dialog"` named "Upload your first file" —
 *      SAME failure. Root cause: `locator.isVisible({ timeout })` does NOT
 *      auto-wait, the option is silently ignored (documented in this repo's
 *      own e2e/1563-text-editor.spec.ts `dismissDevBanner` comment), so the
 *      check ran before anything async-mounted existed and always missed.
 *   3. Switched that ONE check to `waitFor()` (which does wait) — SAME
 *      failure again. Root cause: wrong element entirely — grepping the
 *      failure's own accessibility snapshot for `dialog` found zero matches;
 *      the actual blocker was a "Welcome, there" checklist WIDGET (no dialog
 *      role) whose "Skip for now" button was already being checked for
 *      below, just with the same non-waiting `isVisible` call.
 *
 *  Fix: `waitFor()`, applied to EVERY dismiss check, not just the one that
 *  happened to get diagnosed first.
 */
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
  // The "Welcome, there" checklist widget's own "Skip for now" button — the
  // actual blocker in attempts 1-3 above.
  await dismissIfShown(page.getByRole('button', { name: /^Skip for now$/ }))
  // Not reproduced this session, but a different first-run component
  // (role="dialog", "Skip tour" button) exists elsewhere in this repo's
  // specs — cheap to also proactively dismiss.
  await dismissIfShown(
    page.getByRole('dialog', { name: /Upload your first file/i }).getByRole('button', { name: /Skip tour/i }),
  )
  // A FOURTH real blocker, found live after fixing the first three: task
  // 1525's post-signup "Check your email for a verification code" banner
  // (src/components/email-verify-banner.tsx) pushes the drive list DOWN when
  // it mounts. When that reflow lands mid-dblclick, Playwright's own
  // actionability/stability check can still deliver the click to the now-
  // shifted coordinates — landing on the row's CHECKBOX instead of the row
  // body (confirmed via the failure screenshot: "sample.cs" shown selected,
  // orange highlight, no preview ever opened, `previewOverlay` wait timing
  // out with a perfectly clean drive underneath — no dialog, no widget, no
  // error). Dismissing the banner before any upload removes the reflow
  // entirely rather than trying to out-time-race it.
  await dismissIfShown(page.getByRole('button', { name: 'Dismiss verification banner' }))
}

test.describe('1565 — C# and bare-Dockerfile must render, not fall back', () => {
  test.describe.configure({ retries: 0 })

  test('sample.cs renders via CodeRenderer/TextPreview, not the unsupported card', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'CsRegression-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const filePath = path.join(FIXTURES_ROOT, 'code', 'sample.cs')
    const base = await uploadAndWait(page, filePath)
    await openPreview(page, base)
    const { outcome, detail } = await waitForOutcome(page)

    expect(outcome, `sample.cs: got '${outcome}' (${detail})`).toBe('render')
  })

  test('bare Dockerfile (no extension) renders via CodeRenderer, not the unsupported card', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'DockerfileRegression-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const filePath = path.join(FIXTURES_ROOT, 'code', 'Dockerfile')
    const base = await uploadAndWait(page, filePath)
    await openPreview(page, base)
    const { outcome, detail } = await waitForOutcome(page)

    expect(outcome, `Dockerfile: got '${outcome}' (${detail})`).toBe('render')
    // Belt and suspenders: confirm we did NOT land on the generic fallback card.
    await expect(previewOverlay(page)).not.toContainText('Preview not available for this file type')
  })

  test('sample.tsx opens and renders — the isPreviewable gate does not silently swallow it', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'TsxRegression-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    const filePath = path.join(FIXTURES_ROOT, 'code', 'sample.tsx')
    const base = await uploadAndWait(page, filePath)
    // openPreviewOrToast (not the plain openPreview() used above) because
    // BEFORE the fix this file neither opened an overlay NOR showed a toast
    // — a bare dblclick().waitFor(overlay visible) would just throw a timeout,
    // which still proves red but for the wrong-looking reason. This mirrors
    // exactly how the full 59-fixture matrix spec classifies every row.
    const opened = await openPreviewOrToast(page, base)
    const { outcome, detail } = opened.opened
      ? await waitForOutcome(page)
      : { outcome: opened.toastText ? ('cant-preview' as const) : ('no-overlay' as const), detail: opened.toastText ?? 'no overlay, no toast' }

    // Before the fix this was 'no-overlay' — not even the honest fallback
    // card, because isPreviewable() returning false makes a plain click
    // just SELECT the row (file-list.tsx's handleRowClick `onSelectFile`
    // branch), never open anything and never toast either.
    expect(outcome, `sample.tsx: got '${outcome}' (${detail})`).toBe('render')
  })

  test('double-clicking a non-previewable file (legacy .doc) shows the toast — the details-panel backdrop must not eat the second click', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'DocDblclickRegression-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    // Root-caused live via a capture-phase click/dblclick event-log repro
    // (task file has the full transcript): a double-click on a NON-
    // previewable row delivers two native 'click' events before the
    // browser's own 'dblclick'. Click #1's onClick (handleRowClick) used to
    // call onSelectFile SYNCHRONOUSLY, which mounts FileDetailsPanel's
    // full-viewport `fixed inset-0 z-40` click-to-close backdrop
    // (`absolute inset-0 bg-ink/10`). When that mount landed in the gap
    // before click #2 arrived, click #2 hit the backdrop instead of the row
    // — confirmed by the repro's own event log: click #1 targeted the row's
    // metadata text node, click #2 targeted `absolute inset-0 bg-ink/10`.
    // Because both clicks of a native double-click must hit the SAME
    // element for the browser to fire 'dblclick', the row's onDoubleClick
    // (and its toast) never ran — not a timeout, not a wrong card, NOTHING
    // happened. Confirmed load-sensitive (worse under CPU contention, which
    // is exactly when the full 59-fixture matrix first caught it) — a real
    // user double-clicking a legacy .doc/.ppt/.xls/.zip/binary file on a
    // slower device could see silence instead of the honest toast.
    const filePath = path.join(FIXTURES_ROOT, 'office', 'sample.doc')
    const base = await uploadAndWait(page, filePath)
    const opened = await openPreviewOrToast(page, base)

    // Before the fix: opened.opened === false AND opened.toastText === undefined
    // (neither the overlay nor the toast ever appeared — 'no-overlay', the
    // exact FAIL the full matrix spec recorded for this fixture).
    expect(opened.opened, `sample.doc: an overlay unexpectedly opened for a legacy .doc`).toBe(false)
    expect(
      opened.toastText,
      `sample.doc: no "can't be previewed" toast appeared — the double-click was silently swallowed`,
    ).toMatch(/can't be previewed/i)
  })

  test('an undecodable image (.tiff — no native Chromium codec) shows the honest fallback card, never a permanent spinner', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'TiffDecodeRegression-correct-horse-1' })
    await dismissFirstRunOverlays(page)

    // Root-caused via the full 59-fixture matrix run: Chromium has no native
    // TIFF decoder, so the plain <img> in ImagePreview fired 'error' — which
    // nothing listened for. The task's own outcome classifier
    // (classifyOutcome) reads a present-but-undecoded <img> as 'spinner'
    // (indistinguishable from "still loading" from a single snapshot), and
    // because the image NEVER decodes, that 'spinner' never resolves —
    // exactly the task's own cardinal rule: "a blank area or a spinner that
    // never ends is always a FAIL". HeicPreview and RawPreview already had
    // their own self-contained fallback to UnsupportedPreview on decode
    // failure; ImagePreview (the plain browser-native <img> path used by
    // every OTHER image type) had none. Fixed with an onError handler.
    const filePath = path.join(FIXTURES_ROOT, 'images', 'sample.tiff')
    const base = await uploadAndWait(page, filePath)
    await openPreview(page, base)
    const { outcome, detail } = await waitForOutcome(page)

    // Before the fix this was 'spinner' ("img present but not decoded
    // (broken or still loading)") for the full wait budget, never resolving.
    expect(outcome, `sample.tiff: got '${outcome}' (${detail})`).toBe('cant-preview')
  })
})
