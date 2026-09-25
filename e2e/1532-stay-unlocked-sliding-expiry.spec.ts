import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

/**
 * Task 1532 (Guus ruling, 2026-09-25): "1532 unlocked should be allowed for
 * more than 30m, 60m of inactivity should be good". The "stay unlocked"
 * session-persist cache (session-persist.ts) now slides its expiry forward
 * on activity, capped at 60 minutes, and deletes the blob + token EAGERLY
 * once the window elapses (a re-armed timer + visibilitychange/pagehide),
 * not only lazily on the next app load.
 *
 * Real-time proof of "idle past the window → gone" needs a much shorter
 * window than 60 real minutes. `bb_e2e_ttl_override_ms` is a DEV-only
 * override — gated on `import.meta.env.DEV`, which Vite constant-folds to
 * `false` and tree-shakes out of production builds (same pattern as
 * dev-auth.ts's `?nodev=1`; verified for this key specifically: `grep -rl
 * bb_e2e_ttl_override_ms dist/` after `bun run build` finds nothing). It is
 * read only inside session-persist.ts's internal effectiveTtlMs() — never a
 * production-reachable flag, and orthogonal to the real `bb_vault_ttl` user
 * preference (Settings → Stay unlocked), which this spec does not touch.
 *
 * Real stack only (run via e2e/scripts/web-e2e.sh — API :3003 + fresh DB +
 * this repo's own vite, which is a DEV server, so import.meta.env.DEV is
 * true here).
 */

const WINDOW_MS = 3_000 // test-shortened sliding window

// A brand-new account per test: override the [authenticated] project's
// dev-auto-login storageState (task 1526's pattern, also used by 1528).
test.use({ storageState: { cookies: [], origins: [] } })

async function setTestWindow(page: Page): Promise<void> {
  await page.addInitScript((ms) => {
    window.localStorage.setItem('bb_e2e_ttl_override_ms', String(ms))
  }, WINDOW_MS)
}

/** Reads the real production state session-persist.ts writes: the bb_spt
 *  localStorage token + the beebeeb_session_persist IDB entry's keys. */
async function sessionPersistState(page: Page): Promise<{ token: string | null; entries: string[] }> {
  const token = await page.evaluate(() => localStorage.getItem('bb_spt'))
  const entries = await page.evaluate(
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
          const r = tx.objectStore('session').getAllKeys()
          r.onsuccess = () => {
            resolve(r.result as string[])
            db.close()
          }
          r.onerror = () => {
            resolve([])
            db.close()
          }
        }
        req.onerror = () => resolve([])
      }),
  )
  return { token, entries }
}

test.describe('task 1532: stay-unlocked sliding expiry (real stack, test-shortened window)', () => {
  test('unlock persists a session; idle past the window → eagerly cleared with no reload; reload asks to unlock again', async ({ page }) => {
    await setTestWindow(page)
    await page.goto('/?nodev=1')
    const password = 'StayUnlocked1532Password!'
    await signupAndUnlock(page, { email: uniqueEmail('1532idle'), password })

    // The persisted session exists right after unlock.
    let state = await sessionPersistState(page)
    expect(state.token).not.toBeNull()
    expect(state.entries).toContain('persist')

    // Idle past the (test-shortened) window with NO interaction at all —
    // the eager-deletion timer armed by persistSession must fire on its
    // own. Nothing here calls restoreSession(); this is the SAME page,
    // still mounted, still on the drive.
    await page.waitForTimeout(WINDOW_MS + 2_000)

    state = await sessionPersistState(page)
    expect(state.token).toBeNull()
    expect(state.entries).toEqual([])

    // Reload: no in-tab cache (dies on refresh by design), no persisted
    // session (just eagerly cleared) → the local vault still exists
    // (wrapAndStore ran at signup) but is locked, so ProtectedRoute renders
    // VaultUnlock — not a redirect to /login.
    await page.reload()
    await expect(page.getByText('Vault locked')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/enter your password to unlock/i)).toBeVisible()

    // Control: the password still actually unlocks it — this is "locked,
    // ask again", not "vault destroyed".
    await page.getByPlaceholder('Your password').fill(password)
    await page.getByRole('button', { name: /unlock vault/i }).click()
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('activity (a real click) before the window elapses slides it forward — session survives past the ORIGINAL window', async ({ page }) => {
    await setTestWindow(page)
    await page.goto('/?nodev=1')
    const password = 'StayUnlockedActivity1532!'
    await signupAndUnlock(page, { email: uniqueEmail('1532act'), password })

    let state = await sessionPersistState(page)
    expect(state.token).not.toBeNull()

    // Activity partway through the window — key-context.tsx's pointerdown
    // listener calls touchSession() (no 30s-throttle collision: this is
    // the first activity since mount).
    await page.waitForTimeout(WINDOW_MS / 2)
    await page.getByText(/All files/i).first().click()

    // Now wait past what the ORIGINAL window (measured from login, not
    // from the click) would have allowed, while staying inside the window
    // as extended by the click.
    await page.waitForTimeout(WINDOW_MS / 2 + 1_000)

    state = await sessionPersistState(page)
    expect(state.token).not.toBeNull()
    expect(state.entries).toContain('persist')
  })
})
