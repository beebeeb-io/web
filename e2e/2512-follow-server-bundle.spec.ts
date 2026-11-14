import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { signupAndUnlock } from './helpers/signup'

/**
 * Task 2512: web follows the server bundle (a password proof for the first
 * recovery-check fill, the real Decline, "remove from my list" that keeps the key).
 * Runs against a localhost API at the bundle's commit and the local dev Postgres;
 * the DB is read and seeded for COUNTS only (no secrets printed).
 *
 * Gap, stated: a true KSF-v0 account cannot be built here (the server tests say the
 * same), so the OPAQUE upgrade finish is covered by test/auto-upgrade-step-up.test.ts
 * (order + header) and by the recovery-check test below, which runs the same
 * confirmAction -> X-Confirm-Token path against the real server.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? 'e2e/evidence-2512'
const A = 'qa-2512-a@beebeeb.io'
const B = 'qa-2512-b@beebeeb.io'

function sql(q: string): string {
  return execFileSync('psql', ['-h', 'localhost', '-p', '5434', '-U', 'beebeeb', 'beebeeb', '-Atc', q], {
    env: { ...process.env, PGPASSWORD: 'beebeeb_dev' },
  }).toString().trim()
}

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 15_000 })
    .toBe(true)
}

test.beforeAll(() => mkdirSync(EVIDENCE, { recursive: true }))

test('1: a password sign-in fills an empty recovery check through a password proof', async ({ browser }) => {
  // A REAL password sign-up (this browser keeps its vault), sign out, the stored recovery
  // check is emptied (a legacy account), then a REAL password sign-in. The server wants a
  // fresh password login and a proof; the app's own unlock path must ask bare, get
  // `confirmation_required`, earn a proof with the password, and retry once.
  const pw = `Qa2512-${randomBytes(9).toString('hex')}`
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.route('**/dev/auto-login', (r) => r.abort())
  const { email } = await signupAndUnlock(page, { password: pw })
  await page.evaluate(async () => { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); localStorage.removeItem('bb_session'); sessionStorage.clear() })
  await ctx.clearCookies()
  sql(`UPDATE users SET recovery_check = NULL WHERE email = '${email}'`)
  expect(sql(`SELECT count(*) FROM users WHERE email='${email}' AND recovery_check IS NULL`)).toBe('1')

  const calls: string[] = []
  page.on('response', (res) => {
    if (res.url().endsWith('/api/v1/auth/recovery-check')) {
      calls.push(`${res.request().headers()['x-confirm-token'] ? 'with-proof' : 'bare'}:${res.status()}`)
    }
  })
  await page.goto('/login')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('Your password').fill(pw)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 40_000 })

  await expect.poll(() => sql(`SELECT count(*) FROM users WHERE email='${email}' AND recovery_check IS NOT NULL`), { timeout: 20_000 }).toBe('1')
  expect(calls).toEqual(['bare:403', 'with-proof:200'])
  await page.screenshot({ path: `${EVIDENCE}/1-recovery-fill-landed.png` })
  await ctx.close()
})

test('2: Decline tells the sender (declined), and leaves the recipient inbox', async ({ browser }) => {
  const ctxA = await browser.newContext(); const pa = await ctxA.newPage(); await devLogin(pa, A)
  const ctxB = await browser.newContext(); const pb = await ctxB.newPage(); await devLogin(pb, B)
  const fileId = sql(`SELECT id FROM files WHERE user_id = (SELECT id FROM users WHERE email='${A}') LIMIT 1`)
    || sql(`INSERT INTO files (id, user_id, name_encrypted) SELECT gen_random_uuid(), id, '\\x00'::bytea FROM users WHERE email='${A}' RETURNING id`).split('\n')[0]
  sql(`DELETE FROM share_invites WHERE recipient_email='${B}'`)
  sql(`INSERT INTO share_invites (file_id, sender_id, recipient_email, recipient_id, status)
       SELECT '${fileId}', a.id, b.email, b.id, 'invited' FROM users a, users b WHERE a.email='${A}' AND b.email='${B}'`)
  const inviteId = sql(`SELECT id FROM share_invites WHERE recipient_email='${B}'`)

  await pb.goto(`${WEB_URL}/shared`)
  await pb.getByRole('tab', { name: /pending/i }).click().catch(() => pb.getByText(/pending/i).first().click())
  await expect(pb.getByRole('button', { name: 'Decline' })).toBeVisible({ timeout: 15_000 })
  await pb.screenshot({ path: `${EVIDENCE}/2a-recipient-before-decline.png` })
  await pb.getByRole('button', { name: 'Decline' }).click()
  await expect(pb.getByText('Declined').first()).toBeVisible({ timeout: 10_000 })
  await expect(pb.getByRole('button', { name: 'Decline' })).toHaveCount(0)
  await pb.screenshot({ path: `${EVIDENCE}/2b-recipient-after-decline.png` })

  expect(sql(`SELECT status || ':' || hidden_by_recipient FROM share_invites WHERE id='${inviteId}'`)).toBe('declined:true')

  await pa.goto(`${WEB_URL}/shared`)
  await pa.getByRole('tab', { name: /pending/i }).click().catch(() => pa.getByText(/pending/i).first().click())
  await expect(pa.getByText('Declined').first()).toBeVisible({ timeout: 15_000 })
  await expect(pa.getByText('Waiting to claim')).toHaveCount(0)
  await pa.screenshot({ path: `${EVIDENCE}/2c-sender-sees-declined.png` })
  await ctxA.close(); await ctxB.close()
})

test('3: Remove from my list hides the request and keeps its key', async ({ page }) => {
  await devLogin(page, A)
  sql(`DELETE FROM file_requests WHERE title LIKE 'qa-2512-%'`)
  sql(`INSERT INTO file_requests (user_id, title, token, wrapped_private_key, wrap_nonce, max_files, closed_at)
       SELECT id, 'qa-2512-closed', 'qa2512tok' || substr(md5(random()::text),1,12), '\\xdeadbeef'::bytea, '\\x0102'::bytea, 5, now() FROM users WHERE email='${A}'`)
  sql(`INSERT INTO file_requests (user_id, title, token, wrapped_private_key, wrap_nonce, max_files)
       SELECT id, 'qa-2512-open', 'qa2512tok' || substr(md5(random()::text),1,12), '\\xdeadbeef'::bytea, '\\x0102'::bytea, 5 FROM users WHERE email='${A}'`)

  await page.goto(`${WEB_URL}/file-requests`)
  await expect(page.getByText('qa-2512-closed')).toBeVisible({ timeout: 15_000 })
  // An open request offers Close, not Remove.
  const openCard = page.locator('div.rounded-xl', { hasText: 'qa-2512-open' })
  await expect(openCard.getByRole('button', { name: 'Remove from list' })).toHaveCount(0)
  await page.screenshot({ path: `${EVIDENCE}/3a-before-remove.png` })

  const closedCard = page.locator('div.rounded-xl', { hasText: 'qa-2512-closed' })
  await closedCard.getByRole('button', { name: 'Remove from list' }).click()
  await expect(page.getByText('qa-2512-closed')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByText('qa-2512-open')).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/3b-after-remove.png` })

  expect(sql(`SELECT (hidden_at IS NOT NULL) || ':' || (wrapped_private_key IS NOT NULL) FROM file_requests WHERE title='qa-2512-closed'`)).toBe('true:true')
  expect(sql(`SELECT count(*) FROM file_requests WHERE title LIKE 'qa-2512-%'`)).toBe('2')
})
