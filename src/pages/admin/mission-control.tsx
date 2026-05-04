/**
 * Mission Control — live migration monitor page.
 *
 * Route: /admin/infrastructure/pools/:poolId/runs/:runId/monitor
 *
 * Polls getLifecycleRun + getLifecycleRunFiles every 2 s as a placeholder
 * until the real WebSocket (014a) is available. Two-column layout: main
 * (~70%) for KPI strip + file log, sidebar (~30%) for error panel + timeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AdminShell } from './admin-shell'
import { BBButton } from '../../components/bb-button'
import { Icon } from '../../components/icons'
import {
  getLifecycleRun,
  getLifecycleRunFiles,
  abortLifecycleRun,
  listStoragePools,
  type RunProgress,
  type RunFileEntry,
  type StoragePool,
} from '../../lib/api'
import { KpiStrip } from '../../components/admin/mission-control/kpi-strip'
import { ErrorPanel } from '../../components/admin/mission-control/error-panel'
import { TimelinePanel } from '../../components/admin/mission-control/timeline-panel'
import {
  ConnectionIndicator,
  type ConnectionStatus,
} from '../../components/admin/mission-control/connection-indicator'
import { PhaseBadge } from '../../components/admin/lifecycle/phase-badge'

const POLL_INTERVAL_MS = 2_000

export function MissionControl() {
  const { poolId, runId } = useParams<{ poolId: string; runId: string }>()
  const navigate = useNavigate()

  const [pool, setPool] = useState<StoragePool | null>(null)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [files, setFiles] = useState<RunFileEntry[]>([])
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('polling')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Pause modal state
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async () => {
    if (!poolId || !runId) return
    try {
      const [p, f] = await Promise.all([
        getLifecycleRun(poolId, runId),
        getLifecycleRunFiles(poolId, runId).catch(() => ({ files: [], total: 0 })),
      ])
      setProgress(p)
      setFiles(f.files)
      setLastUpdated(new Date())
      setConnectionStatus('polling')
      setLoadError(null)

      // Auto-navigate away if migration completed/aborted
      if (p.run.current_phase !== 'migrating') {
        stopPoll()
        navigate(`/admin/infrastructure/pools/${poolId}`, { replace: true })
      }
    } catch (err) {
      setConnectionStatus('reconnecting')
      setLoadError(err instanceof Error ? err.message : 'Failed to fetch data.')
    }
  }, [poolId, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Initial load + poll
  useEffect(() => {
    void fetchAll()
    pollRef.current = setInterval(() => void fetchAll(), POLL_INTERVAL_MS)
    return () => stopPoll()
  }, [fetchAll])

  // Fetch pool name once
  useEffect(() => {
    if (!poolId) return
    listStoragePools()
      .then((pools) => setPool(pools.find((p) => p.id === poolId) ?? null))
      .catch(() => {})
  }, [poolId])

  async function handlePause() {
    if (!poolId || !runId || !progress) return
    setPausing(true)
    setPauseError(null)
    try {
      await abortLifecycleRun(poolId, runId, 'migrating', false)
      stopPoll()
      navigate(`/admin/infrastructure/pools/${poolId}`, { replace: true })
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Pause failed.')
    } finally {
      setPausing(false)
    }
  }

  const poolDisplayName = pool?.display_name || pool?.name || poolId
  const phase = progress?.run.current_phase ?? 'migrating'

  return (
    <AdminShell activeSection="infrastructure">
      {/* Header */}
      <div className="px-7 pt-5 pb-4 border-b border-line">
        <Link
          to={`/admin/infrastructure/pools/${poolId}`}
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2 transition-colors mb-3"
        >
          <Icon name="chevron-right" size={12} className="rotate-180" />
          Pool wizard
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-ink">
                {poolDisplayName}
              </h2>
              <PhaseBadge phase={phase} />
              <span className="font-mono text-[10px] text-ink-4">Mission Control</span>
            </div>
            {pool && (
              <p className="font-mono text-[12px] text-ink-3 mt-0.5">
                Run <span className="text-ink">{runId?.slice(0, 8)}</span>
              </p>
            )}
          </div>
          {pauseError && (
            <p className="text-xs text-red shrink-0">{pauseError}</p>
          )}
          <BBButton
            variant="ghost"
            disabled={pausing || !progress}
            onClick={handlePause}
            className="shrink-0"
          >
            {pausing ? (
              <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />Pausing…</>
            ) : 'Pause migration'}
          </BBButton>
        </div>
      </div>

      {/* KPI strip */}
      <div className="px-7 pt-5 pb-4 border-b border-line">
        <KpiStrip progress={progress} />
      </div>

      {loadError && !progress && (
        <div className="px-7 py-3 text-xs text-red border-b border-line">{loadError}</div>
      )}

      {/* Two-column body */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-5 px-7 py-5 min-h-full">
          {/* Main column (~70%) */}
          <div className="flex flex-col gap-5 min-w-0" style={{ flex: '7 1 0%' }}>
            {/* File log placeholder — will be replaced by ui-engineer's component */}
            <div className="rounded-lg border border-line bg-paper overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
                <span className="text-[12px] font-semibold text-ink flex-1">File log</span>
                <span className="font-mono text-[10px] text-ink-4">
                  {files.length} recent
                </span>
              </div>
              {files.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[11px] text-ink-4">Waiting for migration worker…</p>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {files.map((f) => {
                    const statusColors: Record<string, string> = {
                      done:      'oklch(0.55 0.12 155)',
                      copying:   'var(--color-amber-deep)',
                      verifying: 'var(--color-amber-deep)',
                      pending:   'var(--color-ink-4)',
                      failed:    'var(--color-red)',
                    }
                    return (
                      <div key={f.file_id} className="flex items-center gap-3 px-4 py-2">
                        <span
                          className="font-mono text-[10px] font-medium uppercase w-16 shrink-0"
                          style={{ color: statusColors[f.status] ?? 'var(--color-ink-4)' }}
                        >
                          {f.status}
                        </span>
                        <span className="font-mono text-[10px] text-ink-3 flex-1 truncate min-w-0">
                          {f.file_id.slice(0, 12)}…
                        </span>
                        <span className="font-mono text-[10px] text-ink-4 shrink-0">
                          {Math.round(f.size_bytes / 1024).toLocaleString()} KB
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Throughput chart placeholder — chart-engineer */}
            <div className="rounded-lg border border-line border-dashed bg-paper-2 px-4 py-8 flex items-center justify-center">
              <p className="text-[11px] text-ink-4 text-center">
                Throughput chart — coming soon (014a WebSocket)
              </p>
            </div>
          </div>

          {/* Sidebar (~30%) */}
          <div className="flex flex-col gap-4" style={{ flex: '3 1 0%', minWidth: 0 }}>
            <ErrorPanel
              poolId={poolId!}
              runId={runId!}
              files={files}
              onRetried={fetchAll}
            />
            <TimelinePanel progress={progress} />
          </div>
        </div>
      </div>

      {/* Footer — connection indicator */}
      <ConnectionIndicator
        status={connectionStatus}
        progress={progress}
        lastUpdated={lastUpdated}
      />
    </AdminShell>
  )
}
