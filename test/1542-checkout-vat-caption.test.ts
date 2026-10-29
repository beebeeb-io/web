import { describe, expect, test } from 'bun:test'
import { dueTodayVatCaption } from '../src/lib/checkout-summary-copy'

/**
 * Task 1542, finding 2 — UpgradeDialog step 1 ("Due today") captioned the
 * catalog price as "excl. VAT", but the server's pricing-v2 catalog is
 * VAT-inclusive gross (pricing_v2_catalog.rs:41-42,90-91;
 * vat_engine.rs:775-776's `resolve_vat_inclusive` invariant
 * `gross_cents == gross_incl_cents` — the catalog price never has VAT added
 * to it). Step 2 of the SAME flow (BillingInfoStep.tsx) then shows the
 * identical number as the VAT-inclusive "Total". `dueTodayVatCaption` is
 * the extracted, pure caption builder the dialog now calls — no React, no
 * rendering (this repo's `bun test` harness has no @testing-library/react /
 * jsdom, per test/1471-isloggedin-auth-context.test.ts's header comment).
 */

describe('dueTodayVatCaption() — finding 2, VAT-inclusive catalog price mislabeled as excl.', () => {
  test('monthly caption says "incl. VAT", never "excl. VAT"', () => {
    const caption = dueTodayVatCaption('monthly', 10.99)
    expect(caption).toContain('incl. VAT')
    expect(caption).not.toContain('excl. VAT')
  })

  test('yearly caption says "incl. VAT", never "excl. VAT"', () => {
    const caption = dueTodayVatCaption('yearly', 105.5)
    expect(caption).toContain('incl. VAT')
    expect(caption).not.toContain('excl. VAT')
  })

  test('still carries the amount, unit, and cancel-anytime copy', () => {
    const caption = dueTodayVatCaption('monthly', 10.99)
    expect(caption).toBe('EUR 10.99 / month incl. VAT · cancel anytime')
  })
})
