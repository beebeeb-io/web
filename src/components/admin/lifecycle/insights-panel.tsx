/**
 * Insights panel — Phase 1 of the pool decommission wizard.
 *
 * Renders when the pool's lifecycle_phase is 'active'. Shows storage facts
 * about the pool, an estimated migration time, a target pool selector, and
 * the "Begin decommission" CTA that kicks off the lifecycle run.
 */

import { useState } from 'react'
import { BBButton } from '../../bb-button'
import { Icon } from '../../icons'
import { formatBytes } from '../../../lib/format'
import { startLifecycleRun, type PoolInsights, type StoragePool } from '../../../lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format seconds as "~Xh Ym", "~Ym", or "< 1 min". */
function formatMigrationTime(seconds: number): string {
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  return `~${m}m`
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | number
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line last:border-0">
      <span className="text-sm text-ink-2">{label}</span>
      <span
        className={`text-sm font-medium text-ink ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InsightsPanelProps {
  poolId: string
  insights: PoolInsights
  /** All currently-active pools excluding this one — candidates for migration target. */
  otherActivePools: StoragePool[]
  /** Called after a run is successfully started so the parent re-fetches. */
  onRunStarted: () => void
}

export function InsightsPanel({
  poolId,
  insights,
  otherActivePools,
  onRunStarted,
}: InsightsPanelProps) {
  const [targetPoolId, setTargetPoolId] = useState<string>(
    otherActivePools[0]?.id ?? '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBeginDecommission() {
    if (!targetPoolId) return

    const target = otherActivePools.find((p) => p.id === targetPoolId)
    const targetName = target?.display_name ?? target?.name ?? 'the target pool'

    // TODO(task-7): replace window.confirm with the shared ConfirmationModal.
    const ok = window.confirm(
      `Start decommissioning this pool?\n\n` +
        `${insights.files_count.toLocaleString()} file${insights.files_count !== 1 ? 's' : ''} ` +
        `across ${insights.users_with_files_count.toLocaleString()} ` +
        `user${insights.users_with_files_count !== 1 ? 's' : ''} will be migrated ` +
        `to ${targetName}.\n\n` +
        `The pool will become read-only immediately. ` +
        `You can abort at any point until migration completes.`,
    )
    if (!ok) return

    setError(null)
    setSubmitting(true)
    try {
      await startLifecycleRun(poolId, targetPoolId)
      onRunStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start decommission run.')
    } finally {
      setSubmitting(false)
    }
  }

  const canStart = !!targetPoolId && !submitting

  return (
    <div className="max-w-xl">
      {/* Heading */}
      <h3 className="text-base font-semibold text-ink mb-0.5">
        Pool insights
      </h3>
      <p className="text-sm text-ink-3 mb-5">
        Review what is stored here before starting decommission.
        Migration runs in the background — you can abort until it completes.
      </p>

      {/* Stats card */}
      <div className="bg-paper-2 border border-line rounded-lg px-4 py-1 mb-5">
        <Stat
          label="Storage used"
          value={`${formatBytes(insights.used_bytes)} · ${insights.files_count.toLocaleString()} file${insights.files_count !== 1 ? 's' : ''}`}
          mono
        />
        <Stat
          label="Users with files"
          value={`${insights.users_with_files_count.toLocaleString()} total`}
          mono
        />
        <Stat
          label="Currently active users"
          value={insights.currently_active_users_count.toLocaleString()}
          mono
        />
        {insights.in_flight_uploads_count > 0 && (
          <Stat
            label="In-flight uploads"
            value={insights.in_flight_uploads_count.toLocaleString()}
            mono
          />
        )}
        <Stat
          label="Estimated migration time"
          value={formatMigrationTime(insights.estimated_migration_seconds)}
          mono
        />
      </div>

      {/* Target pool selector */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-ink-2 mb-1.5">
          Migrate to
        </label>
        {otherActivePools.length === 0 ? (
          <p className="text-sm text-red">
            No other active pool available. Add a target pool before decommissioning.
          </p>
        ) : (
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
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red mb-3">{error}</p>
      )}

      {/* CTA */}
      <div className="flex items-center gap-3">
        <BBButton
          variant="amber"
          size="lg"
          disabled={!canStart || otherActivePools.length === 0}
          onClick={handleBeginDecommission}
        >
          {submitting ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
              Starting…
            </>
          ) : (
            <>
              Begin decommission
              <Icon name="chevron-right" size={14} className="ml-1.5" />
            </>
          )}
        </BBButton>
      </div>

      {/* Fine print */}
      <p className="text-xs text-ink-4 mt-4 leading-relaxed">
        The pool becomes read-only as soon as you proceed.
        New uploads route to the target immediately.
        Files migrate in the background — you can abort at any time before migration completes.
      </p>
    </div>
  )
}
