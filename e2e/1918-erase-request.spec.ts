import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { NEW_PW, makeAccount, guestPage } from './helpers/reset-2fa'
import { dropSessionKeepVault } from './helpers/after-password-change'
import { uploadTextFile } from './helpers/drive'

/**
 * Task 1918 [P0] — the locked screen's "Erase all files" cannot make files go missing.
 *
 * Guus, 2026-10-17: "Files should NEVER go missing" / "the code and all apps should just not
 * delete random stuff". The real path a locked-out person takes: sign up, upload, lose the
 * session, reset the password BY EMAIL, choose "I've lost my recovery phrase", and reach the
 * locked screen with the fresh password. From there:
 *
 *   1. typing the server's item count + the password files an erase REQUEST; the card shows it
 *      pending with its due time and a Cancel button; the owner gets the email (console
 *      provider) with the one-click link; the link cancels it in a fresh, signed-out browser;
 *      the locked screen is back to normal. Not one request to /files/permanent or /files/trash.
 *   2. a second account: the request's due time is moved into the past in the scratch DB, the
 *      API's own worker runs, every file is in the TRASH and not one row is deleted.
 *
 * Environment (the lane ran it this way; nothing here touches prod):
 *   - API: built from the server 1918 branch (debug), console email provider, workers ON,
 *     BB_RATE_LIMIT_DISABLED=1, APP_URL + CORS_ORIGINS = this web origin, its own scratch DB.
 *   - Vite: `VITE_API_URL=<api> bunx vite --port <port>`; E2E_WEB_URL / E2E_API_URL point at them.
 *   - E2E_1918_SQL_CMD: a shell command that reads SQL on stdin and runs it against the API's
 *     scratch DB, printing unaligned tuples (`psql -At`).
 *   - E2E_1918_MAIL_LOG_CMD: a shell command that prints the API's log (the console provider
 *     writes each email there, links included, in debug builds).
 *   Run: bunx playwright test --config=e2e/1918-erase-request.config.ts
 * Screenshots: E2E_EVIDENCE_DIR (default test-results/1918), each at 1440 and 390 wide.
 */

const SQL_CMD = process.env.E2E_1918_SQL_CMD
const MAIL_LOG_CMD = process.env.E2E_1918_MAIL_LOG_CMD
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1918'
fs.mkdirSync(SHOTS, { recursive: true })

test.skip(!SQL_CMD || !MAIL_LOG_CMD, 'needs the 1918 stack: E2E_1918_SQL_CMD and E2E_1918_MAIL_LOG_CMD')
test.describe.configure({ mode: 'serial', retries: 0 })

function sql(statement: string): string {
  return execSync(SQL_CMD!, { input: statement, encoding: 'utf8' }).trim()
}

function mailLog(): string {
  return execSync(MAIL_LOG_CMD!, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
}

/** Every console-provider email block written after `offset`, newest last. */
function mailsSince(offset: number): string[] {
  const text = mailLog().slice(offset)
  return [...text.matchAll(/--- EMAIL \(console mode\) ---([\s\S]*?)--- END EMAIL ---/g)].map((m) => m[1])
}

async function waitForMail(offset: number, subject: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = mailsSince(offset).filter((m) => m.includes(`Subject: ${subject}`)).pop()
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no "${subject}" email in the API log within ${timeoutMs} ms`)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(SHOTS, `${name}-1440.png`), fullPage: true })
  const was = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOTS, `${name}-390.png`), fullPage: true })
  if (was) await page.setViewportSize(was)
}

/** Every request this page sends, for the "nothing destructive" assertions. */
function recordRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (r) => seen.push(`${r.method()} ${new URL(r.url()).pathname}`))
  return seen
}

/** Live rows the server counts for the account: what the person must type. It can exceed the
 *  files uploaded here (an unfinished upload row is live too, and is trashed with the rest). */
function liveItems(userId: string): number {
  return Number(sql(`SELECT count(*) FROM files WHERE user_id = '${userId}' AND NOT is_trashed`))
}

/** Upload one file and wait until the SERVER has it complete (a reload before that would abort
 *  the upload and leave a half-made row). */
async function uploadComplete(page: Page, userId: string, filename: string): Promise<void> {
  const done = () => Number(sql(`SELECT count(*) FROM files WHERE user_id = '${userId}' AND NOT is_folder AND NOT is_uploading`))
  const before = done()
  await uploadTextFile(page, filename, `contents of ${filename}`)
  for (let i = 0; i < 120 && done() <= before; i++) await page.waitForTimeout(500)
  expect(done()).toBe(before + 1)
}

/** Sign up, upload `files`, then take the real email reset into the locked screen. */
async function reachLockedScreen(page: Page, prefix: string, files: string[]): Promise<{ email: string; userId: string }> {
  const { email } = await makeAccount(page, prefix, false)
  const userId = sql(`SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}'`)
  expect(userId).toMatch(/^[0-9a-f-]{36}$/)
  await page.goto('/')
  for (const f of files) await uploadComplete(page, userId, f)

  // The session on this device ends; the person asks for a reset by email.
  await dropSessionKeepVault(page)
  const offset = mailLog().length
  await page.goto('/forgot-password?nodev=1')
  await page.getByPlaceholder('you@example.com').fill(email)
  const sent = page.waitForResponse((r) => r.url().includes('/api/v1/auth/forgot-password'))
  await page.locator('button[type=submit]').first().click()
  expect((await sent).status()).toBe(200)
  const resetMail = mailsSince(offset).find((m) => /\/set-password\/[A-Za-z0-9_-]+/.test(m)) ??
    (await (async () => {
      for (let i = 0; i < 60; i++) {
        const m = mailsSince(offset).find((x) => /\/set-password\/[A-Za-z0-9_-]+/.test(x))
        if (m) return m
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error('no set-password email in the API log')
    })())
  const token = resetMail.match(/\/set-password\/([A-Za-z0-9_-]+)/)![1]

  await page.goto(`/set-password/${token}`)
  await page.getByLabel('New password').fill(NEW_PW)
  await page.getByLabel('Confirm password').fill(NEW_PW)
  await page.getByRole('button', { name: /set new password/i }).click()
  await page.getByRole('button', { name: /I've lost my recovery phrase/i }).click({ timeout: 45_000 })
  await expect(page.getByText('Vault locked').first()).toBeVisible()
  await expect(page.getByTestId('erase-request-card')).toBeVisible()
  // The cookie notice is fixed over the page; answer it so the screenshots show the card.
  const essential = page.getByRole('button', { name: 'Essential only' })
  if (await essential.isVisible().catch(() => false)) await essential.click()
  return { email, userId }
}

async function requestErase(page: Page, items: number): Promise<void> {
  const card = page.getByTestId('erase-request-card')
  await expect(card).toContainText(`This account holds ${items} items`, { timeout: 20_000 })
  const input = page.getByTestId('erase-count-input')
  const button = page.getByTestId('erase-request-button')
  await expect(button).toBeDisabled()
  await input.fill(String(items - 1))
  await expect(button).toBeDisabled()
  await input.fill(String(items))
  await expect(button).toBeEnabled()
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Confirm your identity' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Nothing moves for 72 hours')
  await dialog.getByPlaceholder('Your password').fill(NEW_PW)
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/account/erase-request') && r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Request erase' }).click()
  expect((await created).status()).toBe(201)
  await expect(page.getByTestId('erase-pending')).toBeVisible({ timeout: 20_000 })
}

test('locked screen: request the erase, see it pending, get the email, cancel by the link', async ({ page, browser }) => {
  const files = ['one.txt', 'two.txt', 'three.txt']
  const { email, userId } = await reachLockedScreen(page, '1918-cancel', files)
  const requests = recordRequests(page)
  await shot(page, '01-locked-screen-ask')

  const items = liveItems(userId)
  expect(items).toBeGreaterThanOrEqual(files.length)
  const offset = mailLog().length
  await requestErase(page, items)

  // Pending: the due time 72 h out, the count, the Cancel button.
  const pending = page.getByTestId('erase-pending')
  await expect(pending).toContainText('Erase requested.')
  await expect(pending).toContainText(`(${items} items) moves to the trash`)
  await expect(page.getByTestId('erase-cancel-button')).toBeVisible()
  const row = sql(
    `SELECT status, item_count, round(extract(epoch FROM due_at - requested_at) / 3600) FROM account_erase_requests WHERE user_id = '${userId}'`,
  )
  expect(row).toBe(`pending|${items}|72`)
  await shot(page, '02-pending-with-due-time')

  // The owner's email, from the dev (console) provider.
  const mail = await waitForMail(offset, 'Your Beebeeb files are set to move to the trash')
  fs.writeFileSync(path.join(SHOTS, '03-dev-email.txt'), mail.trim() + '\n')
  expect(mail).toContain(`(${items} items)`)
  expect(mail).toContain('moves to the trash')
  const link = mail.match(/(https?:\/\/\S+\/erase-request\/cancel#t=[A-Za-z0-9_-]+)/)![1]
  const base = new URL(page.url()).origin
  const linkHere = base + link.slice(link.indexOf('/erase-request/cancel'))
  const logged = sql(`SELECT kind, provider, status FROM email_events WHERE user_id = '${userId}' AND kind = 'account.erase_request'`)
  expect(logged).toBe('account.erase_request|console|sent')

  // Nothing destructive left this page: no trash, no permanent delete.
  expect(requests.filter((r) => r.includes('/files/permanent') || r.includes('/files/trash'))).toEqual([])
  expect(requests.filter((r) => r.startsWith('POST /api/v1/account/erase-request'))).toEqual([
    'POST /api/v1/account/erase-request',
  ])

  // The link, opened in a fresh signed-out browser, cancels it.
  const guest = await guestPage(browser)
  await guest.setViewportSize({ width: 1440, height: 900 })
  const guestRequests = recordRequests(guest)
  await guest.goto(linkHere)
  await expect(guest.getByTestId('erase-link-cancelled')).toBeVisible({ timeout: 20_000 })
  const guestEssential = guest.getByRole('button', { name: 'Essential only' })
  if (await guestEssential.isVisible().catch(() => false)) await guestEssential.click()
  expect(new URL(guest.url()).hash).toBe('')
  // API calls only (the dev server also serves source modules under /packages/shared/src/api/).
  expect(guestRequests.filter((r) => r.includes(' /api/v1/'))).toEqual([
    'POST /api/v1/account/erase-request/cancel-by-token',
  ])
  await shot(guest, '04-link-cancelled')
  expect(sql(`SELECT status, cancelled_via FROM account_erase_requests WHERE user_id = '${userId}'`)).toBe(
    'cancelled|email_link',
  )

  // Used once: the same link again (a second click opens a new tab) says so.
  const again = await guest.context().newPage()
  await again.setViewportSize({ width: 1440, height: 900 })
  await again.goto(linkHere)
  await expect(again.getByTestId('erase-link-invalid')).toBeVisible({ timeout: 20_000 })
  await shot(again, '05-link-used-again')
  await guest.context().close()

  // Back on the locked screen: nothing pending, nothing moved, the ask state again. (Not a
  // reload: the address is still the spent /set-password link; `/` is the locked screen.)
  await page.goto('/')
  await expect(page.getByTestId('erase-request-card')).toContainText(`This account holds ${items} items`, {
    timeout: 30_000,
  })
  await expect(page.getByTestId('erase-pending')).toHaveCount(0)
  expect(sql(`SELECT count(*) FILTER (WHERE NOT is_trashed), count(*) FROM files WHERE user_id = '${userId}'`)).toBe(
    `${items}|${items}`,
  )
  await shot(page, '06-back-to-normal')
  test.info().annotations.push({ type: 'account', description: email })
})

test('a second account: the due time passes, the worker moves every file to the trash, nothing is deleted', async ({ page }) => {
  const files = ['alpha.txt', 'beta.txt', 'gamma.txt', 'delta.txt']
  const { userId } = await reachLockedScreen(page, '1918-execute', files)
  const requests = recordRequests(page)
  const items = liveItems(userId)
  expect(items).toBeGreaterThanOrEqual(files.length)
  await requestErase(page, items)

  // Cancel from the screen is offered; we let it run instead.
  const rowsBefore = Number(sql(`SELECT count(*) FROM files WHERE user_id = '${userId}'`))
  expect(rowsBefore).toBe(items)

  // Fast-forward: the request is due now (scratch DB only), then the API's own worker runs.
  sql(`UPDATE account_erase_requests SET due_at = now() - interval '1 second' WHERE user_id = '${userId}' AND status = 'pending'`)
  await page.goto('/')
  // The worker may already be done by the time the page asks; either way no Cancel is offered.
  const movingOrDone = page.getByTestId('erase-moving').or(page.getByTestId('erase-done'))
  await expect(movingOrDone).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('erase-cancel-button')).toHaveCount(0)
  if (await page.getByTestId('erase-moving').isVisible()) await shot(page, '07-due-moving-to-trash')

  let status = ''
  for (let i = 0; i < 120; i++) {
    status = sql(`SELECT status FROM account_erase_requests WHERE user_id = '${userId}'`)
    if (status === 'executed') break
    await page.waitForTimeout(1000)
  }
  expect(status).toBe('executed')

  // Every file is in the trash; not one row was deleted.
  const after = sql(
    `SELECT count(*), count(*) FILTER (WHERE is_trashed), count(*) FILTER (WHERE NOT is_trashed) FROM files WHERE user_id = '${userId}'`,
  )
  expect(after).toBe(`${rowsBefore}|${rowsBefore}|0`)
  expect(sql(`SELECT items_trashed FROM account_erase_requests WHERE user_id = '${userId}'`)).toBe(String(rowsBefore))
  expect(sql(`SELECT count(*) FROM audit_log WHERE user_id = '${userId}' AND event = 'account.erase_request.executed'`)).toBe('1')

  await page.goto('/')
  await expect(page.getByTestId('erase-done')).toContainText(`${items} items moved to the trash`, {
    timeout: 30_000,
  })
  await shot(page, '08-done-in-the-trash')
  expect(requests.filter((r) => r.includes('/files/permanent') || r.includes('/files/trash'))).toEqual([])
  fs.writeFileSync(
    path.join(SHOTS, '09-db-before-after.txt'),
    `user ${userId}\nfile rows before: ${rowsBefore}\nafter (rows|trashed|live): ${after}\n`,
  )
})
