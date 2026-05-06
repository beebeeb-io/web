/**
 * Admin System Settings — read-only configuration overview.
 *
 * Shows live data from /health, /admin/storage-pools, and /billing/plans.
 * No edit forms — this is a diagnostic dashboard for admins, not a config editor.
 */

import { useState, useEffect } from 'react'
import { AdminShell } from './admin-shell'
import { Icon } from '@beebeeb/shared'
import { getHealth, listStoragePools, getPlans, getAdminConfig } from '../../lib/api'
import type { HealthResponse, StoragePool, AdminConfig } from '../../lib/api'
import { formatBytes } from '../../lib/format'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: {
  title: string
  icon: 'eye' | 'link' | 'shield' | 'cloud' | 'settings'
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-line bg-paper overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-paper-2">
        <Icon name={icon} size={13} className="text-ink-3 shrink-0" />
        <span className="text-[12px] font-semibold text-ink">{title}</span>
      </div>
      <dl className="divide-y divide-line">{children}</dl>
    </div>
  )
}

function ConfigRow({ label, value, status }: {
  label: string
  value: React.ReactNode
  status?: 'ok' | 'warn' | 'error' | 'off'
}) {
  const dotColor =
    status === 'ok' ? 'oklch(0.55 0.12 155)' :
    status === 'warn' ? 'var(--color-amber-deep)' :
    status === 'error' ? 'var(--color-red)' :
    'var(--color-ink-4)'

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="text-[11.5px] text-ink-3 font-mono uppercase tracking-wide shrink-0 pt-px">
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 text-right min-w-0">
        {status && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: dotColor }}
            aria-hidden="true"
          />
        )}
        <span className="text-[12px] text-ink font-mono truncate">{value}</span>
      </dd>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

export function AdminSettings() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [pools, setPools] = useState<StoragePool[]>([])
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null)
  const [config, setConfig] = useState<AdminConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getHealth().catch(() => null),
      listStoragePools().catch(() => [] as StoragePool[]),
      getPlans().then(() => true).catch(() => false),
      getAdminConfig().catch(() => null),
    ]).then(([h, p, stripe, cfg]) => {
      setHealth(h)
      setPools(p as StoragePool[])
      setStripeConnected(stripe as boolean)
      setConfig(cfg as AdminConfig | null)
    }).finally(() => setLoading(false))
  }, [])

  const defaultPool = pools.find(p => p.is_default)
  const activePools = pools.filter(p => p.is_active)
  const totalCapacity = pools.reduce((s, p) => s + (p.capacity_bytes ?? 0), 0)

  // Infer blob-store provider type from pool data or health string
  const blobStoreType =
    activePools.length === 0 ? 'Local (no pools)'
    : activePools[0]?.provider?.toLowerCase().includes('hetzner') ? 'S3 (Hetzner Object Storage)'
    : activePools[0]?.provider ? `S3 (${activePools[0].provider})`
    : health?.blob_store ?? '—'

  return (
    <AdminShell activeSection="settings">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="settings" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">System Settings</h2>
        <span className="ml-auto text-[11px] text-ink-4">Read-only · Restart server to apply config changes</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-[1100px]">

            {/* ── System Info ─────────────────────────────────────────── */}
            <SectionCard title="System Info" icon="eye">
              <ConfigRow
                label="API version"
                value={health?.version ?? '—'}
                status={health ? 'ok' : 'error'}
              />
              <ConfigRow
                label="Uptime"
                value={health ? formatUptime(health.uptime_seconds) : '—'}
              />
              <ConfigRow
                label="Status"
                value={health?.status ?? '—'}
                status={health?.status === 'ok' ? 'ok' : health ? 'warn' : 'error'}
              />
              <ConfigRow
                label="Database"
                value={health?.checks.database.status ?? '—'}
                status={health?.checks.database.status === 'ok' ? 'ok' : 'error'}
              />
              {health?.checks.database.latency_ms != null && (
                <ConfigRow
                  label="DB latency"
                  value={`${health.checks.database.latency_ms} ms`}
                  status={health.checks.database.latency_ms < 20 ? 'ok' : health.checks.database.latency_ms < 100 ? 'warn' : 'error'}
                />
              )}
              <ConfigRow
                label="WS connections"
                value={health?.websocket_connections?.toString() ?? '—'}
              />
              {health?.process_memory && (
                <ConfigRow
                  label="Process memory"
                  value={`${health.process_memory.rss_mb} MB`}
                />
              )}
              <ConfigRow
                label="Deployment"
                value="Single node"
              />
            </SectionCard>

            {/* ── Integrations ────────────────────────────────────────── */}
            <SectionCard title="Integrations" icon="link">
              <ConfigRow
                label="Stripe"
                value={
                  stripeConnected === null ? '—'
                  : stripeConnected ? 'Connected'
                  : 'Not configured'
                }
                status={
                  stripeConnected === null ? undefined
                  : stripeConnected ? 'ok'
                  : 'off'
                }
              />
              <ConfigRow
                label="Turnstile"
                value={
                  config
                    ? config.turnstile.configured
                      ? `Configured${config.turnstile.sitekey_prefix ? ` (${config.turnstile.sitekey_prefix}…)` : ''}`
                      : 'Not configured'
                    : TURNSTILE_SITEKEY
                      ? 'Sitekey configured'
                      : 'Not configured (dev mode)'
                }
                status={
                  config
                    ? config.turnstile.configured ? 'ok' : 'off'
                    : TURNSTILE_SITEKEY ? 'ok' : 'off'
                }
              />
              <ConfigRow
                label="Email"
                value={
                  config
                    ? config.email.configured
                      ? config.email.provider ?? 'Configured'
                      : 'Not configured'
                    : <span className="text-ink-4 italic">—</span>
                }
                status={config ? (config.email.configured ? 'ok' : 'off') : undefined}
              />
              <ConfigRow
                label="Slack alerting"
                value={
                  config
                    ? config.slack.configured
                      ? `Configured${config.slack.webhook_url_prefix ? ` (${config.slack.webhook_url_prefix}…)` : ''}`
                      : 'Not configured'
                    : <span className="text-ink-4 italic">—</span>
                }
                status={config ? (config.slack.configured ? 'ok' : 'off') : undefined}
              />
            </SectionCard>

            {/* ── Security Config ──────────────────────────────────────── */}
            <SectionCard title="Security Configuration" icon="shield">
              <ConfigRow
                label="OPAQUE auth"
                value="Enabled — all new signups"
                status="ok"
              />
              <ConfigRow
                label="Turnstile"
                value={TURNSTILE_SITEKEY ? 'Active on signup' : 'Disabled (no sitekey)'}
                status={TURNSTILE_SITEKEY ? 'ok' : 'off'}
              />
              <ConfigRow
                label="Rate limiting"
                value="Active"
                status="ok"
              />
              <ConfigRow
                label="Auth rate limit"
                value="20 req / 60 s"
              />
              <ConfigRow
                label="General rate limit"
                value="600 req / 60 s"
              />
              <ConfigRow
                label="Session TTL"
                value="30 days"
              />
              <ConfigRow
                label="Step-up re-auth"
                value="5 min token, single-use"
              />
            </SectionCard>

            {/* ── Storage Config ───────────────────────────────────────── */}
            <SectionCard title="Storage Configuration" icon="cloud">
              <ConfigRow
                label="Provider"
                value={blobStoreType}
                status={activePools.length > 0 ? 'ok' : 'warn'}
              />
              <ConfigRow
                label="Active pools"
                value={`${activePools.length} / ${pools.length} total`}
                status={activePools.length > 0 ? 'ok' : 'error'}
              />
              <ConfigRow
                label="Default pool"
                value={defaultPool?.display_name ?? '—'}
              />
              <ConfigRow
                label="Default region"
                value={
                  defaultPool
                    ? `${defaultPool.region} · ${defaultPool.provider}`
                    : '—'
                }
              />
              <ConfigRow
                label="Total capacity"
                value={totalCapacity > 0 ? formatBytes(totalCapacity) : '—'}
              />
              <ConfigRow
                label="Blob store check"
                value={health?.checks.blob_store.status ?? '—'}
                status={health?.checks.blob_store.status === 'ok' ? 'ok' : health ? 'warn' : undefined}
              />
            </SectionCard>

          </div>
        </div>
      )}
    </AdminShell>
  )
}
