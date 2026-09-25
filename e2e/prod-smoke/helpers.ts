import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Shared plumbing for the prod-smoke harness (task 1495) — Mailpit /
 * poll-a-file verification-code retrieval, per-run random passwords, the
 * scratch credentials file the EXIT-trap cleanup reads (Codex P1,
 * prod-smoke.sh:175), the real-UI `signIn` used by every step that needs to
 * (re)authenticate, and driving the REAL `bb` CLI binary as a subprocess for
 * the browser-handoff login step. Kept separate from the spec file so the
 * flow steps stay readable. Also imported directly by
 * `scripts/prod-smoke.sh`'s EXIT-trap cleanup driver
 * (`cleanup-account.ts`) — nothing in this file may log a password.
 */

// ─── ANSI ───────────────────────────────────────────────────────────────────

/** `colored` (Rust) normally disables ANSI codes when stdout isn't a TTY (which
 *  it never is under `child_process.spawn`), but strip defensively so a
 *  regex match can never be split by an escape sequence. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// ─── Verification code ──────────────────────────────────────────────────────

export type VerificationCodeSource = 'mailpit' | 'file'

/**
 * Read the 6-digit email-verification code for `email`.
 *
 * - `mailpit` (default, local target): polls the local Mailpit REST API
 *   (`docker compose up -d mailpit`, task 1448 — SMTP :1025, REST :8025) for
 *   the message the API just sent and regexes the plaintext body. This is
 *   the "dev mail sink" the task file names.
 * - `file` (prod target, Codex P1 prod-smoke.sh:269): no admin endpoint
 *   exists yet to read a prod verification code programmatically (that's the
 *   seam a follow-up task wires up), and the code cannot exist before THIS
 *   test's own step 1 creates the account — so there is no way to supply it
 *   up front. Instead this POLLS `E2E_PROD_VERIFICATION_CODE_FILE` (a path
 *   inside the run's scratch dir, printed by `scripts/prod-smoke.sh` before
 *   Playwright starts) for up to `timeoutMs` (default 10 minutes), so the
 *   lead has time to read the code from whatever admin/API path applies and
 *   `echo <code> > <path>`. Prints a periodic reminder (every 30s) so the
 *   wait is visible in the driver's tee'd log, not just a silent hang.
 */
export async function readVerificationCode(
  email: string,
  opts: { source: VerificationCodeSource; mailpitUrl?: string; timeoutMs?: number },
): Promise<string> {
  if (opts.source === 'file') {
    const filePath = process.env.E2E_PROD_VERIFICATION_CODE_FILE
    if (!filePath) {
      throw new Error(
        'E2E_VERIFICATION_SOURCE=file but E2E_PROD_VERIFICATION_CODE_FILE is not set. ' +
          'scripts/prod-smoke.sh sets this for --target prod — running this file directly ' +
          'requires exporting it yourself first.',
      )
    }
    const timeoutMs = opts.timeoutMs ?? 10 * 60_000
    const deadline = Date.now() + timeoutMs
    console.log(
      `[prod-smoke] waiting for the verification code for ${email} — write it to: ${filePath}\n` +
        `[prod-smoke]   e.g.: echo 123456 > '${filePath}'`,
    )
    let lastReminder = Date.now()
    while (Date.now() < deadline) {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8').trim()
        const m = raw.match(/(\d{4,8})/)
        if (m) return m[1]
      }
      if (Date.now() - lastReminder >= 30_000) {
        const remainingSecs = Math.max(0, Math.round((deadline - Date.now()) / 1000))
        console.log(
          `[prod-smoke] still waiting for the verification code for ${email} at ${filePath} (~${remainingSecs}s left)…`,
        )
        lastReminder = Date.now()
      }
      await new Promise((r) => setTimeout(r, 2_000))
    }
    throw new Error(`no verification code appeared at ${filePath} for ${email} within ${timeoutMs}ms`)
  }

  const mailpitUrl = opts.mailpitUrl ?? 'http://localhost:8025'
  const timeoutMs = opts.timeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const searchRes = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      )
      if (searchRes.ok) {
        const data = (await searchRes.json()) as { messages?: Array<{ ID: string }> }
        const first = data.messages?.[0]
        if (first) {
          const msgRes = await fetch(`${mailpitUrl}/api/v1/message/${first.ID}`)
          if (msgRes.ok) {
            const msg = (await msgRes.json()) as { Text?: string }
            const text = msg.Text ?? ''
            const m = text.match(/account:\s*(\d{4,8})/i) ?? text.match(/(\d{6})/)
            if (m) return m[1]
            lastError = `found a message for ${email} but no code pattern matched its body`
          }
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 750))
  }
  throw new Error(
    `no verification email for ${email} arrived at Mailpit (${mailpitUrl}) within ${timeoutMs}ms` +
      (lastError ? ` — last error: ${lastError}` : ''),
  )
}

// ─── Per-run random passwords ───────────────────────────────────────────────

/**
 * A random per-run password (task 1495, Codex extra #4: no fixed passwords
 * committed). At least one lower/upper/digit/symbol char is forced so the
 * result clears any plausible client-side complexity check, on top of the
 * server's `password.len() < 12` gate (`beebeeb-api/src/routes/auth.rs`).
 * Ambiguous characters (`0/O`, `1/l/I`) are excluded — this string is never
 * displayed to a human, but it IS occasionally typed back by Playwright
 * `.fill()`, so keeping it copy-paste-safe costs nothing. NEVER log the
 * return value.
 */
export function randomPassword(length = 24): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%^&*-_=+?'
  const all = lower + upper + digits + symbols
  const pick = (charset: string) => charset[crypto.randomInt(charset.length)]
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)]
  while (chars.length < length) chars.push(pick(all))
  // Fisher-Yates — the four forced-class chars would otherwise always sit in
  // positions 0-3.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

// ─── Scratch credentials file (EXIT-trap cleanup handoff) ──────────────────

/**
 * Persist the run's current {email, password} to
 * `E2E_SMOKE_CREDENTIALS_FILE` (set only for `--target prod` by
 * `scripts/prod-smoke.sh`; a no-op for `--target local`, which cleans up via
 * a direct DB delete instead — see that script's header). This is the "per-
 * run credentials held in memory or scratch" the EXIT trap's
 * `cleanup-account.ts` signs in fresh with if the run aborts before step 10
 * deletes the account itself (Codex P1, prod-smoke.sh:175). Called once right
 * after signup (the initial password) and again right after the password
 * change (test 8) — always the CURRENTLY VALID password, so a trap firing at
 * any point in between has what it needs. 0600 perms: this file holds a live
 * production password, however short-lived. Never logged.
 */
export function writeSmokeCredentials(email: string, password: string): void {
  const filePath = process.env.E2E_SMOKE_CREDENTIALS_FILE
  if (!filePath) return
  fs.writeFileSync(filePath, JSON.stringify({ email, password }), { mode: 0o600 })
}

/**
 * Delete the scratch credentials file — called as the LAST action of test 10
 * once the account is confirmed deleted, so the EXIT trap sees "no
 * credentials file" and correctly no-ops instead of re-deleting an
 * already-deleted account.
 */
export function clearSmokeCredentials(): void {
  const filePath = process.env.E2E_SMOKE_CREDENTIALS_FILE
  if (!filePath) return
  fs.rmSync(filePath, { force: true })
}

// ─── Real-UI sign-in ─────────────────────────────────────────────────────────

/**
 * Sign in via the real /login UI — NOT `e2e/helpers/auth.ts`'s
 * `loginAndProvision`. Found the hard way (task 1495 notes): that shared
 * helper's `getByLabel(/^password$/i)` times out because
 * `src/pages/login.tsx`'s Password `<label>` has no `htmlFor`/wrapping
 * association with its `<input>` — a real, pre-existing bug (the helper's
 * only other caller, auth.spec.ts, is gated behind an env var that's
 * essentially never set, so this path silently went unexercised). Matches the
 * working pattern `cli-auth-redirect.spec.ts` already uses for exactly this
 * reason: target the password field by placeholder.
 *
 * Handles both branches — an existing vault (password-only) or a fresh
 * browser context with no vault (DeviceProvision: recovery-phrase prompt) —
 * exactly like `loginAndProvision`, just with selectors that actually work.
 * `recoveryPhrase` is optional because a caller that only needs an
 * authenticated SESSION (the EXIT-trap cleanup calling the account-delete
 * API, not the UI) doesn't need to restore the vault at all — the session
 * cookie is already set the moment either branch is reached.
 */
export async function signIn(
  page: Page,
  opts: { email: string; password: string; recoveryPhrase?: string },
): Promise<'drive' | 'provision'> {
  await page.goto('/login')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })
  await page.getByLabel(/email/i).fill(opts.email)
  await page.getByPlaceholder('Your password').fill(opts.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // Task 1528: DeviceProvision is now 12 individually-labeled word boxes,
  // not one textarea — box 1 accepts a full space-separated paste and
  // splits it across all 12 (device-provision.tsx applyWords).
  const phraseInput = page.getByLabel('Recovery word 1', { exact: true })
  const driveReached = page
    .waitForURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    .then(() => 'drive' as const)
    .catch(() => null)
  const provisionShown = phraseInput
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => 'provision' as const)
    .catch(() => null)
  const winner = await Promise.race([driveReached, provisionShown])

  if (winner === 'drive') return 'drive'
  if (winner !== 'provision') {
    throw new Error('signIn: did not reach the drive or the DeviceProvision recovery-phrase prompt')
  }
  if (!opts.recoveryPhrase) {
    // Callers that only need the session (no vault restore) stop here.
    return 'provision'
  }
  await phraseInput.fill(opts.recoveryPhrase)
  await page.getByRole('button', { name: /restore vault/i }).click()
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
  return 'drive'
}

// ─── CLI subprocess (bb login --headless) ──────────────────────────────────

export interface CliLoginHandle {
  proc: ChildProcessWithoutNullStreams
  /** Poll the CLI's captured stdout/stderr for the printed authorization URL. */
  waitForAuthUrl(timeoutMs?: number): Promise<{ url: string; code: string }>
  /** Wait for `bb login` to exit after the browser step authorizes it. */
  waitForExit(timeoutMs?: number): Promise<{ exitCode: number | null; output: string }>
  getOutput(): string
}

/**
 * Spawn the REAL `bb login --headless` as a child process against an
 * isolated `HOME` (never the operator's real `~`, which holds a live prod
 * CLI session — see the workspace CLAUDE.md's HOME-isolation rule). Returns
 * a handle to read the printed `verification_uri` and to await completion
 * once the browser step (driven separately, in the same Playwright test)
 * authorizes it.
 */
export function spawnCliLogin(cliBin: string, home: string, apiUrl: string): CliLoginHandle {
  const proc = spawn(cliBin, ['login', '--headless', '--api', apiUrl], {
    env: { ...process.env, HOME: home, BB_NO_UPDATE: '1' },
  })
  let buf = ''
  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
  })
  proc.stderr.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
  })

  return {
    proc,
    async waitForAuthUrl(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const clean = stripAnsi(buf)
        const m = clean.match(/https?:\/\/\S*\/cli-auth\?code=([A-Z0-9-]+)/)
        if (m) return { url: m[0], code: m[1] }
        if (proc.exitCode !== null) {
          throw new Error(`bb login exited early (code ${proc.exitCode}) before printing a URL:\n${clean}`)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      throw new Error(`bb login did not print an authorization URL within ${timeoutMs}ms. Output so far:\n${stripAnsi(buf)}`)
    },
    async waitForExit(timeoutMs = 20_000) {
      if (proc.exitCode !== null) return { exitCode: proc.exitCode, output: stripAnsi(buf) }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          reject(new Error(`bb login did not exit within ${timeoutMs}ms. Output so far:\n${stripAnsi(buf)}`))
        }, timeoutMs)
        proc.once('close', (code) => {
          clearTimeout(t)
          resolve({ exitCode: code, output: stripAnsi(buf) })
        })
      })
    },
    getOutput: () => stripAnsi(buf),
  }
}

/** Run a `bb` subcommand to completion (e.g. `bb ls`) against the isolated HOME. */
export function runCli(cliBin: string, args: string[], home: string, apiUrl: string): string {
  return execFileSync(cliBin, [...args, '--api', apiUrl], {
    env: { ...process.env, HOME: home, BB_NO_UPDATE: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/**
 * Read the `session_token` the CLI just persisted, for the post-delete "the
 * API returns 401" check. macOS-only path (`dirs::config_dir()` under an
 * isolated `HOME` — see repos/cli/CLAUDE.md "Config").
 */
export function readCliSessionToken(home: string): string | null {
  const configPath = path.join(home, 'Library', 'Application Support', 'beebeeb', 'config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { session_token?: string }
    return data.session_token ?? null
  } catch {
    return null
  }
}
