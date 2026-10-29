import { test, expect, type Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShareLink } from './helpers/drive'
import { anonymousContext } from './helpers/auth'
import { approveDeviceInPage } from './helpers/cli-approve'

/**
 * Task 1534 (folded into 1531) — "the unwrapped file key doesn't decrypt the
 * file" for a NON-web uploading client.
 *
 * The original prod incident (Guus, 2026-09-25) was root-caused as account-
 * switch key confusion, already fixed on mobile (PR #107) and web (PR #85).
 * Both fixes address "which account's key is active", not "does client X's
 * key derivation for a given account match every other client's" — the
 * OTHER hypothesis the original investigation (1534's notes) ruled out by
 * READING code but never verified by actually driving a non-web client
 * against the real local stack (Phase 2 in those notes was explicitly not
 * reached for CLI/desktop/mobile).
 *
 * This spec closes that gap for the CLI: drives a REAL `bb` binary (scratch
 * HOME — see `bbEnv`, never the real CLI config) through the real headless
 * browser-approval login (same mechanism as `flow6-cli-own-session.spec.ts`,
 * duplicated here since that file exports nothing), which hands `bb` the
 * SAME account's real, currently-resident master key
 * (`/cli-auth` → `master_key_b64`, see `src/pages/cli-auth.tsx`). `bb push`
 * then encrypts a marker file under that key via core's
 * `ChunkEncryptor::from_reader_with_chunk_size(&master, &file_id_str, …)` —
 * the SAME `derive_file_key(master, file_id)` web uses. The web UI (same
 * account) creates a share for the CLI-uploaded file; a truly fresh,
 * anonymous browser context (task 0740a pattern) opens the link and must
 * decrypt the NAME and the CONTENT to byte-identical bytes.
 *
 * A real key-derivation or wire-format mismatch between CLI and web (the
 * class of bug `bb repair` exists to migrate away from — see the task's own
 * notes) would surface here as "Encrypted file" / "Decryption failed",
 * exactly like the prod report.
 *
 * ── PR #108 review round 2 (2026-09-27, Codex P1) ──────────────────────
 * A missing/unbuilt `bb` binary is a HARD FAILURE now, not a silent skip —
 * see the `test.beforeAll` below. `e2e/scripts/web-e2e.sh` resolves and
 * builds `bb` from the sibling `repos/cli` checkout automatically (same
 * pattern as `repos/server` for the API binary) and exports `E2E_BB_BIN`,
 * and `.github/workflows/ci.yml`'s `e2e` job clones + builds `repos/cli`
 * the same way it already does for `repos/server`/`repos/core`. Running
 * this spec via the harness (or CI) should never need a manual
 * `E2E_BB_BIN=...`; set `E2E_1534_ALLOW_SKIP=1` only to explicitly accept
 * the coverage gap for a single ad hoc run.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
// The dev auto-login account's password (beebeeb-api/src/routes/dev.rs).
const DEV_PASSWORD = 'devdevdevdevdev!'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const BB_BIN = process.env.E2E_BB_BIN ?? ''

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/

function bbEnv(home: string): NodeJS.ProcessEnv {
  // Scratch HOME: the real config holds a live prod session — never touch it.
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    BB_LOGIN_HEADLESS: '1',
    NO_COLOR: '1',
  }
}

function runBb(home: string, args: string[]): { rc: number; out: string } {
  const r = spawnSync(BB_BIN, ['--api', API_URL, ...args], { env: bbEnv(home), encoding: 'utf8', timeout: 60_000 })
  return { rc: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(ANSI_RE, '') }
}

/** `bb login --headless`, approved in `page` at /cli-auth. Resolves once bb exits 0. */
async function bbLoginViaBrowser(page: Page, home: string): Promise<void> {
  const child = spawn(BB_BIN, ['--api', API_URL, 'login', '--headless'], { env: bbEnv(home) })
  let out = ''
  child.stdout.on('data', (d: Buffer) => { out += d.toString() })
  child.stderr.on('data', (d: Buffer) => { out += d.toString() })
  const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1)))

  try {
    await expect.poll(() => CODE_RE.test(out.replace(ANSI_RE, '')), { timeout: 20_000 }).toBe(true)
    const code = out.replace(ANSI_RE, '').match(CODE_RE)![1]

    // Task 1734: the code is TYPED, then the password re-proved - no one-click approval.
    await approveDeviceInPage(page, { code, password: DEV_PASSWORD, webUrl: WEB_URL })

    const rc = await Promise.race([
      exited,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error(`bb login did not exit; output:\n${out}`)), 30_000)),
    ])
    expect(rc, `bb login output:\n${out.replace(ANSI_RE, '')}`).toBe(0)
  } finally {
    if (child.exitCode === null) child.kill()
  }
}

// PR #108 review round 2 (Codex P1): this spec used to `test.skip()`
// unconditionally whenever E2E_BB_BIN was unset or pointed nowhere — the
// DEFAULT harness run (`e2e/scripts/web-e2e.sh` with no args, and CI's `e2e`
// job before this same review pass wired the binary in) never set it, so
// the suite reported this file as passed (Playwright counts a skip as a
// non-failure) having executed ZERO assertions. This is the ONLY real-stack
// proof that a non-web client's key derivation matches web's — a silent
// skip here is exactly the false-green Codex flagged, and it stayed
// invisible because nothing distinguished "ran and passed" from "never
// ran" in the summary line. A missing/unbuilt binary is now a HARD FAILURE
// unless E2E_1534_ALLOW_SKIP=1 is set explicitly, for one run, by a human
// who has read this comment.
const BB_MISSING = !BB_BIN || !existsSync(BB_BIN)
const ALLOW_SKIP = process.env.E2E_1534_ALLOW_SKIP === '1'

test.describe('task 1534: a CLI-uploaded file decrypts correctly when shared from web', () => {
  test.skip(
    BB_MISSING && ALLOW_SKIP,
    'E2E_1534_ALLOW_SKIP=1 set and no bb binary available — explicitly opting out of the CLI/web cross-decrypt gate.',
  )

  test.beforeAll(() => {
    if (BB_MISSING && !ALLOW_SKIP) {
      throw new Error(
        `E2E_BB_BIN is not set to a built bb binary (got ${JSON.stringify(BB_BIN)}). ` +
          'This spec is the only real-stack proof that a CLI-uploaded file decrypts identically from web; a silent skip reports the run green having verified nothing. ' +
          'Build one: (cd repos/cli && cargo build -p beebeeb-cli) — e2e/scripts/web-e2e.sh now does this automatically and exports E2E_BB_BIN, so running through the harness (not `bunx playwright test` directly) is normally enough. ' +
          'To explicitly accept the coverage gap for one run instead, set E2E_1534_ALLOW_SKIP=1.',
      )
    }
  })

  let home = ''
  test.beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bb-1534-cli-home-'))
  })
  test.afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
  })

  test('bb push -> web share -> fresh anonymous context: name decrypts, downloaded bytes are byte-identical', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)

    // The default "authenticated" project's dev-auto-login account. Its
    // resident master key is what /cli-auth will hand to `bb` below.
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    await bbLoginViaBrowser(page, home)

    const marker = `1534 cli-upload matrix :: the quick brown fox :: +/= edge :: ${Date.now()}`
    const filename = `cli-1534-${Date.now()}.txt`
    const localPath = join(home, filename)
    writeFileSync(localPath, marker, 'utf8')

    const push = runBb(home, ['push', localPath])
    expect(push.rc, `bb push failed:\n${push.out}`).toBe(0)

    // bb login's browser round trip navigated `page` away from the drive —
    // go back and pick up the file the CLI just uploaded via a fresh load
    // (no live-sync dependency: a plain page load re-fetches the listing).
    await page.goto('/')
    await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

    const shareUrl = await createShareLink(page, filename)
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)

    // TRULY anonymous recipient (task 0740a pattern) — see helpers/auth.ts's
    // doc comment for why a bare newContext() would mask this as the AUTHED
    // download path.
    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))

    try {
      await recipient.goto(shareUrl)

      // Filename decrypts ⇒ the wrapped file key the web share-dialog built
      // for this CLI-uploaded file (getFileKey(fileId) = derive(master, id))
      // is the SAME key `bb push` actually encrypted the name+content with.
      await expect(recipient.getByText(filename, { exact: false })).toBeVisible({ timeout: 30_000 })
      await expect(recipient.getByText('Encrypted file', { exact: false })).toHaveCount(0)

      const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
      await expect(downloadBtn).toBeVisible({ timeout: 10_000 })
      const [download] = await Promise.all([
        recipient.waitForEvent('download', { timeout: 30_000 }),
        downloadBtn.click(),
      ])
      const path = await download.path()
      expect(path, 'download path').toBeTruthy()
      expect(fs.readFileSync(path!, 'utf8')).toBe(marker)
    } finally {
      await ctx.close()
    }
  })
})
