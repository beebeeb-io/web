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
  retryFile,
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
import {
  ThroughputChart,
  type ThroughputSample,
} from '../../components/admin/mission-control/throughput-chart'
import { ProgressTimeline } from '../../components/admin/mission-control/progress-timeline'
import {
  FileLogToggle,
  type FileLogMode,
} from '../../components/admin/mission-control/file-log-toggle'
import type {
  MigrationFileEntry,
  MigrationFileEvent,
} from '../../components/admin/mission-control/types'

// ─── Adapters ──────────────────────────────────────────────────────────────

/** Convert a polled RunFileEntry snapshot into a MigrationFileEntry for the Table view. */
function toTableEntry(f: RunFileEntry): MigrationFileEntry {
  const validStatuses = new Set(['pending', 'copying', 'verifying', 'done', 'failed', 'cancelled'])
  return {
    file_id: f.file_id,
    status: validStatuses.has(f.status) ? (f.status as MigrationFileEntry['status']) : 'pending',
    size_bytes: f.size_bytes,
    started_at: f.started_at ?? null,
    completed_at: f.completed_at ?? null,
    error: f.error,
    bytes_copied: 0, // not in polling snapshot; real value comes via WS (014a)
  }
}

/** Convert a polled RunFileEntry snapshot into a MigrationFileEvent for the Stream view. */
function toStreamEvent(f: RunFileEntry): MigrationFileEvent {
  type EventType = MigrationFileEvent['type']
  const typeMap: Record<string, EventType> = {
    done: 'file_done',
    failed: 'file_failed',
    copying: 'file_progress',
    verifying: 'file_progress',
    pending: 'file_started',
  }
  const durationMs =
    f.started_at && f.completed_at
      ? Math.max(0, new Date(f.completed_at).getTime() - new Date(f.started_at).getTime())
      : undefined
  return {
    type: typeMap[f.status] ?? 'file_started',
    file_id: f.file_id,
    size_bytes: f.size_bytes,
    at: f.completed_at ?? f.started_at ?? new Date().toISOString(),
    duration_ms: durationMs,
    error: f.error ?? undefined,
  }
}

/** Rolling window for throughput samples (last 5 minutes). */
const THROUGHPUT_WINDOW_SAMPLES = 150 // 150 × 2 s = 5 min

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

  // Throughput samples accumulator — rolling buffer for ThroughputChart.
  const [throughputSamples, setThroughputSamples] = useState<ThroughputSample[]>([])

  // File log view state
  const [fileLogMode, setFileLogMode] = useState<FileLogMode>('stream')
  const [autoScroll, setAutoScroll] = useState(true)

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
      const now = new Date()
      setLastUpdated(now)
      setConnectionStatus('polling')
      setLoadError(null)

      // Append a throughput sample to the rolling buffer.
      const newSample: ThroughputSample = {
        bytes_per_sec: p.throughput_bytes_per_sec,
        files_per_sec: p.files_migrated / Math.max(1,
          (now.getTime() - new Date(p.run.started_at).getTime()) / 1000
        ),
        at: now.toISOString(),
      }
      setThroughputSamples((prev) => {
        const next = [...prev, newSample]
        return next.length > THROUGHPUT_WINDOW_SAMPLES
          ? next.slice(next.length - THROUGHPUT_WINDOW_SAMPLES)
          : next
      })

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

  async function handleRetry(fileId: string) {
    if (!poolId || !runId) return
    await retryFile(poolId, runId, fileId)
    void fetchAll()
  }

  const poolDisplayName = pool?.display_name || pool?.name || poolId
  const phase = progress?.run.current_phase ?? 'migrating'

  // Derive typed shapes for the file-log components from the polled snapshot.
  const tableEntries: MigrationFileEntry[] = files.map(toTableEntry)
  const streamEvents: MigrationFileEvent[] = files.map(toStreamEvent)

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
            {/* File log — stream (terminal) + table (structured) toggle */}
            <FileLogToggle
              mode={fileLogMode}
              onModeChange={setFileLogMode}
              streamProps={{
                events: streamEvents,
                autoScroll,
                onToggleAutoScroll: () => setAutoScroll((v) => !v),
                targetPoolName: pool?.display_name ?? pool?.name,
              }}
              tableProps={{
                files: tableEntries,
                onRetry: handleRetry,
              }}
            />

            {/* Throughput chart (chart-engineer, ebf5152) */}
            <ThroughputChart
              samples={throughputSamples}
              errors={files
                .filter((f) => f.status === 'failed' && f.started_at)
                .map((f) => ({ at: f.started_at! }))}
            />

            {/* Progress timeline (chart-engineer, ebf5152) */}
            <ProgressTimeline
              progress={progress?.phase_progress ?? 0}
              errors={files
                .filter((f) => f.status === 'failed' && f.started_at)
                .map((f) => ({ at: f.started_at!, file_id: f.file_id }))}
              phases={
                progress
                  ? [
                      {
                        from: 'quiescing',
                        to: 'migrating',
                        at: progress.run.started_at,
                      },
                    ]
                  : []
              }
              totalFiles={progress?.files_total ?? 0}
              filesDone={progress?.files_migrated ?? 0}
              startedAt={progress?.run.started_at}
              endedAt={
                progress?.run.outcome !== 'in_progress'
                  ? (progress?.run.terminated_at ?? undefined)
                  : undefined
              }
            />
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
