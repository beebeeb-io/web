import { test, expect, type Page } from '@playwright/test'

/**
 * E2E for task 1407 — after in-app account deletion the success path must
 * clear AuthContext's `user` / KeyContext's `isUnlocked` and the vault
 * session state BEFORE navigating to /login. Before the fix,
 * `delete-account.tsx` called `navigate('/login', { replace: true })`
 * without running the sign-out routine, so `GuestRoute` (app.tsx) — which
 * redirects `/login` back to `/` whenever `user && isUnlocked` are both
 * still truthy — bounced the app straight back to a stale Drive view of the
 * just-deleted account (documented as a "KNOWN pre-existing bug" in
 * e2e/account-deleted.spec.ts, found by lane eng-1404 while building that
 * spec).
 *
 * This spec asserts all three things task 1407 requires:
 *   1. The app lands on /login and STAYS there — no bounce to /.
 *   2. No file rows of the deleted user are rendered (the account's
 *      auto-created "Welcome to Beebeeb.md" welcome file, present on every
 *      signup, must not be visible).
 *   3. Every localStorage/IndexedDB key the sign-out routine
 *      (AuthContext.logout → KeyProvider.fullLogout) clears is actually gone:
 *        - localStorage: bb_session (token.ts), bb_email (api.ts, cleared via
 *          the onTokenCleared hook), bb_spt (session-persist.ts remember token)
 *        - IndexedDB: beebeeb_vault/keys (vault.ts, wrapped master key),
 *          beebeeb_session_cache/cache (session-vault-cache.ts, in-tab key
 *          cache), beebeeb_session_persist/session (session-persist.ts,
 *          refresh-surviving wrapped key)
 *      (bb_vault_ttl is a user PREFERENCE, not vault state — intentionally
 *      NOT cleared by logout, so it is not asserted here.)
 *
 * Runs on the isolated e2e harness (task 1466): `./e2e/scripts/web-e2e.sh
 * e2e/delete-account-clears-state.spec.ts` — never the shared :3001 dev API,
 * no manual env overrides needed.
 */

const uniqueEmail = () =>
  `e2e-1407-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

const TEST_PASSWORD = 'DeleteAccountClears1234'

/**
 * Full signup flow (email → recovery phrase → verify → password), landing on
 * `/` with the vault unlocked and the auto-created welcome file visible.
 * Duplicated locally rather than imported — matches the existing convention
 * in this e2e suite (auth.spec.ts, refresh-stability.spec.ts,
 * account-deleted.spec.ts each carry their own copy).
 */
async function signupAndUnlock(page: Page, email: string) {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(email)
  // No pilot-access-key field on a fresh /signup visit (task 1520) — the
  // server's gate is OFF at launch and the field only appears after a real
  // 403 pilot_key_required bounce (src/lib/signup-pilot-gate.ts).
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  expect(phraseWords.length).toBe(12)

  await page
    .getByRole('checkbox', { name: /I've saved my recovery phrase offline/i })
    .click()
  await page.getByRole('button', { name: /I saved it/i }).click()

  const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
  const labelCount = await verifyLabels.count()
  expect(labelCount).toBeGreaterThan(0)
  for (let i = 0; i < labelCount; i++) {
    const labelText = (await verifyLabels.nth(i).innerText()).trim()
    const m = labelText.match(/Word #(\d+)/)
    if (!m) throw new Error(`unexpected verify label: ${labelText}`)
    const wordIdx = parseInt(m[1], 10) - 1
    await page.getByLabel(labelText, { exact: true }).fill(phraseWords[wordIdx])
  }
  await page.getByRole('button', { name: /^verify$/i }).click()

  const passwordField = page.getByPlaceholder('At least 12 characters')
  await expect(passwordField).toBeVisible({ timeout: 5_000 })
  await passwordField.fill(TEST_PASSWORD)
  await page.getByPlaceholder('Type it again').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
  // The welcome file is what proves "no stale rows rendered" below actually
  // means something — confirm it exists before we delete the account.
  await expect(page.getByText('Welcome to Beebeeb.md')).toBeVisible({ timeout: 15_000 })
}

/** Read the exact storage the sign-out routine is responsible for clearing. */
async function readAuthStorageState(page: Page) {
  return page.evaluate(async () => {
    function idbHasEntries(dbName: string, storeName: string): Promise<boolean> {
      return new Promise((resolve) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => resolve(false)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(false)
            return
          }
          const tx = db.transaction(storeName, 'readonly')
          const countReq = tx.objectStore(storeName).count()
          countReq.onsuccess = () => {
            db.close()
            resolve(countReq.result > 0)
          }
          countReq.onerror = () => {
            db.close()
            resolve(false)
          }
        }
      })
    }

    return {
      ls: {
        bb_session: localStorage.getItem('bb_session'),
        bb_email: localStorage.getItem('bb_email'),
        bb_spt: localStorage.getItem('bb_spt'),
      },
      vaultHasEntries: await idbHasEntries('beebeeb_vault', 'keys'),
      sessionCacheHasEntries: await idbHasEntries('beebeeb_session_cache', 'cache'),
      sessionPersistHasEntries: await idbHasEntries('beebeeb_session_persist', 'session'),
    }
  })
}

/**
 * Delete the just-signed-up account via the real /settings/delete-account
 * UI: type DELETE, check the encrypted-data-cannot-be-recovered box, confirm
 * identity with the account's password (StepUpAuth's OPAQUE re-auth), submit.
 * Does NOT hard-navigate afterward — the whole point of this spec is to
 * observe the raw SPA behavior right after delete-account.tsx's own
 * navigate('/login', { replace: true }).
 */
async function deleteAccountViaUi(page: Page) {
  await page.goto('/settings/delete-account')
  await expect(page.getByText(/Delete your account/i)).toBeVisible({ timeout: 10_000 })

  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page
    .getByRole('checkbox', { name: /files are encrypted and cannot be recovered/i })
    .click()

  await page.getByRole('button', { name: /^delete permanently$/i }).click()

  await expect(page.getByRole('dialog', { name: /confirm your identity/i })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^delete account$/i }).click()
}

test.describe('delete-account clears auth + vault state (task 1407)', () => {
  // Fresh, unauthenticated context per test — this spec creates + deletes a
  // real account via the UI, not a fixture (mirrors account-deleted.spec.ts).
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })

  test('success path lands on /login, stays there, and clears all vault/session storage', async ({
    page,
  }) => {
    const email = uniqueEmail()

    await signupAndUnlock(page, email)
    await deleteAccountViaUi(page)

    // delete-account.tsx's success handler runs deleteAccountPermanently()
    // then the sign-out routine, then navigate('/login', { replace: true }).
    // Give the SPA time to settle past any synchronous GuestRoute bounce
    // before asserting — a waitForURL(/login/) right after the click could
    // racily catch a transient /login that GuestRoute (pre-fix) immediately
    // reverts, on unfixed code, before this poll even runs again.
    await page.waitForTimeout(2_000)
    await expect(page).toHaveURL(/\/login/, { timeout: 1_000 })

    // No file rows of the deleted user rendered — proves we're not looking
    // at a stale Drive view under the /login URL either.
    await expect(page.getByText('Welcome to Beebeeb.md')).not.toBeVisible()

    // Stays there — no delayed bounce either (e.g. a stale effect re-running).
    await page.waitForTimeout(3_000)
    await expect(page).toHaveURL(/\/login/, { timeout: 1_000 })
    await expect(page.getByText('Welcome to Beebeeb.md')).not.toBeVisible()

    // The exact storage the sign-out routine (AuthContext.logout ->
    // KeyProvider.fullLogout) is responsible for clearing must be gone.
    const state = await readAuthStorageState(page)
    expect(state.ls.bb_session, 'bb_session (localStorage token) must be cleared').toBeNull()
    expect(state.ls.bb_email, 'bb_email (localStorage) must be cleared').toBeNull()
    expect(state.ls.bb_spt, 'bb_spt (session-persist remember token) must be cleared').toBeNull()
    expect(state.vaultHasEntries, 'IndexedDB beebeeb_vault/keys must be empty').toBe(false)
    expect(
      state.sessionCacheHasEntries,
      'IndexedDB beebeeb_session_cache/cache must be empty',
    ).toBe(false)
    expect(
      state.sessionPersistHasEntries,
      'IndexedDB beebeeb_session_persist/session must be empty',
    ).toBe(false)
  })
})
