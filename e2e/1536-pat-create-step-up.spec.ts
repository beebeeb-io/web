import { test, expect, type Page } from '@playwright/test'

/**
 * Task 1536 (web half) — real-stack proof that `createToken()`'s new
 * `X-Confirm-Token` header (added by this task, src/lib/api.ts) is HARMLESS
 * against the CURRENT (main, pre-server-#98) API: `POST /api/v1/tokens` on
 * that branch does not read the header at all (verified read-only against
 * repos/server/beebeeb-api/src/routes/tokens.rs on main — no
 * `ConfirmedAction`/header extraction in `create_token`), so sending it
 * alongside a normal create-token request must succeed exactly as before,
 * and a request that OMITS it must also still succeed (today's server never
 * required it — server PR #98, which this harness does NOT build, is what
 * starts requiring it for session-authenticated callers).
 *
 * This harness (e2e/scripts/web-e2e.sh) builds repos/server's PRIMARY
 * checkout — main, i.e. WITHOUT #98 — so it structurally cannot exercise
 * the NEW 403-without-header behaviour #98 introduces, or the step-up
 * dialog's wiring in developer.tsx (which the product does not currently
 * expose — Settings → Developer is a "Coming soon" placeholder as of commit
 * 85c8fdc; the PAT UI is preserved as commented-out code pending
 * re-enablement, so there is no live "Create token" button to click
 * through). That half of the contract — createToken carries the header
 * when given one, and a 403 confirmation_required surfaces the server's own
 * honest message rather than a generic failure — is proven by the unit
 * test test/1536-pat-create-step-up.test.ts (a mocked fetch, RED-then-green
 * directly against api.ts; see that file for the RED proof). A
 * unit/mocked test is the right tool for the #98 behaviour specifically,
 * per this task's brief, since building #98 is out of scope here.
 *
 * What THIS spec proves is the thing a mock cannot: that shipping the new
 * header early does not regress anything a real, currently-running server
 * actually does — driven via `page.request`, which shares the browser
 * context's cookie jar (the httpOnly `bb_session` cookie `credentials:
 * 'include'` relies on), i.e. the same authenticated session the app itself
 * would use.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 10_000 })
    .toBe(true)
}

function uniqueDevEmail(label: string): string {
  return `pat-e2e-1536-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`
}

test.describe("task 1536: createToken's new X-Confirm-Token header is harmless against the current (pre-#98) server", () => {
  test('POST /api/v1/tokens succeeds WITH an X-Confirm-Token header — the current server ignores it, neither requiring nor rejecting it', async ({
    page,
  }) => {
    await devLogin(page, uniqueDevEmail('withheader'))

    const res = await page.request.post(`${API_URL}/api/v1/tokens`, {
      headers: { 'X-Confirm-Token': 'not-a-real-confirmation-token-at-all' },
      data: { name: 'e2e-1536-with-header', scopes: [], expires_in_days: null },
    })

    expect(res.status(), `POST /api/v1/tokens with X-Confirm-Token: ${res.status()} ${await res.text()}`).toBe(201)
    const body = (await res.json()) as { token: string; name: string }
    expect(body.name).toBe('e2e-1536-with-header')
    expect(body.token).toMatch(/^bb_pat_/)
  })

  test('POST /api/v1/tokens still succeeds WITHOUT the header — the current server never required it', async ({
    page,
  }) => {
    await devLogin(page, uniqueDevEmail('noheader'))

    const res = await page.request.post(`${API_URL}/api/v1/tokens`, {
      data: { name: 'e2e-1536-no-header', scopes: [], expires_in_days: null },
    })

    expect(res.status(), `POST /api/v1/tokens with no header: ${res.status()} ${await res.text()}`).toBe(201)
    const body = (await res.json()) as { token: string; name: string }
    expect(body.name).toBe('e2e-1536-no-header')
  })
})
