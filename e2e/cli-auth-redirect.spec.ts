import { test, expect, type Page } from '@playwright/test'
import { createAccount, fillSignupForm, reachPasswordStep, uniqueEmail } from './helpers/signup'
import { API_URL } from '../playwright.config'

/**
 * Task 0551 — CLI device-auth redirect preservation.
 *
 * The bug: when an unauthenticated browser opens /cli-auth?code=XXXX-XXXX, the
 * app bounces to /login, but the intended destination was dropped — after the
 * user signed in (especially through the no-vault device-provision step) they
 * landed on the drive ("/") instead of back on /cli-auth, so the CLI handshake
 * never completed.
 *
 * The fix: ProtectedRoute now captures the intended path as `?next=`, and
 * login.tsx consumes it through sanitizeRedirect() — an allowlisted same-origin
 * path only (no open redirect). These specs prove both halves against the
 * isolated e2e backend with NO 2FA account required.
 *
 * Runs on the dedicated :3003 harness (make web-e2e SPECS=e2e/cli-auth-redirect.spec.ts).
 */

const STRONG_PW = 'correct-horse-battery-staple-9'

/** In dev/e2e, DevAuthGate POSTs /dev/auto-login on every page load and would
 *  inject a session. 404 it so the context starts genuinely unauthenticated. */
async function blockDevAutoLogin(page: Page) {
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
}

/**
 * Mint a REAL `user_code` by playing the CLI's half of the device-auth
 * WebSocket handshake (`GET /api/v1/auth/cli`, task 0179) — an ephemeral
 * P-256 ECDH keypair, same as `bb login --browser` would generate. Needed
 * (task 1437) so the spec can assert the "Authorize CLI access" prompt
 * actually renders, not just that the URL holds — a fabricated code 404s at
 * the `cli-pubkey` fetch and never reaches the prompt regardless of the
 * redirect-race fix. The server stores the pubkey (Redis, or the in-process
 * `LOCAL_SESSIONS` map in dev without Redis) independent of the WS staying
 * open, so this connection does not need to be kept alive afterward — it is
 * torn down for free when the page later navigates.
 */
async function mintRealCliCode(page: Page): Promise<string> {
  const wsUrl = `${API_URL.replace(/^http/, 'ws')}/api/v1/auth/cli`
  return page.evaluate(async (url) => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )
    const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey)
    const pubB64 = btoa(String.fromCharCode(...new Uint8Array(rawPub)))

    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('mintRealCliCode: timed out waiting for user_code'))
      }, 10_000)
      ws.onopen = () => ws.send(JSON.stringify({ ecdh_public_key_b64: pubB64 }))
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as { user_code?: string }
          if (data.user_code) {
            clearTimeout(timer)
            resolve(data.user_code)
          }
        } catch {
          // not JSON we understand — ignore and keep waiting
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('mintRealCliCode: WebSocket error'))
      }
    })
  }, wsUrl)
}

/**
 * Drive the real UI signup → recovery-phrase → password flow to create a fresh
 * account, returning its credentials + the generated 12-word phrase. Uses the
 * shared helper (task 1406) — this spec's copy predated the pilot-access-key
 * field (task 0928) and was stale.
 */
async function signUp(page: Page): Promise<{ email: string; password: string; recoveryPhrase: string }> {
  const email = uniqueEmail('e2e-cliauth')
  await fillSignupForm(page, { email })
  const phraseWords = await reachPasswordStep(page)
  await createAccount(page, STRONG_PW)

  // Account created → lands on the drive.
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 25_000 })

  return { email, password: STRONG_PW, recoveryPhrase: phraseWords.join(' ') }
}

test.describe('CLI auth — redirect preservation (0551)', () => {
  test('unauthenticated /cli-auth bounce preserves the exact next path', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await blockDevAutoLogin(page)

    await page.goto('/cli-auth?code=WXYZ-7890')

    // ProtectedRoute bounces to /login carrying the intended destination.
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 15_000 })
    const next = new URL(page.url()).searchParams.get('next')
    expect(next).toBe('/cli-auth?code=WXYZ-7890')

    await ctx.close()
  })

  test('device-provision login returns to /cli-auth?code=… (the closed gap)', async ({ browser }) => {
    // Phase 1 — create an account (its own context establishes a server-side user).
    const setupCtx = await browser.newContext()
    const setupPage = await setupCtx.newPage()
    await blockDevAutoLogin(setupPage)
    const acct = await signUp(setupPage)
    await setupCtx.close()

    // Phase 2 — a pristine "fresh device": no IndexedDB vault, no session cookie.
    // Force the onboarding step to "done" from first paint (computeStep honours
    // localStep === 'done' over server flags) so the first-run welcome flow,
    // which would otherwise bounce a fresh account from /cli-auth onto the
    // drive, stays out of the way — this test is about the redirect, not onboarding.
    const freshCtx = await browser.newContext()
    await freshCtx.addInitScript(() => {
      localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
      localStorage.setItem('bb_cookie_consent', 'all')
    })
    const page = await freshCtx.newPage()
    await blockDevAutoLogin(page)

    const code = 'TEST-DUMMY'
    await page.goto(`/cli-auth?code=${code}`)

    // Bounced to /login with the cli-auth destination preserved.
    await expect(page).toHaveURL(new RegExp(`/login\\?next=.*cli-auth.*${code}`), { timeout: 15_000 })
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })

    // Sign in. No vault on this device → device-provision (recovery phrase).
    // The login password field is a bare input (standalone <label>, not
    // associated) — target it by placeholder, as the email field carries the
    // only real <label> association.
    await page.getByLabel(/email/i).fill(acct.email)
    await page.getByPlaceholder('Your password').fill(acct.password)
    // Exact name: "Sign in with passkey" also matches a loose /sign in/ regex.
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const phraseInput = page.getByPlaceholder('word1 word2 word3 ... word12')
    await phraseInput.waitFor({ state: 'visible', timeout: 25_000 })
    await phraseInput.fill(acct.recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()

    // The fix: after provisioning, navigateAfterLogin returns to /cli-auth?code=…
    // (pre-fix it landed on "/"). waitForURL observes SPA (pushState) routing
    // reliably; reaching /cli-auth after the /login bounce IS the closed gap.
    // (A brand-new, unverified account then runs its own first-run flow that can
    // move on from the authorize page — unrelated to the redirect under test; a
    // real returning CLI user is exercised by the vault-unlock case below.)
    await page.waitForURL(new RegExp(`/cli-auth\\?code=${code}`), { timeout: 25_000 })

    await freshCtx.close()
  })

  test('existing account, fresh device: cli-auth code SURVIVES device-provision — no later re-navigation home (1437)', async ({ browser }) => {
    // Task 1437's actual bug: the test above only checks that /cli-auth is
    // REACHED once (waitForURL resolves on the first match) — it never checks
    // the URL STAYS there. That's exactly the gap: GuestRoute (app.tsx) can
    // render one more time, AFTER navigateAfterLogin() has already pushed the
    // user to their real `?next=` destination, with a stale `user &&
    // isUnlocked` read that still fires its own `<Navigate to="/" replace/>`
    // — silently bouncing a CLI-auth approval onto the drive about a second
    // after the prompt was reached (eng-1392's original report, reproduced
    // against `qa0688content@beebeeb.io` on the shared dev stack). Phase 1
    // creates the account (so it's "existing" by the time phase 2 logs in on
    // a fresh device) — self-contained so this spec stays harness-portable
    // (isolated :3003 backend, no dependency on a hand-seeded fixture
    // account that only lives in the shared dev DB).
    const setupCtx = await browser.newContext()
    const setupPage = await setupCtx.newPage()
    await blockDevAutoLogin(setupPage)
    const acct = await signUp(setupPage)
    await setupCtx.close()

    const freshCtx = await browser.newContext()
    await freshCtx.addInitScript(() => {
      localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
      localStorage.setItem('bb_cookie_consent', 'all')
    })
    const page = await freshCtx.newPage()
    await blockDevAutoLogin(page)

    // page.evaluate() needs a secure context for crypto.subtle — about:blank
    // (the page's state before any navigation) doesn't count. Land on the
    // app origin first (redirects to /login unauthenticated, which is fine —
    // we navigate again below) so the WS-mint step below can use WebCrypto.
    await page.goto('/login')

    // A real code — not a made-up string — so the page actually reaches the
    // 'prompt' state (a fabricated code 404s at the cli-pubkey fetch and
    // renders the error state instead, which would falsely look like this
    // spec's own bug).
    const code = await mintRealCliCode(page)
    await page.goto(`/cli-auth?code=${code}`)

    await expect(page).toHaveURL(new RegExp(`/login\\?next=.*cli-auth.*${code}`), { timeout: 15_000 })
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })

    await page.getByLabel(/email/i).fill(acct.email)
    await page.getByPlaceholder('Your password').fill(acct.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const phraseInput = page.getByPlaceholder('word1 word2 word3 ... word12')
    await phraseInput.waitFor({ state: 'visible', timeout: 25_000 })
    await phraseInput.fill(acct.recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()

    // Reach /cli-auth?code=… once (the closed gap from the test above should
    // already cover this half).
    await page.waitForURL(new RegExp(`/cli-auth\\?code=${code}`), { timeout: 25_000 })

    // The bug under test (1437): the page then silently re-navigates to "/"
    // roughly a second later. Assert the URL — and the authorize prompt —
    // hold steady for a full 3s window with NO manual re-goto, sampling
    // frequently so a brief mid-window bounce can't hide between checks.
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      expect(new URL(page.url()).pathname).toBe('/cli-auth')
      await page.waitForTimeout(100)
    }

    await expect(page.getByRole('button', { name: /authorize cli access/i })).toBeVisible()

    await freshCtx.close()
  })
})
