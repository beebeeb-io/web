import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'

/**
 * Tasks 1528 + 1529 — the "Set up this device" screen (DeviceProvision).
 *
 * 1528 (Guus ruling, 2026-09-25): "username + password OR username +
 * passkey THEN the mnemonic (prefer to have just 12 inputs like on the mac
 * app), remove scan QR for now". The screen must show ONLY the 12-box
 * recovery-phrase form — no Passkey tab (login.tsx already tried the
 * PRF/escrow auto-unlock before ever reaching here) and no Scan QR tab.
 *
 * 1529 (P0): a passkey sign-in reaches this screen with password === ''.
 * The pre-fix code wrapped the master key under that empty string
 * (wrapAndStore(key, '') — PBKDF2('' , salt), AES-GCM) and persisted it to
 * IndexedDB — readable by anyone with access to the browser profile. The
 * fix: the passkey path must be session-only (setMasterKeyDirect, nothing
 * persisted); vault.ts now throws on an empty secret as a hard backstop.
 *
 * Real stack only (run via e2e/scripts/web-e2e.sh — API :3003 + fresh DB +
 * this repo's own vite). A brand-new context per test overrides the
 * [authenticated] project's dev-auto-login storageState (task 1526's
 * pattern) so /login and /signup show their real, unauthenticated forms.
 *
 * "New device" simulation (test 3, passkey path): a genuinely separate
 * browser context can't reuse a WebAuthn virtual authenticator or its
 * credential — Chromium's WebAuthn.addVirtualAuthenticator is scoped to one
 * CDP session (one page), and there is no supported way to hand a credential
 * to an unrelated context short of exporting/importing raw credential
 * material, which doesn't model anything closer to a real second device than
 * this does. Instead: register the passkey and then clear this SAME page's
 * IndexedDB (all databases — beebeeb_vault, beebeeb_session_cache,
 * beebeeb_session_persist) + localStorage (which is what actually
 * determines "this device has no vault yet" — see key-context.tsx's
 * hasVault()/restoreCachedKey() and passkey-vault.ts's localStorage PRF
 * fallback) + cookies, then sign in again. The virtual authenticator/
 * credential stays attached to the page (the real-world analog: the same
 * physical passkey, now used on a wiped device) while every piece of
 * browser-side STATE that DeviceProvision's branching actually depends on
 * is gone — which is the thing this test needs to prove.
 */

const PASSWORD_LOGIN_PW = 'DeviceFlow1528Password!'
const PASSKEY_LOGIN_PW = 'DeviceFlow1529Passkey!'

// A brand-new account per test: override the [authenticated] project's
// dev-auto-login storageState (task 1526's pattern).
test.use({ storageState: { cookies: [], origins: [] } })

async function addVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

/** All object-store keys currently in IndexedDB's beebeeb_vault 'keys' store. */
async function vaultEntryIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('beebeeb_vault', 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' })
        }
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('keys')) {
            db.close()
            resolve([])
            return
          }
          const tx = db.transaction('keys', 'readonly')
          const getAllKeysReq = tx.objectStore('keys').getAllKeys()
          getAllKeysReq.onsuccess = () => {
            resolve(getAllKeysReq.result as string[])
            db.close()
          }
          getAllKeysReq.onerror = () => {
            resolve([])
            db.close()
          }
        }
        req.onerror = () => resolve([])
      }),
  )
}

/**
 * All object-store keys currently in IndexedDB's beebeeb_session_persist
 * 'session' store (session-persist.ts — the TTL-bounded, disk-persisted
 * cache the passkey session-only path must never write to, task 1529
 * continuation item 1).
 */
async function sessionPersistEntryIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('beebeeb_session_persist', 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'id' })
        }
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('session')) {
            db.close()
            resolve([])
            return
          }
          const tx = db.transaction('session', 'readonly')
          const getAllKeysReq = tx.objectStore('session').getAllKeys()
          getAllKeysReq.onsuccess = () => {
            resolve(getAllKeysReq.result as string[])
            db.close()
          }
          getAllKeysReq.onerror = () => {
            resolve([])
            db.close()
          }
        }
        req.onerror = () => resolve([])
      }),
  )
}

/** The 'bb_spt' localStorage token session-persist.ts writes alongside its
 *  IndexedDB blob — null when nothing has ever been persisted there. */
async function sessionPersistToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('bb_spt'))
}

/** Simulates "this is a fresh device" for the CURRENT page: wipes every
 *  IndexedDB database, localStorage, and the session cookie — everything
 *  DeviceProvision's branching and the vault auto-unlock paths read — while
 *  leaving the page's WebAuthn virtual authenticator (if any) attached. */
async function clearLocalDeviceState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      dbs
        .filter((d): d is IDBDatabaseInfo & { name: string } => !!d.name)
        .map(
          (d) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(d.name)
              req.onsuccess = () => resolve()
              req.onerror = () => resolve()
              req.onblocked = () => resolve()
            }),
        ),
    )
  })
  await page.context().clearCookies()
}

async function waitForCryptoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
}

/** Asserts the DeviceProvision screen shows ONLY the 12-box phrase form. */
async function expectOnlyPhraseScreen(page: Page): Promise<void> {
  await expect(page.getByText('Set up this device')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Passkey', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scan QR', exact: true })).toHaveCount(0)
  for (let i = 1; i <= 12; i++) {
    await expect(page.getByLabel(`Recovery word ${i}`, { exact: true })).toBeVisible()
  }
}

test.describe('task 1528: new-device flow — auth then phrase, no passkey/QR tabs', () => {
  test('password login on a fresh device: only the 12-box phrase screen; paste fills all 12; wrong phrase rejected + nothing stored; right phrase reaches the drive', async ({ page, browser }) => {
    await page.goto('/?nodev=1')
    const account = await signupAndUnlock(page, { password: PASSWORD_LOGIN_PW })

    // A genuinely different, checksum-VALID 12-word phrase (a second real
    // account's) — a permutation of account.recoveryPhrase would usually
    // fail BIP39 checksum validation itself (recoverFromPhrase throws
    // generically), not the account-mismatch check this is meant to prove.
    // A SEPARATE browser context (not just a second page/tab) so its signup
    // session cookie never overwrites account A's in the shared cookie jar.
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await otherPage.goto('/?nodev=1')
    const other = await signupAndUnlock(otherPage, { password: 'OtherAccount1528!' })
    await otherContext.close()
    expect(other.recoveryPhrase).not.toBe(account.recoveryPhrase)

    // Simulate this same browser on a second, fresh device: no local vault.
    await clearLocalDeviceState(page)
    await page.goto('/login?nodev=1')
    await waitForCryptoReady(page)
    await page.getByLabel(/email/i).fill(account.email)
    await page.getByPlaceholder('Your password').fill(PASSWORD_LOGIN_PW)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expectOnlyPhraseScreen(page)

    // (2) Paste all 12 words into box 1 — must split across all 12 boxes.
    await page.getByLabel('Recovery word 1', { exact: true }).fill(other.recoveryPhrase)
    const pastedWords = other.recoveryPhrase.split(' ')
    for (let i = 0; i < 12; i++) {
      await expect(page.getByLabel(`Recovery word ${i + 1}`, { exact: true })).toHaveValue(pastedWords[i])
    }

    // Wrong-account phrase (checksum-valid, but not this account's) → rejected.
    await page.getByRole('button', { name: /restore vault/i }).click()
    await expect(page.getByText('Incorrect recovery phrase. Check your words and try again.')).toBeVisible({
      timeout: 15_000,
    })
    expect(await vaultEntryIds(page)).toEqual([])

    // Now the account's own correct phrase — paste into box 1 again.
    await page.getByLabel('Recovery word 1', { exact: true }).fill(account.recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })

    // Password path DOES persist a local vault.
    expect(await vaultEntryIds(page)).toContain('master')
  })

  test('Settings → Security no longer says to "choose Scan QR" and hides the add-device-via-QR panel', async ({ page }) => {
    await page.goto('/?nodev=1')
    await signupAndUnlock(page, { password: 'SettingsQrCheck1528!' })

    await page.goto('/settings/security?nodev=1')
    await expect(page.getByText('Devices & sessions')).toBeVisible({ timeout: 10_000 })

    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText).not.toContain('Scan QR')
    expect(bodyText).not.toContain('choose "Scan QR"')
    await expect(page.getByText('Add a device')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Generate QR' })).toHaveCount(0)
  })
})

test.describe('task 1529 (P0): passkey sign-in on a new device is session-only', () => {
  test('passkey login on a fresh device reaches the same 12-box screen; after restore, IndexedDB has NO master vault entry', async ({ page }) => {
    // Signup + password step-up (256 MiB Argon2id) + passkey CREATE + passkey
    // login + phrase restore in one test: under parallel-lane host load
    // (~60) the 30 s default ran out at the "Passkey added" step
    // (e2e classification 2026-09-26, flaky under PR #97's harness).
    test.setTimeout(90_000)
    await addVirtualAuthenticator(page)
    await page.goto('/?nodev=1')
    const account = await signupAndUnlock(page, { password: PASSKEY_LOGIN_PW })

    // Register a passkey for this account (real production flow: step-up
    // with the account password, then the WebAuthn CREATE ceremony against
    // the virtual authenticator — no PRF, so registration also generates
    // and escrows a localStorage-fallback wrap key server-side).
    await page.goto('/settings/security?nodev=1')
    await expect(page.getByText('Devices & sessions')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Add passkey' }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Password').fill(PASSKEY_LOGIN_PW)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Passkey added')).toBeVisible({ timeout: 15_000 })

    // Simulate a second, fresh device for the SAME passkey: wipe every
    // piece of local browser state DeviceProvision's branching depends on
    // (see clearLocalDeviceState's doc comment for why this — not a second
    // browser context — is what proves "no vault on this device" here).
    await clearLocalDeviceState(page)
    await page.goto('/login?nodev=1')
    await waitForCryptoReady(page)
    await page.getByLabel(/email/i).fill(account.email)
    // Switch to the passkey path (mirrors handlePasskeyLogin — no password
    // field is ever filled on this page instance for the passkey path).
    await page.getByRole('button', { name: 'Sign in with passkey' }).click()
    await page.getByRole('button', { name: /continue with passkey/i }).click()

    // No local wrap key (localStorage cleared, no PRF) → escrow auto-unlock
    // fails → falls through to DeviceProvision, same 12-box screen as the
    // password path, password === '' this time.
    await expectOnlyPhraseScreen(page)

    await page.getByLabel('Recovery word 1', { exact: true }).fill(account.recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })

    // 1529: session-only — nothing persisted to IndexedDB for this device.
    const entries = await vaultEntryIds(page)
    expect(entries).not.toContain('master')
    expect(entries).not.toContain('master-passkey')

    // Continuation item 1 (Codex P1, PR #73): setMasterKeyDirect must not
    // fall through to persistSession either — no beebeeb_session_persist
    // IndexedDB entry, no bb_spt localStorage token. Pre-fix, this is
    // exactly what a profile-reader could decrypt the master key from even
    // though the 'master'/'master-passkey' vault entries above were
    // already clean.
    expect(await sessionPersistEntryIds(page)).toEqual([])
    expect(await sessionPersistToken(page)).toBeNull()
  })

  test('pasting the full 12-word phrase into a MIDDLE box (not box 1) still fills all 12', async ({ page }) => {
    // Codex P2 (PR #73): distributeWords used to fill starting at whichever
    // box received the paste and clip to the remaining boxes — pasting all
    // 12 words into box 7 left boxes 1-6 empty and Restore permanently
    // disabled, contradicting the "paste all 12 into any box" copy.
    await page.goto('/?nodev=1')
    const account = await signupAndUnlock(page, { password: 'MiddleBoxPaste1529!' })
    await clearLocalDeviceState(page)
    await page.goto('/login?nodev=1')
    await waitForCryptoReady(page)
    await page.getByLabel(/email/i).fill(account.email)
    await page.getByPlaceholder('Your password').fill('MiddleBoxPaste1529!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expectOnlyPhraseScreen(page)

    // Box 7 (index 6) — not the first box.
    await page.getByLabel('Recovery word 7', { exact: true }).fill(account.recoveryPhrase)
    const words = account.recoveryPhrase.split(' ')
    for (let i = 0; i < 12; i++) {
      await expect(page.getByLabel(`Recovery word ${i + 1}`, { exact: true })).toHaveValue(words[i])
    }
    await expect(page.getByRole('button', { name: /restore vault/i })).toBeEnabled()

    await page.getByRole('button', { name: /restore vault/i }).click()
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
