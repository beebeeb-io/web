import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBButton } from '../../components/bb-button'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import {
  getStorageUsage, createPortalSession, getSubscription,
  type StorageUsage, type Subscription,
} from '../../lib/api'
import { StorageBreakdown } from '../../components/storage-breakdown'

export function SettingsPlan() {
  const { showToast } = useToast()

  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [sub, setSub] = useState<Subscription | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [usageData, subData] = await Promise.all([
          getStorageUsage().catch(() => null),
          getSubscription().catch(() => null),
        ])
        if (usageData) setUsage(usageData)
        if (subData) setSub(subData)
      } finally {
        setLoadingUsage(false)
      }
    }
    void load()
  }, [])

  const handleManageSubscription = useCallback(async () => {
    setPortalLoading(true)
    try {
      const result = await createPortalSession()
      if (result === null) {
        showToast({
          icon: 'cloud',
          title: 'Billing portal not available yet',
          description: 'Stripe billing is being set up. Check back soon.',
        })
        return
      }
      window.location.href = result.url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Billing portal unavailable',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setPortalLoading(false)
    }
  }, [showToast])

  return (
    <SettingsShell activeSection="plan">
      <SettingsHeader
        title="Storage & Plan"
        subtitle="How much you've used and the plan you're on."
      />

      {/* ── Storage breakdown ─────────────────────────────────────────────── */}
      <div className="mt-2 mb-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Storage
        </h2>
      </div>

      <SettingsRow label="Usage" hint="Encrypted storage used across all regions.">
        {loadingUsage ? (
          <div className="h-10 flex items-center">
            <span className="text-[12.5px] text-ink-3">Loading...</span>
          </div>
        ) : usage ? (
          <div className="max-w-[460px] w-full">
            <StorageBreakdown
              usageBytes={usage.used_bytes}
              quotaBytes={usage.plan_limit_bytes}
              planName={usage.plan_name}
            />
          </div>
        ) : (
          <span className="text-[12.5px] text-ink-3">Could not load usage data.</span>
        )}
      </SettingsRow>

      {/* ── Subscription ──────────────────────────────────────────────────── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Subscription
        </h2>
      </div>

      <SettingsRow
        label="Current plan"
        hint="Manage your plan, payment method, and invoices."
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-paper-2 border border-line">
            <span className="w-2 h-2 rounded-full bg-amber-deep shrink-0" />
            <span className="text-[13px] font-medium text-ink capitalize">
              {sub
                ? (sub.status === 'cancelled' ? 'Free' : (sub.plan ?? 'Free'))
                : 'Free'}
            </span>
            {sub && sub.plan && sub.plan !== 'free' && sub.status !== 'cancelled' && (
              <span className="text-[11px] text-ink-3 font-mono">
                {sub.billing_cycle === 'yearly' ? '· annual' : '· monthly'}
              </span>
            )}
          </div>

          {(!sub || sub.plan === 'free' || sub.status === 'cancelled') ? (
            <a
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all no-underline"
            >
              <Icon name="star" size={11} />
              Upgrade plan
            </a>
          ) : (
            <BBButton
              size="sm"
              variant="default"
              onClick={() => void handleManageSubscription()}
              disabled={portalLoading}
            >
              <Icon name="settings" size={12} className="mr-1.5" />
              {portalLoading ? 'Loading...' : 'Manage subscription'}
            </BBButton>
          )}

          <a
            href="/settings/billing"
            className="text-[12.5px] text-ink-3 hover:text-ink transition-colors no-underline"
          >
            View billing →
          </a>
        </div>
      </SettingsRow>
    </SettingsShell>
  )
}
