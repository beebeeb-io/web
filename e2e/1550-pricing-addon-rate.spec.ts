/**
 * 1550 — the Pro card on the pricing page must not contradict itself about
 * the storage add-on rate.
 *
 * The bug (task 1548 Finding 2, confirmed against repos/web main @ d730da5,
 * 2026-09-25): pricing.tsx's `plans` useMemo overwrites the (correct) static
 * `note`/`perTb` copy from plan-constants.ts with a value computed as
 * `ap.price_eur / tbCount` — the BASE plan price divided by the BASE TB
 * count. For Pro (price_eur=10.99, storage_bytes=1 TB) that's 10.99/1 =
 * 10.99, which is the base plan's own unit economics, not the marginal cost
 * of an EXTRA TB (the real, charged add-on rate is €14.99/TB — task 1463).
 * The static `features` array is never touched by that override, so the
 * SAME card ends up showing "€10.99/TB" in the price sub-line/chip and
 * "€14.99/TB" three lines below in the feature bullet.
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

// Public page, no auth needed — run as a clean, logged-out visitor regardless
// of the 'authenticated' project's default storageState.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('1550 — pricing page Pro card storage add-on rate', () => {
  test('note, perTb chip, and feature bullet all agree on the €14.99/TB add-on rate', async ({
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
    // both read the REAL marginal add-on rate, not the base-price/base-TB
    // quotient — and must never regress to showing "10.99" as a per-TB figure.
    const note = proCard.getByTestId('plan-note')
    const perTb = proCard.getByTestId('plan-per-tb')
    await expect(note).toContainText('€14.99/TB')
    await expect(perTb).toContainText('€14.99/TB')
    await expect(note).not.toContainText('€10.99/TB')
    await expect(perTb).not.toContainText('€10.99/TB')

    // The feature bullet was always correct — assert it stays that way, and
    // that it now AGREES with the note/perTb chip above (the actual bug: two
    // different numbers for the same thing on one card).
    const addonFeature = proCard.getByTestId('plan-feature').filter({ hasText: 'Add storage' })
    await expect(addonFeature).toContainText('€14.99/TB')

    const noteText = (await note.textContent()) ?? ''
    const perTbText = (await perTb.textContent()) ?? ''
    const featureText = (await addonFeature.textContent()) ?? ''
    const rate = (s: string) => s.match(/€([\d.]+)\/TB/)?.[1]
    expect(rate(noteText)).toBe(rate(featureText))
    expect(rate(perTbText)).toBe(rate(featureText))
  })
})
