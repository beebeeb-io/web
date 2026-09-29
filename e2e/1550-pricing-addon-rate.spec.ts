/**
 * 1550 — the Pro card on the pricing page must not contradict itself about
 * the storage add-on rate.
 *
 * The bug (task 1548 Finding 2, confirmed against repos/web main @ d730da5,
 * 2026-09-25): pricing.tsx's `plans` useMemo overwrote the (correct) static
 * `note`/`perTb` copy from plan-constants.ts with a value computed as
 * `ap.price_eur / tbCount` — the BASE plan price divided by the BASE TB
 * count — instead of the real marginal add-on rate for an extra TB.
 *
 * Task 1607 (Guus ruling, 2026-09-29) reverted the add-on rate from €14.99
 * back to €10.99/TB, which for Pro (1 TB base, €10.99/mo) makes
 * price_eur/tbCount (10.99/1 = 10.99) EQUAL the real add-on rate — so the
 * original bug's SYMPTOM (two different numbers on one card) is no longer
 * visible against this fixture. The regression is now guarded two ways:
 *   1. this spec (full-stack, real harness backend) asserts note/perTb/
 *      feature all show the add-on constant and never mention the old
 *      €14.99 rate — a coarse "still says the right number" check.
 *   2. test/pricing-addon-display-1550.test.ts unit-tests the extracted
 *      `deriveAddonAwarePriceDisplay` helper (src/lib/plan-pricing.ts) with
 *      a MOCKED plan whose price_eur/storage_bytes quotient deliberately
 *      differs from an injected "real" add-on rate, and proves the injected
 *      rate wins — that is the actual bug-class guard now that the real Pro
 *      fixture can't distinguish the two formulas by coincidence.
 *
 * This spec runs against the REAL, freshly-seeded harness backend (no
 * page.route mocking) — a fresh DB has no published plan_catalog rows, so
 * `GET /api/v1/billing/plans` falls back to the server's hardcoded
 * pricing-v2 plans (billing.rs `hardcoded_paid_plans()`), which is exactly
 * the live shape the finding's evidence was captured against
 * (price_eur:10.99, storage_bytes:1_000_000_000_000, coming_soon:false).
 *
 * Run (own port triple, never the shared :3003/:5173/beebeeb_web_e2e_3003):
 *   E2E_API_PORT=3150 E2E_VITE_PORT=5350 E2E_DB_NAME=beebeeb_web_e2e_1550 \
 *     bash e2e/scripts/web-e2e.sh e2e/1550-pricing-addon-rate.spec.ts
 */
import { test, expect } from '@playwright/test'
import { STORAGE_ADDON_EUR_PER_TB } from '../src/lib/plan-constants'

// Public page, no auth needed — run as a clean, logged-out visitor regardless
// of the 'authenticated' project's default storageState.
test.use({ storageState: { cookies: [], origins: [] } })

const ADDON_RATE_STR = `€${STORAGE_ADDON_EUR_PER_TB}/TB`

test.describe('1550 — pricing page Pro card storage add-on rate', () => {
  test('note, perTb chip, and feature bullet all agree on the live add-on constant, and none show the stale €14.99 rate', async ({
    page,
  }) => {
    const plansResponse = page.waitForResponse(
      (r) => r.url().includes('/api/v1/billing/plans') && r.ok(),
    )
    await page.goto('/pricing?nodev=1')
    const res = await plansResponse
    const body = (await res.json()) as { plans: { id: string; price_eur: number; storage_bytes: number }[] }
    const proFromApi = body.plans.find((p) => p.id === 'pro')
    // Sanity: this spec's assertions only mean something against the exact
    // catalogue shape the finding was reported against (base price === the
    // wrong number the bug used to render). If the fixture drifts, fail loud
    // rather than silently passing against a different scenario.
    expect(proFromApi?.price_eur).toBe(10.99)
    expect(proFromApi?.storage_bytes).toBe(1_000_000_000_000)

    const proCard = page.getByTestId('plan-card-pro')
    await expect(proCard).toBeVisible()

    // The price sub-line ("1 TB · €X/TB") and the perTb chip ("€X/TB") must
    // both read the REAL marginal add-on rate (task 1607: €10.99/TB) and
    // must never regress to showing the pre-1607 €14.99 rate.
    const note = proCard.getByTestId('plan-note')
    const perTb = proCard.getByTestId('plan-per-tb')
    await expect(note).toContainText(ADDON_RATE_STR)
    await expect(perTb).toContainText(ADDON_RATE_STR)
    await expect(note).not.toContainText('14.99')
    await expect(perTb).not.toContainText('14.99')

    // The feature bullet was always correct — assert it stays that way, and
    // that it now AGREES with the note/perTb chip above (the actual bug: two
    // different numbers for the same thing on one card).
    const addonFeature = proCard.getByTestId('plan-feature').filter({ hasText: 'Add storage' })
    await expect(addonFeature).toContainText(ADDON_RATE_STR)
    await expect(addonFeature).not.toContainText('14.99')

    const noteText = (await note.textContent()) ?? ''
    const perTbText = (await perTb.textContent()) ?? ''
    const featureText = (await addonFeature.textContent()) ?? ''
    const rate = (s: string) => s.match(/€([\d.]+)\/TB/)?.[1]
    expect(rate(noteText)).toBe(rate(featureText))
    expect(rate(perTbText)).toBe(rate(featureText))

    // No "14.99" anywhere on the Pro card at all — belt-and-braces against
    // the stale rate surfacing in copy this spec doesn't otherwise inspect.
    const cardText = (await proCard.textContent()) ?? ''
    expect(cardText).not.toContain('14.99')
  })
})
