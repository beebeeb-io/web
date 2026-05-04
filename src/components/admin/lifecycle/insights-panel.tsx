/**
 * Insights panel — Phase 1 of the pool decommission wizard.
 *
 * Renders when the pool's lifecycle_phase is 'active'. Shows a 2×2 KPI grid
 * of pool stats, a target pool selector, and the "Begin decommission" CTA.
 */

import { useState } from 'react'
import { BBButton } from '../../bb-button'
import { Icon } from '../../icons'
import { formatBytes } from '../../../lib/format'
import { startLifecycleRun, type PoolInsights, type StoragePool } from '../../../lib/api'
import { ConfirmationModal } from './confirmation-modal'

// ─── Speed presets ────────────────────────────────────────────────────────────

type SpeedPreset = 'ssd' | 'gbit' | 'cross' | 'custom'

interface Preset {
  label: string
  mbps: number
}

const SPEED_PRESETS: Record<SpeedPreset, Preset> = {
  ssd:    { label: 'Same DC — SSD (50 MB/s)', mbps: 50 },
  gbit:   { label: 'Same DC — 1 Gbit (125 MB/s)', mbps: 125 },
  cross:  { label: 'Cross-region (25 MB/s)', mbps: 25 },
  custom: { label: 'Custom…', mbps: 50 },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMigrationTime(seconds: number): string {
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function computeEta(bytes: number, mbps: number): string {
  if (bytes === 0) return '< 1 min'
  const seconds = Math.ceil(bytes / (mbps * 1_000_000))
  return formatMigrationTime(seconds)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InsightsPanelProps {
  poolId: string
  poolName: string
  insights: PoolInsights
  otherActivePools: StoragePool[]
  onRunStarted: () => void
}

export function InsightsPanel({
  poolId,
  poolName,
  insights,
  otherActivePools,
  onRunStarted,
}: InsightsPanelProps) {
  const [targetPoolId, setTargetPoolId] = useState<string>(
    otherActivePools[0]?.id ?? '',
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Speed preset for client-side ETA calculation.
  // Default: conservative SSD bottleneck (50 MB/s) rather than peak network.
  const [speedPreset, setSpeedPreset] = useState<SpeedPreset>('ssd')
  const [customMbps, setCustomMbps] = useState<string>('50')

  const effectiveMbps =
    speedPreset === 'custom'
      ? Math.max(1, parseFloat(customMbps) || 50)
      : SPEED_PRESETS[speedPreset].mbps

  const etaDisplay = computeEta(insights.used_bytes, effectiveMbps)

  async function handleBeginDecommissionConfirmed() {
    if (!targetPoolId) return
    setError(null)
    setSubmitting(true)
    try {
      await startLifecycleRun(poolId, targetPoolId)
      setConfirmOpen(false)
      onRunStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start decommission run.')
    } finally {
      setSubmitting(false)
    }
  }

  const canStart = !!targetPoolId && !submitting && otherActivePools.length > 0
  const targetPool = otherActivePools.find((p) => p.id === targetPoolId)
  const targetName = targetPool?.display_name || targetPool?.name || 'the target pool'

  return (
    <div>
      {/* Section header */}
      <p className="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">
        Pool usage
      </p>

      {/* 2×2 KPI grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Storage used</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight">
            {formatBytes(insights.used_bytes)}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Files</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight">
            {insights.files_count.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Users with files</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight">
            {insights.users_with_files_count.toLocaleString()}
          </div>
          {insights.currently_active_users_count > 0 && (
            <div className="font-mono text-[10px] text-ink-3 mt-0.5">
              {insights.currently_active_users_count} active now
            </div>
          )}
        </div>
        {/* ETA card — client-side calculation with speed selector */}
        <div className="rounded-lg border border-line bg-paper p-3 min-w-0">
          <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Est. migration</div>
          <div className="font-mono text-lg font-bold text-ink leading-tight mb-2">
            {etaDisplay}
          </div>
          {/* Speed selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-ink-4 shrink-0">Speed</span>
            <select
              value={speedPreset}
              onChange={(e) => setSpeedPreset(e.target.value as SpeedPreset)}
              className="flex-1 bg-paper-2 border border-line rounded px-1.5 py-0.5 text-[10px] font-mono text-ink focus:outline-none focus:ring-1 focus:ring-amber/40 min-w-0"
            >
              {(Object.entries(SPEED_PRESETS) as [SpeedPreset, Preset][]).map(
                ([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ),
              )}
            </select>
          </div>
          {speedPreset === 'custom' && (
            <div className="flex items-center gap-1 mt-1.5">
              <input
                type="number"
                min="1"
                value={customMbps}
                onChange={(e) => setCustomMbps(e.target.value)}
                className="w-16 bg-paper-2 border border-line rounded px-1.5 py-0.5 text-[10px] font-mono text-ink focus:outline-none focus:ring-1 focus:ring-amber/40"
                placeholder="50"
              />
              <span className="text-[10px] text-ink-4">MB/s</span>
            </div>
          )}
          {insights.in_flight_uploads_count > 0 && (
            <div className="font-mono text-[10px] text-amber-deep mt-1">
              {insights.in_flight_uploads_count} uploads in flight
            </div>
          )}
        </div>
      </div>

      {/* Target pool selector */}
      <div className="rounded-lg border border-line bg-paper overflow-hidden mb-5">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
          <Icon name="cloud" size={12} className="text-ink-2" />
          <span className="text-[12px] font-semibold text-ink">Migration target</span>
        </div>
        <div className="px-4 py-4">
          {otherActivePools.length === 0 ? (
            <p className="text-sm text-red">
              No other active pool available. Add a target pool before decommissioning.
            </p>
          ) : (
            <>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">
                Migrate all files to
              </label>
              <select
                value={targetPoolId}
                onChange={(e) => setTargetPoolId(e.target.value)}
                disabled={submitting}
                className="w-full bg-paper border border-line rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep disabled:opacity-50"
              >
                {otherActivePools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name || p.name} — {formatBytes(p.used_bytes)} used
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-4 mt-1.5">
                New uploads will route here immediately once quiescing starts.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red mb-3">{error}</p>}

      {/* CTA */}
      <BBButton
        variant="amber"
        size="lg"
        className="w-full"
        disabled={!canStart}
        onClick={() => setConfirmOpen(true)}
      >
        Begin decommission
        <Icon name="chevron-right" size={14} className="ml-1.5" />
      </BBButton>

      {/* Confirmation modal */}
      <ConfirmationModal
        open={confirmOpen}
        title="Begin decommission?"
        description={
          <>
            <p>
              <span className="font-mono font-semibold">{insights.files_count.toLocaleString()}</span>{' '}
              file{insights.files_count !== 1 ? 's' : ''} across{' '}
              <span className="font-mono font-semibold">{insights.users_with_files_count.toLocaleString()}</span>{' '}
              user{insights.users_with_files_count !== 1 ? 's' : ''} will be migrated to{' '}
              <span className="font-semibold">{targetName}</span>.
            </p>
            <p className="mt-2">
              The pool becomes read-only immediately. You can abort at any point before migration completes.
            </p>
          </>
        }
        confirmationText={poolName}
        confirmLabel="Start decommission"
        variant="warning"
        onConfirm={handleBeginDecommissionConfirmed}
        onCancel={() => {
          setConfirmOpen(false)
          setError(null)
        }}
        loading={submitting}
      />
    </div>
  )
}
