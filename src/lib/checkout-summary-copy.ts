/**
 * Checkout "Due today" caption for UpgradeDialog step 1 (task 1542,
 * finding 2).
 *
 * Before this fix, this caption read "... excl. VAT" while showing the
 * plain catalog price (`apiPlan.price_eur`). The server's pricing-v2
 * catalog is VAT-INCLUSIVE gross — `pricing_v2_catalog.rs:41-42,90-91`
 * documents it as "The canonical, VAT-inclusive gross v2 target", and
 * `vat_engine.rs:775-776`'s `resolve_vat_inclusive` invariant is
 * `gross_cents == gross_incl_cents` (charge == price): VAT is backed OUT of
 * the catalog price, never added on top. Step 2 of the same flow
 * (`BillingInfoStep.tsx`, `data-testid="vat-preview"`) then shows the
 * identical number as the VAT-inclusive "Total" one click later. Labeling
 * it "excl. VAT" in step 1 was a wrong-price claim, not just a copy nit —
 * `vat_engine.rs` even cites a prior prod incident (0937) from treating
 * this same catalog price as net-excl-VAT and double-charging.
 */
export function dueTodayVatCaption(cycle: 'monthly' | 'yearly', amount: number): string {
  const unit = cycle === 'yearly' ? 'year' : 'month'
  return `EUR ${amount.toFixed(2)} / ${unit} incl. VAT · cancel anytime`
}
