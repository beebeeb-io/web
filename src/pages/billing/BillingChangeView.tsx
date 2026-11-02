/**
 *  The /billing change-plan view: plan intent, the current plan card, the
 *  cycle prompts, the comparison table, storage and invoice preferences.
 *
 *  The page shell renders it behind `view === 'change'`; the sections that
 *  own substantial state or markup live in their own files next to this one
 *  (task W run 5).
 */

import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { StorageBreakdown } from '../../components/storage-breakdown'
import { Card, SectionLabel } from './ui'
import { PaymentMethodPanel } from './PaymentMethodPanel'
import { PlanComparisonTable } from '../../components/plan-comparison'
import {
  isCancelledTrial,
  trialCancelledSwitchNote,
} from '../../lib/cycle-switch-copy'
import { trialTermsLine } from '../../lib/trial-checkout'
import {
  planMeta,
} from './upgrade-plans'
import { AnnualSwitchPrompt, MonthlySwitchPrompt } from './CycleSwitchPrompts'
import { CurrentPlanCard } from './CurrentPlanCard'
import { StorageAddonPanel } from './StorageAddonPanel'
import { InvoicePreferencesPanel } from './InvoicePreferencesPanel'
import { useBillingModel } from './model-context'

export function BillingChangeView() {
  const {
    setView,
    trialOffer,
    noCardTrial,
    sub,
    files,
    portalLoading,
    upgradeNextAvailableLabel,
    paymentMethod,
    pmLoaded,
    effectivePlan,
    planIntent,
    showPlanIntent,
    planIntentTrialEligible,
    totalStorageBytes,
    usedBytes,
    openUpgrade,
    openDowngrade,
    handleUpgradeOrTrial,
    handleUpdatePaymentMethod,
    handleStartTrial,
  } = useBillingModel()
  return (
    <>
        <div className="space-y-6">
        <button
          onClick={() => setView('summary')}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink transition-colors"
        >
          <Icon name="chevron-right" size={13} className="rotate-180" />
          Back to billing
        </button>

        {/* ── Plan picked before signup (flow-4 money flow) ── */}
        {showPlanIntent && planIntent && (
          <div
            data-testid="plan-intent-card"
            className="border border-amber/30 bg-amber-bg/30 rounded-xl p-5"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
              The plan you picked
            </div>
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-[22px] font-bold tracking-tight leading-none">
                {planMeta[planIntent.plan].label}
              </span>
              <BBChip variant={planIntent.cycle === 'yearly' ? 'amber' : undefined}>
                {planIntent.cycle === 'yearly' ? 'Billed yearly' : 'Billed monthly'}
              </BBChip>
            </div>
            {planIntentTrialEligible ? (
              <p className="text-sm text-ink-2 mb-4">
                {trialTermsLine(14, { noCardOffered: trialOffer?.kind === 'available' })}
              </p>
            ) : (
              <p className="text-sm text-ink-2 mb-4">
                This account has already used its free trial, so {planMeta[planIntent.plan].label}{' '}
                starts with checkout.
              </p>
            )}
            {planIntentTrialEligible ? (
              <BBButton
                variant="amber"
                size="md"
                onClick={() => handleStartTrial(planIntent.plan, planIntent.cycle)}
              >
                {`Start 14-day ${planMeta[planIntent.plan].label} trial`}
              </BBButton>
            ) : (
              <BBButton variant="amber" size="md" onClick={() => openUpgrade(planIntent.plan)}>
                Continue to checkout
              </BBButton>
            )}
          </div>
        )}

        {/* ── Plan summary ──────────────────────────── */}
        <div className="grid gap-4">

          {/* Task 1604 (c): a trial cancelled before its first charge (server
              #128) has no cycle to switch — replaces whichever switch-cycle
              prompt would otherwise have shown below. */}
          {isCancelledTrial(sub) && (
            <div className="border border-line rounded-xl p-5 bg-paper-2 text-sm text-ink-2">
              {trialCancelledSwitchNote()}
            </div>
          )}

          <AnnualSwitchPrompt />

          <CurrentPlanCard />

          <MonthlySwitchPrompt />
        </div>

        {/* ── Plan switcher (single source — task 1057) ───
            ONE plan-switcher: the "Compare plans" comparison table. It is
            rank-aware (Upgrade / Downgrade / Current / Coming-soon) and routes
            through the SAME handlers — an upgrade opens the upgrade dialog
            (openUpgrade), a downgrade opens the downgrade dialog (openDowngrade).
            Upgrades are gated by the 2/60d cap (can_upgrade); downgrades are
            never gated. The old "Switch plan" tier grid was removed — having two
            switchers was confusing. Renders for everyone (a free user sees every
            paid tier as an Upgrade; a paid user sees rank-aware Up/Downgrade). */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <SectionLabel className="mb-1">Compare plans</SectionLabel>
            <div className="text-sm text-ink-2" data-testid="compare-plans-copy">
              {effectivePlan === 'free' || noCardTrial
                ? 'All paid plans include encrypted storage, photo library, and EU data residency.'
                : 'Move to a different tier. Upgrades apply immediately; downgrades apply at your next renewal.'}
            </div>
          </div>
          <div className="p-5">
            <PlanComparisonTable
              // Task 1842: a no-card trial holds no plan, so no column is "Current", nothing is a
              // downgrade, and the upgrade rate limit (a subscription rule) does not apply.
              currentPlan={noCardTrial ? 'none' : effectivePlan}
              onUpgrade={noCardTrial ? openUpgrade : handleUpgradeOrTrial}
              onDowngrade={openDowngrade}
              canUpgrade={noCardTrial ? undefined : sub?.can_upgrade}
              upgradeNextAvailableLabel={noCardTrial ? null : upgradeNextAvailableLabel}
              ctaLabel={noCardTrial ? 'Choose' : undefined}
            />
          </div>
        </Card>

        {/* ── Payment method (native, task 0925) ─────────
            Paid, non-trialing subscribers manage their card here — no provider-
            hosted portal. Shows the card on file (brand + last4 + expiry, digits
            in mono) with a secondary "Update payment method", or an honest "No
            payment method on file" + "Add payment method" when the server has
            none (404). The button redirects to the provider's hosted re-auth.
            SEPA-aware (task 1064, D3): a directdebit mandate gets the same IBAN
            + mandate-reference fidelity as the summary view's payment-method
            card, instead of a misleading "Card" fallback — same field checks
            (type === 'directdebit' OR the mandate fields present) as above. */}
        {effectivePlan !== 'free' && sub?.status !== 'trialing' && pmLoaded && (
          <PaymentMethodPanel
            variant="detailed"
            method={paymentMethod}
            busy={portalLoading}
            onUpdate={() => void handleUpdatePaymentMethod()}
          />
        )}


        {/* ── Storage breakdown ──────────────────────── */}
        {usedBytes > 0 && (
          <div className="border border-line rounded-xl p-5 bg-paper">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-3">
              Storage breakdown
            </div>
            <StorageBreakdown
              usageBytes={usedBytes}
              quotaBytes={totalStorageBytes}
              planName={noCardTrial ? 'trial' : effectivePlan}
              files={files ?? undefined}
            />
          </div>
        )}

        <StorageAddonPanel />

        {/* Task 1057 — the duplicate "Unlock more / Compare plans" section was
            removed. The single plan-switcher (the "Compare plans" comparison
            table above, right after the Current-plan card) is now the only
            switcher. Downgrades route through the same openDowngrade handler;
            upgrades through openUpgrade, gated by the 2/60d cap. */}

        {/* Payment history + invoices live in the summary view (#7); not
            duplicated here. Invoice preferences (a management setting) stays. */}

        <InvoicePreferencesPanel />
        </div>
    </>
  )
}
