/**
 * `/billing` — the account's money page.
 *
 * This file is only the shell (task W run 5): it mounts the page model
 * (`useBillingPage`), renders the loading/error states and puts the views in
 * order. The state, the server calls and their side effects live in
 * `./billing/use-billing-page.ts`; the views live next to it in
 * `./billing/*.tsx` and read the typed model through
 * `./billing/model-context.tsx`.
 */

import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton, Icon } from '@beebeeb/shared'
import { UpgradeDialog } from '../components/upgrade-dialog'
import { DowngradeDialog } from '../components/downgrade-dialog'
import { setPendingCheckout, makePreState } from '../lib/pending-checkout'
import { BillingModelProvider } from './billing/model-context'
import { useBillingPage } from './billing/use-billing-page'
import { BillingNotices } from './billing/BillingNotices'
import { BillingSummaryView } from './billing/BillingSummaryView'
import { BillingChangeView } from './billing/BillingChangeView'
import { BillingAddonDialog } from './billing/BillingAddonDialog'

export function BillingPage() {
  const model = useBillingPage()
  const {
    loading,
    error,
    loadData,
    view,
    meta,
    noCardTrial,
    upgradePlanDetails,
    upgradePlan,
    upgradeOpen,
    setUpgradeOpen,
    sub,
    downgradeTarget,
    setDowngradeTarget,
    effectivePlan,
    usedBytes,
  } = model

  if (loading) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" subtitle="Loading..." />
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </SettingsShell>
    )
  }

  /* ── Error state ───────────────────────────────────── */

  if (error) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" />
        <div className="py-16 text-center">
          <div className="text-sm text-red mb-2">{error}</div>
          <BBButton size="sm" variant="ghost" onClick={() => void loadData()}>Retry</BBButton>
        </div>
      </SettingsShell>
    )
  }

  return (
    <BillingModelProvider model={model}>
      <SettingsShell activeSection="billing">
        {/* Title differs by view (task 0942): the summary (#7) is the account-level
            "Billing" overview; the change view (#8) keeps the plan-centric heading. */}
        {view === 'summary' ? (
          <SettingsHeader
            title="Billing"
            subtitle="Manage your plan, payment method, and invoices."
          />
        ) : (
          <SettingsHeader
            title="Plan & billing"
            subtitle={noCardTrial ? 'Choose the plan you want to keep when the trial ends.' : meta.tagline}
          />
        )}

        <div className="p-7 space-y-6">
          <BillingNotices />
          {view === 'summary' && <BillingSummaryView />}
          {view === 'change' && <BillingChangeView />}

          {/* ── Footer: VAT + DPA + Need help ──────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3.5 px-5 py-3.5 bg-paper-2 border border-line rounded-xl text-[11.5px] text-ink-3">
              <Icon name="shield" size={13} className="text-amber-deep shrink-0" />
              <span className="flex-1">
                All invoices are VAT-compliant (EU reverse charge). Standard DPA available.
              </span>
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => window.open('https://beebeeb.io/dpa', '_blank')}
              >
                Review DPA
              </BBButton>
            </div>

            <div className="flex items-center gap-3.5 px-5 py-3.5 border border-line rounded-xl text-[11.5px]">
              <Icon name="mail" size={13} className="text-ink-3 shrink-0" />
              <div className="flex-1">
                <span className="text-ink-2">Need help with billing?</span>
                <span className="text-ink-3 ml-1">
                  Reach us at{' '}
                  <a
                    href="mailto:billing@beebeeb.io"
                    className="text-amber-deep hover:underline font-medium"
                  >
                    billing@beebeeb.io
                  </a>
                </span>
              </div>
            </div>
          </div>
        </div>

        <BillingAddonDialog />

        {/* Upgrade dialog */}
        {/* Task 1701 — rendered only when a real plan card resolves (API row or
            plan-constants). The old `?? 39.95` / `?? 383.52` literals were an
            unreachable-in-practice fallback that would have shown a made-up
            price for a plan that resolved to nothing. */}
        {upgradePlanDetails && (
          <UpgradeDialog
            planId={upgradePlan}
            planName={upgradePlanDetails.label}
            pricePerSeat={upgradePlanDetails.priceMonthly}
            priceYearlySeat={upgradePlanDetails.priceYearly}
            open={upgradeOpen}
            onClose={() => setUpgradeOpen(false)}
            // Task 1707 — the dialog needs to know when its target plan+cycle IS
            // the user's active subscription (stale plan-intent revisit, racing
            // state) so it can label the CTA "Current plan" instead of starting a
            // checkout the server's same-plan guard refuses.
            activePlanCycle={sub?.status === 'active' ? { plan: sub.plan, cycle: sub.billing_cycle } : null}
            onBeforeRedirect={(plan, cycle, paymentId) => setPendingCheckout('plan', plan, cycle, makePreState(sub), paymentId)}
            // Task 1707 review #133-A — the same-plan 409 proves `sub` was stale:
            // reload the billing page's subscription state (and the shared plan
            // details via the plan-changed signal) before the dialog closes, so
            // the obsolete snapshot stops re-offering the purchase. Distinct from
            // onSuccess, which stays reserved for real completions.
            onStaleSnapshot={() => {
              void loadData()
              window.dispatchEvent(new Event('beebeeb:plan-changed'))
            }}
            onSuccess={() => {
              void loadData()
              window.dispatchEvent(new Event('beebeeb:plan-changed'))
            }}
          />
        )}

        {/* Downgrade dialog */}
        {downgradeTarget && (
          <DowngradeDialog
            currentPlan={effectivePlan}
            targetPlan={downgradeTarget}
            currentUsageBytes={usedBytes}
            effectiveDate={sub?.current_period_end ?? null}
            // Task 1057 — downgrades are NEVER gated; no rate-limit props.
            open={!!downgradeTarget}
            onClose={() => setDowngradeTarget(null)}
            onSuccess={() => {
              window.dispatchEvent(new Event('beebeeb:plan-changed'))
              loadData()
            }}
          />
        )}
      </SettingsShell>
    </BillingModelProvider>
  )
}

/** The route entry keeps the name the router mounts it under. */
export const Billing = BillingPage
