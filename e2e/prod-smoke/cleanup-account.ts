/**
 * EXIT-trap cleanup driver for `scripts/prod-smoke.sh --target prod`
 * (task 1495, Codex P1 prod-smoke.sh:175 — "prod has no failure cleanup").
 *
 * Invoked ONLY by that script's `cleanup()` trap, ONLY for `--target prod`,
 * and ONLY when the run's scratch credentials file still exists — i.e. the
 * run did NOT reach its own step 10 (which deletes the account through the
 * UI and then deletes this same file as its last action; see
 * prod-smoke.spec.ts). So by the time this runs, the account may still exist
 * in production in an unknown state (mid-upload, mid-signup, whatever step
 * failed) and needs to go.
 *
 * SIGNS IN FRESH with the per-run {email, password} held in that scratch
 * file — never a reused/stale session, per the task brief ("Sign in fresh in
 * the trap if needed, using the per-run credentials held in memory or
 * scratch"). A partially-failed run may have left no valid session at all
 * (e.g. the browser/API crashed mid-step), so a fresh sign-in is also the
 * only mechanism that reliably works regardless of where the run died.
 *
 * Performs a REAL account deletion through the SAME public HTTP API a real
 * user's browser calls — POST /api/v1/auth/confirm (step-up token) then
 * DELETE /api/v1/auth/account — never a direct database mutation. Per
 * `beebeeb-api/src/routes/account.rs::delete_account` this is a SOFT delete:
 * sets `deleted_at`, revokes every session, trashes files, revokes share
 * links. It does NOT hard-purge the row — a background worker hard-deletes
 * accounts with `deleted_at` older than the 30-day GDPR erasure window.
 *
 * ⚠ That hard-purge worker currently FAILS for any account that has
 * `sync_ops` rows (task 1501 — ~20 non-CASCADE FKs on `users(id)`, found
 * while building this harness's own local-mode cleanup; see task 1495
 * notes). A prod-smoke account that reaches step 7 (CLI login/`bb ls`,
 * which writes sync_ops) will hit that same bug once the purge worker gets
 * to it. This soft-delete is still correct and sufficient for prod-smoke's
 * purpose (revoke sessions, stop billing/quota accrual, remove it from the
 * live account list) — the hard-purge gap is task 1501's to fix, not this
 * script's to work around with a direct DB delete (explicitly out of scope
 * per the task brief: "Do not implement any direct prod DB delete").
 *
 * Usage:  bun run e2e/prod-smoke/cleanup-account.ts
 * Env (all set by scripts/prod-smoke.sh for --target prod):
 *   E2E_SMOKE_CREDENTIALS_FILE  path to a {email,password} JSON file
 *   E2E_WEB_URL                 e.g. https://app.beebeeb.io
 *   E2E_CLI_API_URL             e.g. https://api.beebeeb.io
 *
 * Never logs the password. Exits 0 when there was nothing to clean up, or
 * cleanup succeeded (including the idempotent "already marked for deletion"
 * case). Exits 1 on any failure — the caller (the bash trap) treats that as
 * non-fatal-but-loud: cleanup best-effort, the run's own exit code still
 * wins, but the operator sees "may still exist in production, check
 * manually" in the log.
 */
import fs from 'node:fs'
import { chromium } from '@playwright/test'

async function main(): Promise<number> {
  const credFile = process.env.E2E_SMOKE_CREDENTIALS_FILE
  const webUrl = process.env.E2E_WEB_URL
  const apiUrl = process.env.E2E_CLI_API_URL

  if (!credFile || !webUrl || !apiUrl) {
    console.error(
      '[cleanup] missing E2E_SMOKE_CREDENTIALS_FILE / E2E_WEB_URL / E2E_CLI_API_URL — refusing to guess. ' +
        'This script is meant to be invoked by scripts/prod-smoke.sh\'s EXIT trap, not run standalone.',
    )
    return 1
  }
  if (!fs.existsSync(credFile)) {
    console.log(`[cleanup] no credentials file at ${credFile} — nothing to clean up.`)
    return 0
  }

  const { email, password } = JSON.parse(fs.readFileSync(credFile, 'utf8')) as {
    email: string
    password: string
  }
  console.log(`[cleanup] credentials file present for ${email} — signing in fresh to delete the account…`)

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`${webUrl}/login`)
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
    await page.getByLabel(/email/i).fill(email)
    await page.getByPlaceholder('Your password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // We only need an authenticated SESSION (the cookie is set the instant
    // OPAQUE login-finish succeeds) — not an unlocked vault, so we don't fill
    // a recovery phrase even if DeviceProvision shows. Race a third outcome,
    // an inline login error, so a genuinely wrong/rotated password fails
    // loudly instead of hanging for the full timeout.
    // Task 1528: DeviceProvision is now 12 individually-labeled word boxes,
    // not one textarea.
    const phraseInput = page.getByLabel('Recovery word 1', { exact: true })
    const errorBox = page.locator('p.text-red, p.text-xs.text-red').first()
    const outcome = await Promise.race([
      page
        .waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
        .then(() => 'drive' as const)
        .catch(() => null),
      phraseInput
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'provision' as const)
        .catch(() => null),
      errorBox
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'error' as const)
        .catch(() => null),
    ])

    if (outcome === 'error') {
      const msg = await errorBox.innerText().catch(() => '(could not read the error text)')
      console.error(`[cleanup] FAILED to sign in as ${email}: ${msg}`)
      console.error('[cleanup] the account may still exist in production — check manually.')
      return 1
    }
    if (outcome !== 'drive' && outcome !== 'provision') {
      console.error(
        `[cleanup] FAILED to sign in as ${email}: did not reach the drive, DeviceProvision, or a login error within 30s.`,
      )
      console.error('[cleanup] the account may still exist in production — check manually.')
      return 1
    }
    console.log(`[cleanup] signed in as ${email} (post-login state: ${outcome}) — requesting step-up confirmation…`)

    // Step-up confirmation. For an OPAQUE-only account (every prod-smoke
    // account) the server ignores `password` here and instead checks the
    // session is < 15 minutes old (beebeeb-api/src/routes/auth.rs's
    // confirm_password) — always true for a session we just minted above.
    const confirmRes = await page.request.post(`${apiUrl}/api/v1/auth/confirm`, {
      data: { password },
    })
    if (!confirmRes.ok()) {
      console.error(
        `[cleanup] POST /auth/confirm failed: ${confirmRes.status()} ${await confirmRes.text().catch(() => '')}`,
      )
      console.error('[cleanup] the account may still exist in production — check manually.')
      return 1
    }
    const { confirmation_token: confirmationToken } = (await confirmRes.json()) as {
      confirmation_token: string
    }

    const deleteRes = await page.request.delete(`${apiUrl}/api/v1/auth/account`, {
      headers: { 'X-Confirm-Token': confirmationToken },
      data: { confirmation: 'DELETE' },
    })
    if (deleteRes.ok()) {
      console.log(
        `[cleanup] account ${email} soft-deleted — sessions revoked, 30-day purge scheduled ` +
          '(hard-purge FK gap tracked in task 1501).',
      )
      return 0
    }

    const body = await deleteRes.text().catch(() => '')
    if (deleteRes.status() === 400 && body.includes('already marked for deletion')) {
      // Idempotent already-gone case — e.g. the run's OWN step 10 succeeded
      // right as the trap fired, a narrow but real race.
      console.log(`[cleanup] account ${email} was already marked for deletion — nothing to do.`)
      return 0
    }
    console.error(`[cleanup] DELETE /auth/account failed: ${deleteRes.status()} ${body}`)
    console.error('[cleanup] the account may still exist in production — check manually.')
    return 1
  } finally {
    await browser.close()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[cleanup] unexpected error:', err instanceof Error ? err.message : String(err))
    console.error('[cleanup] the account may still exist in production — check manually.')
    process.exit(1)
  })
