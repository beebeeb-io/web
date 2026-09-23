import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Shared plumbing for the prod-smoke harness (task 1495) — Mailpit
 * verification-code retrieval and driving the REAL `bb` CLI binary as a
 * subprocess for the browser-handoff login step. Kept separate from the spec
 * file so the flow steps stay readable.
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

export type VerificationCodeSource = 'mailpit' | 'manual'

/**
 * Read the 6-digit email-verification code for `email`.
 *
 * - `mailpit` (default, local target): polls the local Mailpit REST API
 *   (`docker compose up -d mailpit`, task 1448 — SMTP :1025, REST :8025) for
 *   the message the API just sent and regexes the plaintext body. This is
 *   the "dev mail sink" the task file names.
 * - `manual` (prod target): the lead reads the code through whatever admin/
 *   API path they choose (task 1495's "on prod from the admin/API path the
 *   lead chooses") and exports it as `E2E_PROD_VERIFICATION_CODE` before
 *   invoking the driver. This function only reads that env var — it does
 *   not print anything or take any prod action itself. Kept pluggable
 *   (rather than hardcoding a specific admin endpoint) because no such
 *   endpoint exists yet; this is the seam a follow-up task wires up.
 */
export async function readVerificationCode(
  email: string,
  opts: { source: VerificationCodeSource; mailpitUrl?: string; timeoutMs?: number },
): Promise<string> {
  if (opts.source === 'manual') {
    const code = process.env.E2E_PROD_VERIFICATION_CODE
    if (!code) {
      throw new Error(
        'E2E_VERIFICATION_SOURCE=manual but E2E_PROD_VERIFICATION_CODE is not set. ' +
          'Read the code via whatever admin/API path applies on this target, then export it.',
      )
    }
    return code
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
