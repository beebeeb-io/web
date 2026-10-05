import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { PW, NEW_PW, totp, makeAccount, guestPage, requestResetLink, setNewPassword } from './helpers/reset-2fa'
import {
  TotpSteps,
  dropSessionKeepVault,
  probeVault,
  submitSignIn,
  enterTwoFactorCode,
  restoreWithPhrase,
  expectDrive,
  downloadText,
  uploadAndSettle,
  plantPasskeyVault,
  hasPasskeyVault,
} from './helpers/after-password-change'

/**
 * Task 1810 (P0, Guus, prod 2026-10-05): after a password change,
 *   (1) "use recovery to unlock vault" went back to the password reset,
 *   (2) a fresh sign-in failed with "Could not unlock vault. Try logging in again."
 *       and (for a 2FA account) the second code was refused.
 *
 * Root cause: a password change leaves the encrypted copy of the master key that
 * THIS BROWSER holds sealed under the OLD password (the key itself never changes).
 * These specs drive the real UI against a real API and prove, for each reported
 * symptom, that the person ends up in an unlocked drive and that a file uploaded
 * BEFORE the change still decrypts byte-identical after it.
 *
 * Needs an API with the `reset-2fa` capability (server >= 4b99b41) behind the
 * isolated harness (e2e/scripts/web-e2e.sh). A TOTP code is single-use per
 * 30-second step on the server (task 1728), so `TotpSteps` hands out fresh steps.
 */

const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1810'
fs.mkdirSync(SHOTS, { recursive: true })
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true })
}

const FILE = 'before-the-change.txt'
const BODY = 'written before the password change — must decrypt after it'

test.describe.configure({ retries: 0 })

test('2FA account, email reset in the browser that holds the vault: recovery phrase opens the vault, never the password reset; fresh sign-in works', async ({ page }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase, secret } = await makeAccount(page, '1810-t1', true)
  const codes = new TotpSteps(secret)
  await uploadAndSettle(page, FILE, BODY)
  expect((await probeVault(page, { OLD_PW: PW })).unwrapsWith?.OLD_PW).toBe(true)

  // The session on this device ends; the vault stays in the browser.
  await dropSessionKeepVault(page)
  const token = await requestResetLink(page, email)
  await setNewPassword(page, token)
  await page.getByRole('button', { name: /set new password/i }).click()
  await enterTwoFactorCode(page, totp(secret))
  codes.markUsed(0)

  // (a) Getting the vault open after the reset is the recovery-phrase unlock.
  await restoreWithPhrase(page, recoveryPhrase)
  await expectDrive(page)
  expect(new URL(page.url()).pathname).not.toBe('/recover-with-phrase')
  await expect(page.getByRole('heading', { name: /recover with phrase/i })).toHaveCount(0)
  expect(await downloadText(page, FILE)).toBe(BODY)
  await shot(page, 't1-01-unlocked-after-phrase.png')

  // The local vault is now sealed under the NEW password and only that.
  expect(await probeVault(page, { OLD_PW: PW, NEW_PW })).toEqual({ entry: true, unwrapsWith: { OLD_PW: false, NEW_PW: true } })

  // (b) Sign in again in this same browser with the new password + a fresh code.
  await dropSessionKeepVault(page)
  await submitSignIn(page, email, NEW_PW)
  await enterTwoFactorCode(page, await codes.next())
  await expectDrive(page)
  expect(await downloadText(page, FILE)).toBe(BODY)
  await shot(page, 't1-02-signed-in-again.png')
})

test('"Unlock with recovery phrase" on the locked-vault screen: no password reset, no sign-out, a passkey vault survives', async ({ page }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase } = await makeAccount(page, '1810-t1b', false)
  await uploadAndSettle(page, FILE, BODY)
  await dropSessionKeepVault(page)
  const token = await requestResetLink(page, email)
  await setNewPassword(page, token)
  await page.getByRole('button', { name: /set new password/i }).click()
  await expect(page.getByLabel('Recovery word 1', { exact: true })).toBeVisible({ timeout: 30_000 })

  // Round 2 (P2-3): a device that also holds a passkey-sealed vault.
  await plantPasskeyVault(page)
  expect(await hasPasskeyVault(page)).toBe(true)

  // Land on the locked-vault screen the way a reload does (marker kept, tab session alive).
  await page.goto('/')
  const unlock = page.getByRole('button', { name: /unlock with recovery phrase/i }).first()
  await expect(unlock).toBeVisible({ timeout: 30_000 })
  await shot(page, 't1b-01-vault-locked.png')
  await unlock.click()

  // The phrase screen opens IN PLACE: still signed in (no /login), not the password reset.
  await expect(page.getByLabel('Recovery word 1', { exact: true })).toBeVisible({ timeout: 30_000 })
  await shot(page, 't1b-02-after-unlock-click.png')
  expect(new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('heading', { name: /recover with phrase/i })).toHaveCount(0)
  await expect(page.getByText(/set a new password/i)).toHaveCount(0)
  // Nothing was wiped: the passkey vault is still there; only the stale password entry is gone.
  expect(await hasPasskeyVault(page)).toBe(true)
  expect((await probeVault(page, { OLD_PW: PW, NEW_PW })).entry).toBe(false)

  await restoreWithPhrase(page, recoveryPhrase)
  await expectDrive(page)
  expect(await downloadText(page, FILE)).toBe(BODY)
  expect(await hasPasskeyVault(page)).toBe(true)
})

test('P2-1: signing in as a second account does not delete the first account\'s vault from this browser', async ({ page, browser }) => {
  test.setTimeout(300_000)
  // Account A lives in this browser (its vault is tagged with A's id).
  const a = await makeAccount(page, '1810-t5a', false)
  const aFile = 'a-only.txt'
  await uploadAndSettle(page, aFile, 'account A data')
  await dropSessionKeepVault(page)
  const before = await probeVault(page, { PW })
  expect(before).toEqual({ entry: true, unwrapsWith: { PW: true } })

  // Account B is created elsewhere (a different browser), same password on purpose.
  const other = await guestPage(browser)
  const b = await makeAccount(other, '1810-t5b', false)
  expect(b.email).not.toBe(a.email)

  // B signs in HERE. A's entry is not B's stale copy: it must be kept, and the
  // "we removed your old vault" notice must not be shown.
  await submitSignIn(page, b.email, PW)
  await expect(page.getByLabel('Recovery word 1', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/previous password, so it was removed/i)).toHaveCount(0)
  await shot(page, 't5-01-second-account-phrase-prompt.png')
  expect(await probeVault(page, { PW })).toEqual({ entry: true, unwrapsWith: { PW: true } })
})

test('2FA account, blank browser: sign in with the new password + code, enter the phrase, files decrypt', async ({ page, browser }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase, secret } = await makeAccount(page, '1810-t2', true)
  const codes = new TotpSteps(secret)
  await uploadAndSettle(page, FILE, BODY)

  const resetter = await guestPage(browser)
  const token = await requestResetLink(resetter, email)
  await setNewPassword(resetter, token)
  await resetter.getByRole('button', { name: /set new password/i }).click()
  await enterTwoFactorCode(resetter, totp(secret))
  codes.markUsed(0)
  await expect(resetter.getByRole('heading', { name: /password set/i }).or(resetter.getByLabel('Recovery word 1', { exact: true }))).toBeVisible({ timeout: 30_000 })

  const blank = await guestPage(browser)
  await submitSignIn(blank, email, NEW_PW)
  await enterTwoFactorCode(blank, await codes.next())
  await restoreWithPhrase(blank, recoveryPhrase)
  await expectDrive(blank)
  expect(await downloadText(blank, FILE)).toBe(BODY)
  await shot(blank, 't2-01-blank-browser-unlocked.png')
})

test('no 2FA: a vault sealed under the old password is discarded at sign-in and the phrase re-secures it', async ({ page }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase } = await makeAccount(page, '1810-t3', false)
  await uploadAndSettle(page, FILE, BODY)
  await dropSessionKeepVault(page)
  const token = await requestResetLink(page, email)
  await setNewPassword(page, token)
  await page.getByRole('button', { name: /set new password/i }).click()
  await expect(page.getByRole('heading', { name: /password set/i }).or(page.getByLabel('Recovery word 1', { exact: true }))).toBeVisible({ timeout: 30_000 })

  // The device still holds the OLD-password copy of the key at this point.
  await dropSessionKeepVault(page)
  expect((await probeVault(page, { OLD_PW: PW, NEW_PW })).unwrapsWith?.OLD_PW).toBe(true)

  // Sign in with the new password: OPAQUE proves it, the local copy cannot open under it.
  await submitSignIn(page, email, NEW_PW)
  await expect(page.getByLabel('Recovery word 1', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/could not unlock vault|wrong password/i)).toHaveCount(0)
  await shot(page, 't3-01-phrase-prompt-after-sign-in.png')
  // Guus's requirement: the key sealed under the old password is gone, not merely unused.
  expect((await probeVault(page, { OLD_PW: PW, NEW_PW })).entry).toBe(false)

  await restoreWithPhrase(page, recoveryPhrase)
  await expectDrive(page)
  expect(await downloadText(page, FILE)).toBe(BODY)
  expect(await probeVault(page, { OLD_PW: PW, NEW_PW })).toEqual({ entry: true, unwrapsWith: { OLD_PW: false, NEW_PW: true } })

  // Next sign-in on this device opens straight away (sealed under the new password now).
  await dropSessionKeepVault(page)
  await submitSignIn(page, email, NEW_PW)
  await expectDrive(page)
  expect(await downloadText(page, FILE)).toBe(BODY)
})

test('Settings -> Change password: this device re-seals under the new password; fresh sign-in (same and blank browser) works', async ({ page, browser }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase } = await makeAccount(page, '1810-t4', false)
  await uploadAndSettle(page, FILE, BODY)

  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^change password$/i }).click()
  const dialog = page.getByRole('dialog', { name: /change password/i })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(/current password/i).fill(PW)
  await dialog.getByLabel(/^new password$/i).fill(NEW_PW)
  await dialog.getByLabel(/confirm new password/i).fill(NEW_PW)
  await dialog.getByRole('button', { name: /^change password$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 45_000 })
  expect(await probeVault(page, { OLD_PW: PW, NEW_PW })).toEqual({ entry: true, unwrapsWith: { OLD_PW: false, NEW_PW: true } })

  // Same browser, signed out, new password.
  await dropSessionKeepVault(page)
  await submitSignIn(page, email, NEW_PW)
  await expectDrive(page)
  expect(await downloadText(page, FILE)).toBe(BODY)
  await shot(page, 't4-01-same-browser.png')

  // Blank browser, new password + phrase.
  const blank = await guestPage(browser)
  await submitSignIn(blank, email, NEW_PW)
  await restoreWithPhrase(blank, recoveryPhrase)
  await expectDrive(blank)
  expect(await downloadText(blank, FILE)).toBe(BODY)
})
