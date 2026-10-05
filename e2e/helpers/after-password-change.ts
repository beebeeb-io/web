import { expect, type Page, type Download } from '@playwright/test'
import fs from 'fs'
import { totp } from './reset-2fa'
import { openRowMenu, uploadTextFile } from './drive'

/**
 * Shared by e2e/1810-after-password-change.spec.ts (task 1810, P0): what a
 * person sees when they change their password in a browser that already holds
 * an encrypted vault, and then sign in again.
 */

/**
 * The server accepts a login TOTP code only for a 30-second step strictly
 * greater than the last one it accepted (task 1728), so a spec that uses a
 * code twice must use two different steps. Returns a code for a step that has
 * not been used yet in this test, waiting for the next step if it has to.
 */
export class TotpSteps {
  private last = 0
  constructor(private readonly secret: string) {}

  /** Mark the step of an already-used code (`offset` as passed to `totp`). */
  markUsed(offset = 0): void {
    this.last = Math.max(this.last, Math.floor(Date.now() / 1000 / 30) + offset)
  }

  async next(): Promise<string> {
    for (;;) {
      const cur = Math.floor(Date.now() / 1000 / 30)
      // A code one step ahead is inside the server's +-1 window.
      if (cur + 1 > this.last) {
        this.last = cur + 1
        return totp(this.secret, 1)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

/**
 * The person's session on this device ends (expiry, or revoked by the reset);
 * the encrypted vault in this browser's IndexedDB is left exactly as it was.
 */
export async function dropSessionKeepVault(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.evaluate(async () => {
    try { localStorage.clear() } catch { /* storage blocked */ }
    try { sessionStorage.clear() } catch { /* storage blocked */ }
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase('beebeeb_session_persist')
      r.onsuccess = r.onerror = r.onblocked = () => res()
    })
  })
}

/**
 * Which passwords unwrap this browser's password vault ('master' entry in
 * IndexedDB `beebeeb_vault`)? Same derivation as src/lib/vault.ts
 * (PBKDF2-SHA-256 x 600k, AES-256-GCM). `entry: false` = no password vault.
 */
export async function probeVault(
  page: Page,
  passwords: Record<string, string>,
): Promise<{ entry: boolean; unwrapsWith?: Record<string, boolean> }> {
  return page.evaluate(async (pws) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('beebeeb_vault')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    if (!db.objectStoreNames.contains('keys')) { db.close(); return { entry: false } }
    const entry = await new Promise<{ salt: Uint8Array; nonce: Uint8Array; wrappedKey: ArrayBuffer } | undefined>((res) => {
      const r = db.transaction('keys').objectStore('keys').get('master')
      r.onsuccess = () => res(r.result)
    })
    db.close()
    if (!entry) return { entry: false }
    const unwrapsWith: Record<string, boolean> = {}
    for (const [label, pw] of Object.entries(pws)) {
      const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
      const k = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: entry.salt as BufferSource, iterations: 600_000, hash: 'SHA-256' },
        km,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      )
      try {
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.nonce as BufferSource }, k, entry.wrappedKey)
        unwrapsWith[label] = true
      } catch {
        unwrapsWith[label] = false
      }
    }
    return { entry: true, unwrapsWith }
  }, passwords)
}

/** Fill and submit the real sign-in form (does not wait for the outcome). */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login?nodev=1')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 30_000 })
  await page.getByLabel(/email/i).fill(email)
  await page.getByPlaceholder('Your password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

export async function enterTwoFactorCode(page: Page, code: string): Promise<void> {
  const input = page.getByLabel('6-digit verification code')
  await expect(input).toBeAttached({ timeout: 30_000 })
  await input.fill(code)
}

/** Type the 12-word phrase into the device-setup screen and restore the vault. */
export async function restoreWithPhrase(page: Page, phrase: string): Promise<void> {
  const box = page.getByLabel('Recovery word 1', { exact: true })
  await expect(box).toBeVisible({ timeout: 30_000 })
  await box.fill(phrase)
  await page.getByRole('button', { name: /restore vault/i }).click()
}

export async function expectDrive(page: Page): Promise<void> {
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 45_000 })
}

/** Download `filename` from the drive and return its decrypted bytes as text. */
export async function downloadText(page: Page, filename: string): Promise<string> {
  await openRowMenu(page, filename)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('menuitem', { name: /^Download/ }).click(),
  ])
  return readDownload(dl)
}

async function readDownload(download: Download): Promise<string> {
  const p = await download.path()
  expect(p, 'download produced no file').toBeTruthy()
  return fs.readFileSync(p!, 'utf-8')
}

/**
 * Upload a text file and wait until it is really on the server: the row can
 * show before the upload completes, so reload and require it to still be listed.
 */
export async function uploadAndSettle(page: Page, filename: string, body: string): Promise<void> {
  await page.goto('/')
  await uploadTextFile(page, filename, body)
  // 'networkidle' never settles here (sync stream); a tiny file finishes well inside this.
  await page.waitForTimeout(4000)
  await page.reload()
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 45_000 })
}

/** Plant a passkey-sealed vault entry ('master-passkey') as a stand-in for a device that has one. */
export async function plantPasskeyVault(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('beebeeb_vault')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    await new Promise<void>((res, rej) => {
      const r = db.transaction('keys', 'readwrite').objectStore('keys').put({ id: 'master-passkey', marker: 'e2e-1810-passkey-vault' })
      r.onsuccess = () => res()
      r.onerror = () => rej(r.error)
    })
    db.close()
  })
}

/** Is the (planted) passkey vault entry still in this browser's vault store? */
export async function hasPasskeyVault(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('beebeeb_vault')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    if (!db.objectStoreNames.contains('keys')) { db.close(); return false }
    const entry = await new Promise<unknown>((res) => {
      const r = db.transaction('keys').objectStore('keys').get('master-passkey')
      r.onsuccess = () => res(r.result)
    })
    db.close()
    return entry !== undefined
  })
}
