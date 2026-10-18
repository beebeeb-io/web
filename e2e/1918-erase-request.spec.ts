import { test, expect, type Browser, type Page } from '@playwright/test'
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
 * delete random stuff". Round 3, Guus 2026-10-18: "Mm erase all files then requires email
 * verify" / "Verify link + 72 h". The real path a locked-out person takes: sign up, upload, lose
 * the session, reset the password BY EMAIL, choose "I've lost my recovery phrase", and reach the
 * locked screen with the fresh password. From there:
 *
 *   1. typing the server's item count + the password files an erase REQUEST that waits for the
 *      email: the card says "check your email to confirm" and nothing has a due time. The
 *      owner's email (console provider) holds a confirmation link and a cancel link. Opened in a
 *      fresh, signed-out browser, the confirmation page does NOT act on load; one click confirms,
 *      the page shows the due time (confirmation + 72 h), a confirmation email follows, and the
 *      locked screen shows the due time with Cancel. Cancel there; nothing moved. A second request
 *      is confirmed and cancelled from the confirmation page's own Cancel button. A third is left
 *      unconfirmed past its 24 hours: the API's worker lets it lapse, the locked screen says the
 *      confirmation link expired, and the link itself says so. Not one request to
 *      /files/permanent or /files/trash from the locked screen.
 *   2. a second account: request, confirm by the link, the due time is moved into the past in
 *      the scratch DB, the API's own worker runs, every file is in the TRASH, not one row is
 *      deleted, and the owner gets the "moved to the trash" email exactly once. Round 4: the
 *      locked screen's "Restore everything from the erase on <date>" brings every row back.
 *
 * Round 4 also proves: the cancel link waits for a click (no API call on load), and a reload of
 * either link page after it read the token says "Open the link from your email again".
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

const NOTICE_SUBJECT = 'Confirm: erase all files in your Beebeeb account?'
const CONFIRMED_SUBJECT = 'Confirmed: your Beebeeb files move to the trash in 72 hours'
const COMPLETED_SUBJECT = 'Your Beebeeb files were moved to the trash'

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
  await dismissCookies(page)
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
  await expect(dialog).toContainText('We then email you a link to confirm it: nothing moves unless you do')
  await dialog.getByPlaceholder('Your password').fill(NEW_PW)
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/account/erase-request') && r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Request erase' }).click()
  expect((await created).status()).toBe(201)
  await expect(page.getByTestId('erase-awaiting')).toBeVisible({ timeout: 20_000 })
}

/** The link in `mail` for `route` ('verify' | 'cancel'), re-based onto this web origin. */
function linkIn(mail: string, route: 'verify' | 'cancel', origin: string): string {
  const m = mail.match(new RegExp(`(https?://\\S+/erase-request/${route}#t=[A-Za-z0-9_-]+)`))
  expect(m, `a /erase-request/${route} link in the email`).not.toBeNull()
  const link = m![1]
  return origin + link.slice(link.indexOf(`/erase-request/${route}`))
}

/** A fresh signed-out browser page at 1440 wide that records its requests. */
async function freshGuest(browser: Browser): Promise<{ guest: Page; requests: string[] }> {
  const guest = await guestPage(browser)
  await guest.setViewportSize({ width: 1440, height: 900 })
  return { guest, requests: recordRequests(guest) }
}

async function dismissCookies(page: Page): Promise<void> {
  const essential = page.getByRole('button', { name: 'Essential only' })
  if (await essential.isVisible().catch(() => false)) await essential.click()
}

/** API calls only (the dev server also serves source modules under /packages/shared/src/api/). */
function apiCalls(requests: string[]): string[] {
  return requests.filter((r) => r.includes(' /api/v1/'))
}

/** Open the confirmation link signed out, prove nothing happens on load, then click Confirm. */
async function confirmByLink(
  browser: Browser,
  verifyLink: string,
  userId: string,
  shots?: { ready: string; verified: string },
): Promise<Page> {
  const { guest, requests } = await freshGuest(browser)
  await guest.goto(verifyLink)
  await expect(guest.getByTestId('erase-verify-ready')).toBeVisible({ timeout: 20_000 })
  await dismissCookies(guest)
  expect(new URL(guest.url()).hash).toBe('')
  // A mail scanner that opens the link and runs the page confirms nothing.
  await guest.waitForTimeout(2_000)
  expect(apiCalls(requests)).toEqual([])
  expect(sql(`SELECT verified_at IS NULL, due_at IS NULL FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`)).toBe('t|t')
  if (shots) await shot(guest, shots.ready)

  const answered = guest.waitForResponse((r) => r.url().endsWith('/api/v1/account/erase-request/verify-by-token'))
  await guest.getByTestId('erase-verify-confirm').click()
  expect((await answered).status()).toBe(200)
  await expect(guest.getByTestId('erase-verify-verified')).toBeVisible({ timeout: 20_000 })
  expect(apiCalls(requests)).toEqual(['POST /api/v1/account/erase-request/verify-by-token'])
  // The 72 hours count from the click.
  expect(
    sql(`SELECT round(extract(epoch FROM due_at - verified_at)) FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`),
  ).toBe('259200')
  if (shots) await shot(guest, shots.verified)
  return guest
}

test('locked screen: request, confirm by the email link, see the due time, cancel; a lapsed link says so', async ({ page, browser }) => {
  const files = ['one.txt', 'two.txt', 'three.txt']
  const { email, userId } = await reachLockedScreen(page, '1918-cancel', files)
  const requests = recordRequests(page)
  await shot(page, '01-locked-screen-ask')
  const origin = new URL(page.url()).origin

  const items = liveItems(userId)
  expect(items).toBeGreaterThanOrEqual(files.length)

  // ── Request 1: awaiting the email click, nothing counts down ──
  let offset = mailLog().length
  await requestErase(page, items)
  const awaiting = page.getByTestId('erase-awaiting')
  await expect(awaiting).toContainText('Check your email to confirm')
  await expect(awaiting).toContainText('Nothing happens unless you confirm')
  await expect(page.getByTestId('erase-pending')).toHaveCount(0)
  expect(
    sql(`SELECT status, item_count, verified_at IS NULL, due_at IS NULL, notice_sent_at IS NOT NULL FROM account_erase_requests WHERE user_id = '${userId}'`),
  ).toBe(`pending|${items}|t|t|t`)
  await shot(page, '02-awaiting-email-confirmation')

  const notice = await waitForMail(offset, NOTICE_SUBJECT)
  fs.writeFileSync(path.join(SHOTS, '03-dev-email-notice.txt'), notice.trim() + '\n')
  expect(notice).toContain('Nothing happens unless you confirm.')
  const verify1 = linkIn(notice, 'verify', origin)
  const cancel1 = linkIn(notice, 'cancel', origin)
  expect(verify1.slice(verify1.indexOf('#t='))).not.toBe(cancel1.slice(cancel1.indexOf('#t=')))
  expect(sql(`SELECT kind, provider, status FROM email_events WHERE user_id = '${userId}' AND kind = 'account.erase_request'`)).toBe(
    'account.erase_request|console|sent',
  )

  // ── Round 4: the cancel link waits for a click (a mail scanner opening it cancels nothing),
  //    and a reload after the page read the token asks for the email link again ──
  {
    const { guest, requests: guestRequests } = await freshGuest(browser)
    await guest.goto(cancel1)
    await expect(guest.getByTestId('erase-link-ready')).toBeVisible({ timeout: 20_000 })
    await dismissCookies(guest)
    expect(new URL(guest.url()).hash).toBe('')
    await guest.waitForTimeout(2_000)
    expect(apiCalls(guestRequests)).toEqual([])
    expect(sql(`SELECT status FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`)).toBe('pending')
    await shot(guest, '03b-cancel-link-waits-for-a-click')
    await guest.reload()
    await expect(guest.getByTestId('erase-link-reopen')).toContainText('Open the cancel link in the email once more')
    await expect(guest.getByText('Open the link from your email again')).toBeVisible()
    expect(apiCalls(guestRequests)).toEqual([])
    await shot(guest, '03c-cancel-link-reloaded')
    await guest.context().close()
  }

  // ── The confirmation link: nothing on load, one click confirms ──
  offset = mailLog().length
  const guest1 = await confirmByLink(browser, verify1, userId, { ready: '04-verify-page-ready', verified: '05-verify-page-confirmed' })
  const confirmed = await waitForMail(offset, CONFIRMED_SUBJECT)
  fs.writeFileSync(path.join(SHOTS, '06-dev-email-confirmed.txt'), confirmed.trim() + '\n')
  linkIn(confirmed, 'cancel', origin)
  expect(
    sql(`SELECT count(*) FROM email_events WHERE user_id = '${userId}' AND kind = 'account.erase_request_confirmed' AND status = 'sent'`),
  ).toBe('1')

  // A second click on the same link changes nothing.
  const dueBefore = sql(`SELECT due_at FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`)
  const again = await guest1.context().newPage()
  await again.setViewportSize({ width: 1440, height: 900 })
  await again.goto(verify1)
  await again.getByTestId('erase-verify-confirm').click()
  await expect(again.getByTestId('erase-verify-already')).toBeVisible({ timeout: 20_000 })
  await shot(again, '07-verify-link-clicked-again')
  expect(sql(`SELECT due_at FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`)).toBe(dueBefore)
  await guest1.context().close()

  // ── The locked screen: the due time and Cancel; cancel there ──
  await page.goto('/')
  const pending = page.getByTestId('erase-pending')
  await expect(pending).toContainText('Erase confirmed.', { timeout: 30_000 })
  await expect(pending).toContainText(`(${items} items) moves to the trash`)
  await shot(page, '08-locked-screen-confirmed-due-time')
  const cancelled = page.waitForResponse((r) => r.url().endsWith('/api/v1/account/erase-request/cancel'))
  await page.getByTestId('erase-cancel-button').click()
  expect((await cancelled).status()).toBe(200)
  await expect(page.getByTestId('erase-note')).toContainText('Cancelled. Nothing will be moved to the trash.', { timeout: 20_000 })
  await expect(page.getByTestId('erase-request-card')).toContainText(`This account holds ${items} items`)
  expect(sql(`SELECT status, cancelled_via FROM account_erase_requests WHERE user_id = '${userId}'`)).toBe('cancelled|session')
  await shot(page, '09-cancelled-on-the-locked-screen')

  // The notice's cancel link is spent now: one click, and the page says it can't cancel anything.
  {
    const { guest, requests: guestRequests } = await freshGuest(browser)
    await guest.goto(cancel1)
    await expect(guest.getByTestId('erase-link-ready')).toBeVisible({ timeout: 20_000 })
    const answered = guest.waitForResponse((r) => r.url().endsWith('/api/v1/account/erase-request/cancel-by-token'))
    await guest.getByTestId('erase-link-cancel').click()
    expect((await answered).status()).toBe(404)
    await expect(guest.getByTestId('erase-link-invalid')).toBeVisible({ timeout: 20_000 })
    expect(apiCalls(guestRequests)).toEqual(['POST /api/v1/account/erase-request/cancel-by-token'])
    await guest.context().close()
  }

  // ── Request 2: confirm, then cancel from the confirmation page itself ──
  offset = mailLog().length
  await requestErase(page, items)
  const notice2 = await waitForMail(offset, NOTICE_SUBJECT)
  const verify2 = linkIn(notice2, 'verify', origin)
  const guest2 = await confirmByLink(browser, verify2, userId)
  const cancelByPage = guest2.waitForResponse((r) => r.url().endsWith('/api/v1/account/erase-request/cancel-by-token'))
  await guest2.getByTestId('erase-verify-cancel').click()
  expect((await cancelByPage).status()).toBe(200)
  await expect(guest2.getByTestId('erase-verify-cancelled')).toBeVisible({ timeout: 20_000 })
  await shot(guest2, '10-verify-page-cancelled')
  await guest2.context().close()
  expect(
    sql(`SELECT status, cancelled_via FROM account_erase_requests WHERE user_id = '${userId}' ORDER BY requested_at DESC LIMIT 1`),
  ).toBe('cancelled|email_link')

  // ── Request 3: never confirmed; past its 24 hours the worker lets it lapse ──
  offset = mailLog().length
  await page.goto('/')
  await requestErase(page, items)
  const notice3 = await waitForMail(offset, NOTICE_SUBJECT)
  const verify3 = linkIn(notice3, 'verify', origin)
  const third = sql(`SELECT id FROM account_erase_requests WHERE user_id = '${userId}' AND status = 'pending'`)
  expect(third).toMatch(/^[0-9a-f-]{36}$/)
  // Round 4: the confirmation page reloaded after it read the token asks for the email link again
  // and confirms nothing.
  {
    const { guest, requests: guestRequests } = await freshGuest(browser)
    await guest.goto(verify3)
    await expect(guest.getByTestId('erase-verify-ready')).toBeVisible({ timeout: 20_000 })
    await dismissCookies(guest)
    await guest.reload()
    await expect(guest.getByTestId('erase-verify-reopen')).toBeVisible({ timeout: 20_000 })
    await expect(guest.getByText('Open the link from your email again')).toBeVisible()
    expect(apiCalls(guestRequests)).toEqual([])
    expect(sql(`SELECT verified_at IS NULL FROM account_erase_requests WHERE id = '${third}'`)).toBe('t')
    await shot(guest, '11b-verify-link-reloaded')
    await guest.context().close()
  }
  sql(
    `UPDATE account_erase_requests SET requested_at = now() - interval '25 hours', notice_sent_at = now() - interval '25 hours' WHERE id = '${third}'`,
  )
  let lapsed = ''
  for (let i = 0; i < 90; i++) {
    lapsed = sql(`SELECT status, cancelled_via FROM account_erase_requests WHERE id = '${third}'`)
    if (lapsed !== 'pending|') break
    await page.waitForTimeout(1000)
  }
  expect(lapsed).toBe('cancelled|verify_expired')
  await page.goto('/')
  await expect(page.getByTestId('erase-expired')).toContainText('The confirmation link of your last request expired', {
    timeout: 30_000,
  })
  await shot(page, '11-locked-screen-link-expired')
  {
    const { guest } = await freshGuest(browser)
    await guest.goto(verify3)
    await guest.getByTestId('erase-verify-confirm').click()
    await expect(guest.getByTestId('erase-verify-expired')).toBeVisible({ timeout: 20_000 })
    await dismissCookies(guest)
    await shot(guest, '12-verify-link-expired')
    await guest.context().close()
  }

  // Nothing moved, and nothing destructive left the locked screen.
  expect(sql(`SELECT count(*) FILTER (WHERE NOT is_trashed), count(*) FROM files WHERE user_id = '${userId}'`)).toBe(
    `${items}|${items}`,
  )
  expect(requests.filter((r) => r.includes('/files/permanent') || r.includes('/files/trash'))).toEqual([])
  expect(sql(`SELECT count(*) FROM email_events WHERE user_id = '${userId}' AND kind = 'account.erase_request_completed'`)).toBe('0')
  test.info().annotations.push({ type: 'account', description: email })
})

test('a second account: confirmed, the due time passes, every file moves to the trash, nothing is deleted, one email says so', async ({ page, browser }) => {
  const files = ['alpha.txt', 'beta.txt', 'gamma.txt', 'delta.txt']
  const { userId } = await reachLockedScreen(page, '1918-execute', files)
  const requests = recordRequests(page)
  const origin = new URL(page.url()).origin
  const items = liveItems(userId)
  expect(items).toBeGreaterThanOrEqual(files.length)
  let offset = mailLog().length
  await requestErase(page, items)
  const notice = await waitForMail(offset, NOTICE_SUBJECT)
  const guest = await confirmByLink(browser, linkIn(notice, 'verify', origin), userId)
  await guest.context().close()

  const rowsBefore = Number(sql(`SELECT count(*) FROM files WHERE user_id = '${userId}'`))
  expect(rowsBefore).toBe(items)

  // Fast-forward: the request is due now (scratch DB only), then the API's own worker runs.
  offset = mailLog().length
  sql(`UPDATE account_erase_requests SET due_at = now() - interval '1 second' WHERE user_id = '${userId}' AND status = 'pending'`)
  await page.goto('/')
  // The worker may already be done by the time the page asks; either way no Cancel is offered.
  const movingOrDone = page.getByTestId('erase-moving').or(page.getByTestId('erase-done'))
  await expect(movingOrDone).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('erase-cancel-button')).toHaveCount(0)
  if (await page.getByTestId('erase-moving').isVisible()) await shot(page, '13-due-moving-to-trash')

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

  // The owner is told, once: moved to the trash, restorable, and where.
  const done = await waitForMail(offset, COMPLETED_SUBJECT, 120_000)
  fs.writeFileSync(path.join(SHOTS, '14-dev-email-completed.txt'), done.trim() + '\n')
  expect(done).toContain('Nothing has been deleted yet.')
  expect(done).toContain(`(${rowsBefore} items)`)
  expect(done).toContain('/trash')
  expect(done).toContain('Restore everything from the erase')
  // Give the worker two more passes to (wrongly) send it again.
  await page.waitForTimeout(125_000)
  expect(mailsSince(offset).filter((m) => m.includes(`Subject: ${COMPLETED_SUBJECT}`))).toHaveLength(1)
  expect(
    sql(`SELECT count(*) FROM email_events WHERE user_id = '${userId}' AND kind = 'account.erase_request_completed' AND status = 'sent'`),
  ).toBe('1')
  expect(sql(`SELECT completion_email_sent_at IS NOT NULL FROM account_erase_requests WHERE user_id = '${userId}'`)).toBe('t')

  await page.goto('/')
  await expect(page.getByTestId('erase-done')).toContainText(`${items} items moved to the trash`, {
    timeout: 30_000,
  })
  await shot(page, '15-done-in-the-trash')

  // ── Round 4: "Restore everything from the erase on <date>", in one action ──
  const restore = page.getByTestId('erase-restore-button')
  await expect(restore).toContainText('Restore everything from the erase on')
  await shot(page, '16-restore-offer')
  const restoreAnswer = page.waitForResponse(
    (r) => /\/api\/v1\/account\/erase-request\/[0-9a-f-]+\/restore$/.test(r.url()) && r.request().method() === 'POST',
  )
  await restore.click()
  expect([200, 202]).toContain((await restoreAnswer).status())
  await expect(page.getByTestId('erase-restore-status')).toContainText('Everything from the erase is back.', { timeout: 150_000 })
  const back = sql(
    `SELECT count(*), count(*) FILTER (WHERE NOT is_trashed), count(*) FILTER (WHERE is_trashed) FROM files WHERE user_id = '${userId}'`,
  )
  expect(back).toBe(`${rowsBefore}|${rowsBefore}|0`)
  await shot(page, '17-restore-done')

  expect(requests.filter((r) => r.includes('/files/permanent') || r.includes('/files/trash'))).toEqual([])
  fs.writeFileSync(
    path.join(SHOTS, '18-db-before-after.txt'),
    `user ${userId}\nfile rows before: ${rowsBefore}\nafter the erase (rows|trashed|live): ${after}\nafter restore everything (rows|live|trashed): ${back}\n`,
  )
})
