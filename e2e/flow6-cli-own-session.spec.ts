import { test, expect, type Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Flow "CLI end to end", fix 2 — the CLI must get its OWN session.
 *
 * Before this fix, /cli-auth encrypted the BROWSER's own session token into
 * the ECDH payload, so after `bb login`:
 *   - the CLI's config held the browser's `bb_session` cookie value,
 *   - `bb logout` (POST /auth/logout with that token) signed the browser out,
 *   - "Revoke" in Settings could not target the CLI alone — there was no
 *     separate CLI session to revoke.
 *
 * This spec drives the REAL chain: a real `bb` binary (E2E_BB_BIN) with a
 * scratch HOME, the real /cli-auth page, and the real API. It asserts:
 *   1. after approval the CLI token != the approving browser's cookie, and the
 *      server resolves it to its own session row (device_kind `cli`,
 *      "CLI (bb)") — exactly one such row exists;
 *   2. after `bb logout` the browser's GET /api/v1/auth/me is still 200;
 *   3. revoking the CLI's session in Settings → Security makes `bb ls` fail
 *      with a re-login hint, while the browser stays signed in.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const BB_BIN = process.env.E2E_BB_BIN ?? ''

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 10_000 })
    .toBe(true)
}

async function browserSessionCookie(page: Page): Promise<string> {
  const c = (await page.context().cookies()).find((x) => x.name === 'bb_session')
  if (!c) throw new Error('no bb_session cookie in the browser context')
  return c.value
}

type AccountSession = { id: string; device_kind: string; device_name: string; is_current: boolean }

/** GET /api/v1/account/sessions as the browser (cookie session). */
async function accountSessions(page: Page): Promise<AccountSession[]> {
  const res = await page.request.get(`${API_URL}/api/v1/account/sessions`)
  expect(res.status()).toBe(200)
  return ((await res.json()) as { sessions: AccountSession[] }).sessions
}

/** GET /api/v1/account/sessions with a bare Bearer token (no browser cookies). */
async function accountSessionsAs(token: string): Promise<AccountSession[]> {
  const res = await fetch(`${API_URL}/api/v1/account/sessions`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.status, 'the CLI token must authenticate on its own').toBe(200)
  return ((await res.json()) as { sessions: AccountSession[] }).sessions
}

function bbEnv(home: string): NodeJS.ProcessEnv {
  // Scratch HOME: the real config holds a live prod session — never touch it.
  // XDG_CONFIG_HOME pinned too, so a Linux runner resolves inside the scratch dir.
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    BB_LOGIN_HEADLESS: '1',
    NO_COLOR: '1',
  }
}

function bbConfig(home: string): { session_token?: string } {
  const candidates = [
    join(home, 'Library', 'Application Support', 'beebeeb', 'config.json'),
    join(home, '.config', 'beebeeb', 'config.json'),
  ]
  const path = candidates.find((p) => existsSync(p))
  if (!path) throw new Error(`no bb config.json under ${home}`)
  return JSON.parse(readFileSync(path, 'utf8')) as { session_token?: string }
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

    await page.goto(`${WEB_URL}/cli-auth?code=${code}`)
    await page.getByRole('button', { name: /authorize cli access/i }).click()
    await expect(page.getByText('CLI authorized')).toBeVisible({ timeout: 20_000 })

    const rc = await Promise.race([
      exited,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error(`bb login did not exit; output:\n${out}`)), 30_000)),
    ])
    expect(rc, `bb login output:\n${out.replace(ANSI_RE, '')}`).toBe(0)
  } finally {
    if (child.exitCode === null) child.kill()
  }
}

test.describe('flow 6 fix 2: bb login mints the CLI its own, separately revocable session', () => {
  test.skip(!BB_BIN || !existsSync(BB_BIN), 'Set E2E_BB_BIN to a built bb binary to run this spec.')

  let home = ''
  test.beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bb-flow6-cli-home-'))
  })
  test.afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
  })

  test('approval gives the CLI a distinct session; bb logout leaves the browser signed in', async ({ page }) => {
    await devLogin(page, `cli-own-session-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`)

    await bbLoginViaBrowser(page, home)

    // NB: every page load in the Vite dev build runs /dev/auto-login and mints
    // a fresh browser session, so a raw session COUNT is meaningless here and a
    // cookie read before /cli-auth is already stale. Compare against the
    // browser session that approved (the cookie now in the jar) and ask the
    // server which session each credential actually is.
    const cookie = await browserSessionCookie(page)
    const cliToken = bbConfig(home).session_token
    expect(cliToken, 'bb config must hold a session token after login').toBeTruthy()
    expect(cliToken, 'the CLI must NOT hold a copy of the browser session cookie').not.toBe(cookie)

    const browserView = await accountSessions(page)
    const browserCurrent = browserView.find((s) => s.is_current)
    expect(browserCurrent, 'the browser must see its own current session').toBeTruthy()
    expect(
      browserView.filter((s) => s.device_kind === 'cli').length,
      'exactly one CLI session must exist after one bb login',
    ).toBe(1)

    // Seen from the CLI's own credential: its current session is the CLI row,
    // not the browser's.
    const cliView = await accountSessionsAs(cliToken!)
    const cliCurrent = cliView.find((s) => s.is_current)
    expect(cliCurrent?.device_kind, "the CLI's token must be a session of its own kind").toBe('cli')
    expect(cliCurrent?.device_name).toBe('CLI (bb)')
    expect(cliCurrent?.id, 'the CLI must not share the browser session row').not.toBe(browserCurrent!.id)

    const logout = runBb(home, ['logout'])
    expect(logout.rc, logout.out).toBe(0)

    const me = await page.request.get(`${API_URL}/api/v1/auth/me`)
    expect(me.status(), 'bb logout must not sign the browser out').toBe(200)
    expect(
      (await accountSessions(page)).filter((s) => s.device_kind === 'cli').length,
      'bb logout must end the CLI session',
    ).toBe(0)
  })

  test('revoking the CLI session in Settings signs out only the CLI', async ({ page }) => {
    await devLogin(page, `cli-revoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`)

    await bbLoginViaBrowser(page, home)
    const before = runBb(home, ['ls'])
    expect(before.rc, `bb ls before revoke:\n${before.out}`).toBe(0)

    await page.goto(`${WEB_URL}/settings/security`)
    // The row container (bg-paper-2) that holds the "CLI (bb)" label and its Revoke button.
    const cliRow = page
      .getByText('CLI (bb)', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"bg-paper-2")][1]')
    await expect(cliRow).toBeVisible({ timeout: 15_000 })
    await cliRow.getByRole('button', { name: 'Revoke' }).click()
    await page.getByRole('button', { name: 'Confirm revoke' }).click()
    await expect(page.getByText('Session revoked')).toBeVisible({ timeout: 10_000 })

    const after = runBb(home, ['ls'])
    expect(after.rc, `bb ls after revoke must fail:\n${after.out}`).not.toBe(0)
    expect(after.out, 'bb must tell the user how to sign back in').toMatch(/bb login/)

    const me = await page.request.get(`${API_URL}/api/v1/auth/me`)
    expect(me.status(), 'revoking the CLI must not sign the browser out').toBe(200)
  })
})
