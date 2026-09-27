/**
 * 1565 — preview matrix: every common file type opens correctly on web.
 *
 * NOT part of the default E2E gate (PR #107 review, Codex P1): named
 * `*.matrix.ts` on purpose so `e2e/scripts/web-e2e.sh`'s default
 * `SPECS=(e2e/*.spec.ts)` glob — the same glob a bare CI run expands — never
 * picks it up. This is a 59-upload, exploratory, not-fully-verified matrix
 * with a 40-minute timeout and 4 external raw.pixls.us downloads; it does not
 * belong in every PR's gate. Run it explicitly via
 * `bun run test:e2e:preview-matrix` (see package.json) or the full command
 * below. Playwright's own `authenticated` project testMatch in
 * playwright.config.ts is extended with this exact filename so an explicit
 * invocation still resolves to a project (global.setup + the `authenticated`
 * project's dependency chain) — see that file's comment.
 *
 * Uploads every fixture under e2e/fixtures/preview-matrix/ through the real
 * signup → upload → preview flow against the REAL stack (server + Postgres,
 * no route mocking — run via e2e/scripts/web-e2e.sh), opens each one's
 * preview, and classifies the resulting overlay into one of the task's own
 * outcome buckets (e2e/helpers/preview-matrix.ts `classifyOutcome`):
 *   - render        content actually renders
 *   - cant-preview  the honest "Preview not available for this file type" card
 *   - spinner       FAIL — a loading spinner never resolved
 *   - blank         FAIL — the overlay mounted but shows nothing
 *   - no-overlay    FAIL (harness) — the preview never opened
 *
 * Ground truth for each fixture's `expected` outcome was read directly from
 * `src/components/preview/file-preview.tsx` (pickRenderer) BEFORE running
 * anything — see e2e/helpers/preview-matrix.ts's FIXTURES table and its
 * per-row `notes`. Two real bugs this reading found were fixed in the SAME
 * task (see git log for this file's sibling commits):
 *   - `.cs` (C#) was entirely missing from EXT_LANGUAGE — a real C# source
 *     file fell through pickRenderer to the generic "Preview not available"
 *     card instead of the code viewer every other ~20 languages get.
 *   - a bare `Dockerfile` (no dot, so getExtension() returned '') never
 *     reached the `dockerfile: 'docker'` entry that already existed in
 *     EXT_LANGUAGE — same "Preview not available" downgrade.
 *
 * Uploaded filenames get a zero-padded numeric prefix (e.g. "01-sample.docx")
 * EXCEPT the bare `Dockerfile` fixture (prefixing it would defeat the very
 * no-extension code path this matrix exists to test). This is a harness-only
 * rename to route around Playwright's un-anchored row-name regex matching a
 * SHORTER fixture name that is a literal substring of a longer one uploaded
 * earlier in the same run and still sitting in the drive — e.g. "sample.doc"
 * is a substring of "sample.docx", "sample.c" of "sample.cs"/"sample.css"/
 * "sample.cpp"/"sample.csv"/"sample.cr2"/"sample.cr3", "sample.ts" of
 * "sample.tsx", "sample.js" of "sample.json", "sample.h" of "sample.html".
 * Distinct numeric prefixes make every uploaded name safe to match by
 * substring again. The prefix never touches the real extension pickRenderer
 * dispatches on, so it does not change what's under test.
 *
 * Run (own port triple, never the shared :3003/:5173/beebeeb_web_e2e_3003):
 *   E2E_API_PORT=37951 E2E_VITE_PORT=37952 E2E_DB_NAME=beebeeb_web_e2e_1565 \
 *     E2E_API_BIN=<path to a debug beebeeb-api built from server origin/main> \
 *     bash e2e/scripts/web-e2e.sh e2e/1565-preview-matrix.matrix.ts
 * …or the equivalent `bun run test:e2e:preview-matrix` (same env vars,
 * package.json script) — see that script for the exact invocation.
 *
 * Before running: e2e/fixtures/preview-matrix/raw/fetch-raw.sh must have
 * populated the 4 RAW samples too large to commit (cr2/cr3/arw/raf) — this
 * spec runs it itself, first thing, so a bare `bash e2e/scripts/web-e2e.sh
 * e2e/1565-preview-matrix.matrix.ts` invocation is sufficient.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { signupAndUnlock } from './helpers/signup'
import { previewOverlay, uploadAndWait } from './helpers/thumb-fixtures'
import { FIXTURES, FIXTURES_ROOT, waitForOutcome, openPreviewOrToast, type FixtureCase, type Outcome } from './helpers/preview-matrix'

test.use({ storageState: { cookies: [], origins: [] } })
// This machine's load average can spike past 60 from concurrent worktree
// lanes (see the dated Notes on this task), which inflates real Argon2id/
// OPAQUE wall-clock time enough to threaten even a generous per-attempt
// budget — a silent retry under the SAME contention would just burn another
// full budget with no better odds. 0 retries: a failure here should be seen
// and diagnosed immediately, not quietly re-attempted.
test.describe.configure({ retries: 0 })

const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? 'evidence-1565'

interface RowResult {
  n: number
  rel: string
  uploadName: string
  category: string
  ext: string
  expected: FixtureCase['expected']
  actual: Outcome
  detail: string
  pass: boolean
  screenshot: string
}

/** Waits up to `timeoutMs` for `locator` to become visible, clicks it if it
 *  does, and swallows the timeout if it never appears. Exists because
 *  `locator.isVisible({ timeout })` does NOT auto-wait — the `timeout`
 *  option is silently ignored (documented in this repo's own
 *  e2e/1563-text-editor.spec.ts `dismissDevBanner` comment) — so a check
 *  immediately after `signupAndUnlock` reliably MISSES anything that mounts
 *  asynchronously. Found live, twice, while proving this task's own
 *  mutation RED: `locator.dblclick: Test timeout of 60000ms exceeded`, 100+
 *  identical retries, always blocked by the exact same
 *  `fixed inset-0 z-50 ... bg-ink/30` overlay — first mis-diagnosed as the
 *  "Upload your first file" coachmark TOUR dialog (`role="dialog"`, "Skip
 *  tour" button — which never actually appeared this session, confirmed by
 *  grepping the failure's own accessibility snapshot for `dialog` and
 *  finding zero matches), then correctly identified as the "Welcome, there"
 *  checklist WIDGET (no dialog role at all) — its "Skip for now" button was
 *  already being checked for, just with the same non-waiting `isVisible`
 *  call, so it was ALSO silently missing it. */
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
  // Belt and suspenders: the "Upload your first file" coachmark tour is a
  // DIFFERENT component (role="dialog", "Skip tour" button) that other specs
  // in this repo do encounter — not reproduced in this session, but cheap to
  // also proactively dismiss rather than rely solely on the reactive
  // `page.addLocatorHandler` registered below.
  await dismissIfShown(
    page.getByRole('dialog', { name: /Upload your first file/i }).getByRole('button', { name: /Skip tour/i }),
  )
  // A fourth real blocker (see e2e/1565-code-ext-regression.spec.ts for the
  // full writeup): task 1525's post-signup "Check your email for a
  // verification code" banner reflows the drive list when it mounts, which
  // can land a dblclick on the row's checkbox instead of the row body if the
  // reflow happens mid-action. Dismiss it before any upload.
  await dismissIfShown(page.getByRole('button', { name: 'Dismiss verification banner' }))
}

/** The first-run coachmark tour floats above the drive and can intercept the
 *  very first upload/preview interaction (same pattern as
 *  e2e/file-versions-same-name.spec.ts / e2e/1563-text-editor.spec.ts). */
function installTourDismisser(page: Page): void {
  page.addLocatorHandler(
    page.getByRole('dialog', { name: /Upload your first file/i }),
    async (tour) => {
      const skipBtn = tour.getByRole('button', { name: /Skip tour/i })
      if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click()
    },
  ).catch(() => {})
}

/** Zero-padded numeric prefix so no uploaded fixture name is ever a literal
 *  substring of another still-present row's name (see file header). The bare
 *  `Dockerfile` fixture is left untouched — it has no dot, and prefixing it
 *  would make getExtension() return the whole (now different) lowercased
 *  name instead of exercising the real no-extension bare-filename path. It
 *  also doesn't collide with anything else in this fixture set.
 */
function uploadNameFor(n: number, origBase: string): string {
  if (origBase === 'Dockerfile') return origBase
  return `${String(n).padStart(2, '0')}-${origBase}`
}

test('every preview-matrix fixture renders, shows an honest fallback, or is flagged FAIL', async ({ page }) => {
  // 59 fixtures, each doing a real upload + page reload + decrypt + preview —
  // budget generously rather than risk a flaky mid-run timeout. Bumped from
  // 20 to 40 minutes after a real run on this shared machine (load average
  // ~67 on 12 cores, concurrent worktree lanes) made zero visible progress
  // in 15 minutes and looked hung; killing it found the API/browser both
  // still healthy — it was Argon2id/OPAQUE key derivation running honestly
  // slow under CPU starvation, not a deadlock. See this task's dated Notes.
  test.setTimeout(40 * 60 * 1000)

  // Populate the 4 RAW samples too large to commit (idempotent — cache-hits
  // on a re-run, see fetch-raw.sh's own sha256 verification).
  execFileSync('bash', ['fetch-raw.sh'], {
    cwd: path.join(FIXTURES_ROOT, 'raw'),
    stdio: 'inherit',
  })

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-preview-matrix-'))

  // This machine runs many concurrent worktree lanes; Argon2id/OPAQUE key
  // derivation is deliberately CPU-heavy and can take minutes (not seconds)
  // under a high load average instead of hanging — these timestamps are the
  // instrumentation that tells the two apart from the OUTSIDE (a run with
  // zero log lines for 15 minutes is otherwise indistinguishable from a
  // genuine hang; see this task's dated Notes for the incident this fixed).
  console.log(`[1565] ${new Date().toISOString()} starting signup+unlock...`)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'PreviewMatrix-correct-horse-1565' })
  console.log(`[1565] ${new Date().toISOString()} signed up + unlocked.`)
  await dismissFirstRunOverlays(page)
  installTourDismisser(page)

  const results: RowResult[] = []

  for (let i = 0; i < FIXTURES.length; i++) {
    const fx = FIXTURES[i]
    const n = i + 1
    await test.step(`${n}. ${fx.rel}`, async () => {
      console.log(`[1565] ${new Date().toISOString()} [${n}/${FIXTURES.length}] ${fx.rel} starting...`)
      const origBase = path.basename(fx.rel)
      const uploadName = uploadNameFor(n, origBase)
      const srcPath = path.join(FIXTURES_ROOT, fx.rel)
      const uploadPath = path.join(scratchDir, uploadName)
      fs.copyFileSync(srcPath, uploadPath)

      const shotName = `${String(n).padStart(2, '0')}-${fx.category}-${fx.ext.replace(/[^\w.-]/g, '_')}.png`
      let outcome: Outcome
      let detail: string

      // Every step is resilient: ONE fixture throwing (a real product bug,
      // a transient network blip, anything) must not abort the other 58 —
      // caught live running the full matrix, task 1565's own dated Notes
      // have the incident: fixture #2 (legacy .doc) threw from
      // `openPreview`'s unconditional 15s overlay wait and killed the whole
      // spec run before it ever reached fixture #3.
      try {
        await uploadAndWait(page, uploadPath)
        // file-list.tsx's row onDoubleClick calls `isPreviewable()` BEFORE
        // ever mounting the overlay — legacy .doc/.ppt and .zip correctly
        // fail it by design (pickRenderer has no renderer for any of them
        // either) and get a toast instead, never an overlay. That's an
        // equally honest 'cant-preview' signal, not a FAIL — see
        // openPreviewOrToast's own doc comment for the live incident this
        // fixed (fixture #2 in the very first full run).
        const opened = await openPreviewOrToast(page, uploadName)
        if (opened.opened) {
          ;({ outcome, detail } = await waitForOutcome(page))
        } else if (opened.toastText) {
          outcome = 'cant-preview'
          detail = `toast (no overlay): ${opened.toastText.slice(0, 160)}`
        } else {
          outcome = 'no-overlay'
          detail = 'neither the preview overlay nor a "can\'t be previewed" toast appeared'
        }
      } catch (err) {
        outcome = 'no-overlay'
        detail = `threw: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`
      }

      await page.screenshot({ path: path.join(EVIDENCE_DIR, shotName) }).catch(() => {})

      const pass = outcome === fx.expected
      results.push({
        n,
        rel: fx.rel,
        uploadName,
        category: fx.category,
        ext: fx.ext,
        expected: fx.expected,
        actual: outcome,
        detail,
        pass,
        screenshot: path.join(EVIDENCE_DIR, shotName),
      })

      // Close the preview before the next iteration (best-effort — a toast
      // outcome or a threw-in-upload outcome never opened one) — don't let a
      // stuck overlay from row N corrupt row N+1's classification.
      const closeBtn = page.getByRole('button', { name: 'Close preview' })
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => {})
      } else {
        await page.keyboard.press('Escape').catch(() => {})
      }
      await previewOverlay(page).first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
      // A same-run recovery attempt: if THIS fixture threw before even
      // uploading (e.g. a network blip), the drive may be in an unknown
      // state for the next one. A reload is cheap insurance against that
      // compounding across 58 more fixtures.
      if (outcome === 'no-overlay' && detail.startsWith('threw:')) {
        await page.reload().catch(() => {})
        await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 }).catch(() => {})
      }

      console.log(`[1565] ${new Date().toISOString()} [${n}/${FIXTURES.length}] ${fx.rel} -> ${outcome} (${pass ? 'PASS' : 'FAIL'})`)
      expect.soft(pass, `[${n}] ${fx.rel}: expected ${fx.expected}, got ${outcome} (${detail})`).toBe(true)
    })
  }

  const passCount = results.filter((r) => r.pass).length
  const table = [
    '| # | Type | Category | Expected | Actual | Result | Detail |',
    '|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.n} | .${r.ext} | ${r.category} | ${r.expected} | ${r.actual} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/').slice(0, 100)} |`,
    ),
  ].join('\n')
  const summary = `${passCount} of ${results.length} types PASS\n\n${table}\n`
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'RESULTS.md'), summary)
  console.log(`\n${summary}`)
  await test.info().attach('results-table', { body: summary, contentType: 'text/markdown' })

  // The task's own hard rule: a blank area or a spinner that never ends is
  // ALWAYS a FAIL, regardless of what this spec's own pre-registered
  // `expected` prediction said (a wrong prediction is a spec bug to go fix
  // in the FIXTURES table, not license to ship a real blank/spinner).
  const hardFails = results.filter((r) => r.actual === 'blank' || r.actual === 'spinner' || r.actual === 'no-overlay')
  expect(
    hardFails,
    `Hard FAILs (blank/spinner/no-overlay never resolves) — see ${EVIDENCE_DIR}/RESULTS.md:\n${JSON.stringify(hardFails, null, 2)}`,
  ).toHaveLength(0)

  expect(passCount, `${passCount} of ${results.length} types PASS — see ${EVIDENCE_DIR}/RESULTS.md`).toBe(
    results.length,
  )
})
