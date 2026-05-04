/**
 * Mission Control — live migration monitor page.
 *
 * Route: /admin/infrastructure/pools/:poolId/runs/:runId/monitor
 *
 * Primary: WebSocket at /lifecycle/runs/:runId/ws (Plan 014a).
 * Fallback: 2 s HTTP polling after WS_MAX_RECONNECTS failed reconnects.
 *
 * Connection state machine:
 *   connecting → connected (WS open)
 *   connected  → reconnecting (WS close/error)
 *   reconnecting → connected (reconnect succeeds within WS_MAX_RECONNECTS)
 *   reconnecting → polling (exhausted reconnect budget)
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
  getToken,
  getApiUrl,
  type RunProgress,
  type RunFileEntry,
  type LifecycleRun,
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

// ─── Constants ─────────────────────────────────────────────────────────────

/** Rolling window for throughput samples (last 5 minutes). */
const THROUGHPUT_WINDOW_SAMPLES = 150 // 150 × 2 s ≈ 5 min

/** Max number of file events kept in the stream log. */
const MAX_STREAM_EVENTS = 200

/** Delay before each WS reconnect attempt. */
const WS_RECONNECT_DELAY_MS = 3_000

/** After this many failed reconnects, fall back to HTTP polling. */
const WS_MAX_RECONNECTS = 3

/** HTTP polling interval used only in fallback mode. */
const POLL_INTERVAL_MS = 2_000

// ─── WebSocket message shapes ──────────────────────────────────────────────

interface WsSnapshot {
  type: 'snapshot'
  run: LifecycleRun
  files_done: number
  files_failed: number
  files_pending: number
  throughput_history: ThroughputSample[]
}
interface WsFileStarted {
  type: 'file_started'
  file_id: string
  size_bytes: number
  chunks: number
  at: string
}
interface WsFileProgress {
  type: 'file_progress'
  file_id: string
  chunks_copied: number
  bytes_copied: number
  at: string
}
interface WsFileDone {
  type: 'file_done'
  file_id: string
  duration_ms: number
  bytes_copied: number
  at: string
}
interface WsFileFailed {
  type: 'file_failed'
  file_id: string
  error: string
  at: string
}
interface WsThroughputSample {
  type: 'throughput_sample'
  bytes_per_sec: number
  files_per_sec: number
  at: string
}
interface WsPhaseChanged {
  type: 'phase_changed'
  from: string
  to: string
  at: string
}
type WsMsg =
  | WsSnapshot
  | WsFileStarted
  | WsFileProgress
  | WsFileDone
  | WsFileFailed
  | WsThroughputSample
  | WsPhaseChanged

// ─── Polling-mode adapters (used only in fallback) ─────────────────────────

function toTableEntry(f: RunFileEntry): MigrationFileEntry {
  const validStatuses = new Set(['pending', 'copying', 'verifying', 'done', 'failed', 'cancelled'])
  return {
    file_id: f.file_id,
    status: validStatuses.has(f.status) ? (f.status as MigrationFileEntry['status']) : 'pending',
    size_bytes: f.size_bytes,
    started_at: f.started_at ?? null,
    completed_at: f.completed_at ?? null,
    error: f.error,
    bytes_copied: 0,
  }
}

function toStreamEvent(f: RunFileEntry): MigrationFileEvent {
  type ET = MigrationFileEvent['type']
  const typeMap: Record<string, ET> = {
    done: 'file_done', failed: 'file_failed',
    copying: 'file_progress', verifying: 'file_progress', pending: 'file_started',
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

// ─── Component ─────────────────────────────────────────────────────────────

export function MissionControl() {
  const { poolId, runId } = useParams<{ poolId: string; runId: string }>()
  const navigate = useNavigate()

  // ── React state ──────────────────────────────────────────────────────────
  const [pool, setPool] = useState<StoragePool | null>(null)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  // files: used by ErrorPanel + polling-mode table. In WS mode it's kept in
  // sync via filesMapRef. In polling mode it's set directly from the HTTP response.
  const [files, setFiles] = useState<RunFileEntry[]>([])
  // Stream log events — populated from WS file events; derived from files in
  // polling fallback mode.
  const [streamEvents, setStreamEvents] = useState<MigrationFileEvent[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [throughputSamples, setThroughputSamples] = useState<ThroughputSample[]>([])
  const [fileLogMode, setFileLogMode] = useState<FileLogMode>('stream')
  const [autoScroll, setAutoScroll] = useState(true)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsActiveRef = useRef(false)          // true while WS is the live source
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mutable progress counters for WS mode — avoids stale closures in message handler.
  const wsCountsRef = useRef({
    files_total: 0,
    files_done: 0,
    files_failed: 0,
    files_pending: 0,
    throughput_bps: 0,
    files_per_sec: 0,
    run: null as LifecycleRun | null,
  })

  // Per-file state accumulated from WS events, used to populate ErrorPanel.
  const filesMapRef = useRef<Map<string, RunFileEntry>>(new Map())

  // navigateRef for stable closure inside WS handler
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Derive a RunProgress snapshot from the mutable WS counters. */
  function wsToProgress(): RunProgress | null {
    const c = wsCountsRef.current
    if (!c.run) return null
    const total = Math.max(c.files_total, 1)
    const eta = c.files_per_sec > 0 ? c.files_pending / c.files_per_sec : 0
    return {
      run: c.run,
      phase_progress: c.files_done / total,
      throughput_bytes_per_sec: c.throughput_bps,
      files_total: c.files_total,
      files_migrated: c.files_done,
      files_failed: c.files_failed,
      files_pending: c.files_pending,
      eta_seconds: eta,
    }
  }

  function syncFilesFromMap() {
    setFiles(Array.from(filesMapRef.current.values()))
  }

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
  }

  // ── Polling fallback ─────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    if (!poolId || !runId) return
    try {
      const [p, f] = await Promise.all([
        getLifecycleRun(poolId, runId),
        getLifecycleRunFiles(poolId, runId).catch(() => ({ files: [], total: 0 })),
      ])
      setProgress(p)
      setFiles(f.files)
      setStreamEvents(f.files.map(toStreamEvent))
      const now = new Date()
      setLastUpdated(now)
      setConnectionStatus('polling')
      setLoadError(null)
      // Append throughput sample
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
      if (p.run.current_phase !== 'migrating') {
        stopPoll()
        navigateRef.current(`/admin/infrastructure/pools/${poolId}`, { replace: true })
      }
    } catch (err) {
      setConnectionStatus('reconnecting')
      setLoadError(err instanceof Error ? err.message : 'Failed to fetch data.')
    }
  }, [poolId, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  function startPollingFallback() {
    wsActiveRef.current = false
    setConnectionStatus('polling')
    void fetchAll()
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void fetchAll(), POLL_INTERVAL_MS)
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const openWebSocket = useCallback(() => {
    if (!poolId || !runId) return
    const token = getToken()
    if (!token) { startPollingFallback(); return }

    // Build ws(s):// URL from the http(s):// API base.
    const base = getApiUrl().replace(/^http(s)?:\/\//, 'ws$1://')
    const url = `${base}/api/v1/admin/pools/${poolId}/lifecycle/runs/${runId}/ws?token=${encodeURIComponent(token)}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectCountRef.current = 0
      wsActiveRef.current = true
      stopPoll()
      setConnectionStatus('connected')
      setLoadError(null)
    }

    ws.onmessage = (ev) => {
      let msg: WsMsg
      try { msg = JSON.parse(ev.data as string) as WsMsg } catch { return }
      const now = new Date()
      setLastUpdated(now)

      switch (msg.type) {
        case 'snapshot': {
          const c = wsCountsRef.current
          c.run = msg.run
          c.files_done = msg.files_done
          c.files_failed = msg.files_failed
          c.files_pending = msg.files_pending
          c.files_total = msg.files_done + msg.files_failed + msg.files_pending
          // Seed throughput from history (last sample)
          if (msg.throughput_history.length > 0) {
            const last = msg.throughput_history[msg.throughput_history.length - 1]
            c.throughput_bps = last.bytes_per_sec
            c.files_per_sec = last.files_per_sec
            setThroughputSamples(
              msg.throughput_history.slice(-THROUGHPUT_WINDOW_SAMPLES)
            )
          }
          setProgress(wsToProgress())
          break
        }

        case 'file_started': {
          const entry: RunFileEntry = {
            file_id: msg.file_id,
            name_encrypted: '',
            size_bytes: msg.size_bytes,
            status: 'copying',
            error: null,
            started_at: msg.at,
            completed_at: null,
          }
          filesMapRef.current.set(msg.file_id, entry)
          syncFilesFromMap()
          const event: MigrationFileEvent = {
            type: 'file_started',
            file_id: msg.file_id,
            size_bytes: msg.size_bytes,
            at: msg.at,
          }
          setStreamEvents((prev) => [...prev, event].slice(-MAX_STREAM_EVENTS))
          break
        }

        case 'file_progress': {
          const existing = filesMapRef.current.get(msg.file_id)
          if (existing) filesMapRef.current.set(msg.file_id, { ...existing, status: 'copying' })
          const event: MigrationFileEvent = {
            type: 'file_progress',
            file_id: msg.file_id,
            bytes_copied: msg.bytes_copied,
            at: msg.at,
          }
          setStreamEvents((prev) => [...prev, event].slice(-MAX_STREAM_EVENTS))
          break
        }

        case 'file_done': {
          const c = wsCountsRef.current
          c.files_done += 1
          c.files_pending = Math.max(0, c.files_pending - 1)
          const existing = filesMapRef.current.get(msg.file_id)
          filesMapRef.current.set(msg.file_id, {
            ...(existing ?? { file_id: msg.file_id, name_encrypted: '', size_bytes: 0, error: null, started_at: null }),
            status: 'done',
            completed_at: msg.at,
          })
          syncFilesFromMap()
          setProgress(wsToProgress())
          const event: MigrationFileEvent = {
            type: 'file_done',
            file_id: msg.file_id,
            bytes_copied: msg.bytes_copied,
            duration_ms: msg.duration_ms,
            at: msg.at,
          }
          setStreamEvents((prev) => [...prev, event].slice(-MAX_STREAM_EVENTS))
          break
        }

        case 'file_failed': {
          const c = wsCountsRef.current
          c.files_failed += 1
          c.files_pending = Math.max(0, c.files_pending - 1)
          const existing = filesMapRef.current.get(msg.file_id)
          filesMapRef.current.set(msg.file_id, {
            ...(existing ?? { file_id: msg.file_id, name_encrypted: '', size_bytes: 0, started_at: null, completed_at: null }),
            status: 'failed',
            error: msg.error,
            completed_at: msg.at,
          })
          syncFilesFromMap()
          setProgress(wsToProgress())
          const event: MigrationFileEvent = {
            type: 'file_failed',
            file_id: msg.file_id,
            error: msg.error,
            at: msg.at,
          }
          setStreamEvents((prev) => [...prev, event].slice(-MAX_STREAM_EVENTS))
          break
        }

        case 'throughput_sample': {
          const c = wsCountsRef.current
          c.throughput_bps = msg.bytes_per_sec
          c.files_per_sec = msg.files_per_sec
          const sample: ThroughputSample = {
            bytes_per_sec: msg.bytes_per_sec,
            files_per_sec: msg.files_per_sec,
            at: msg.at,
          }
          setThroughputSamples((prev) => {
            const next = [...prev, sample]
            return next.length > THROUGHPUT_WINDOW_SAMPLES
              ? next.slice(next.length - THROUGHPUT_WINDOW_SAMPLES)
              : next
          })
          // Recompute ETA whenever throughput updates
          setProgress(wsToProgress())
          break
        }

        case 'phase_changed': {
          const c = wsCountsRef.current
          if (c.run) {
            c.run = { ...c.run, current_phase: msg.to as LifecycleRun['current_phase'] }
            setProgress(wsToProgress())
          }
          if (msg.to !== 'migrating') {
            ws.close()
            navigateRef.current(`/admin/infrastructure/pools/${poolId}`, { replace: true })
          }
          break
        }
      }
    }

    ws.onerror = () => {
      // onclose fires right after onerror, so handle reconnect there
    }

    ws.onclose = () => {
      wsRef.current = null
      wsActiveRef.current = false
      if (reconnectCountRef.current < WS_MAX_RECONNECTS) {
        reconnectCountRef.current += 1
        setConnectionStatus('reconnecting')
        reconnectTimerRef.current = setTimeout(() => openWebSocket(), WS_RECONNECT_DELAY_MS)
      } else {
        startPollingFallback()
      }
    }
  }, [poolId, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effects ───────────────────────────────────────────────────────────────

  // Open WS on mount; clean up on unmount.
  useEffect(() => {
    openWebSocket()
    return () => {
      clearReconnectTimer()
      stopPoll()
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect loop on intentional close
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [openWebSocket])

  // Fetch pool name once for the header breadcrumb.
  useEffect(() => {
    if (!poolId) return
    listStoragePools()
      .then((pools) => setPool(pools.find((p) => p.id === poolId) ?? null))
      .catch(() => {})
  }, [poolId])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handlePause() {
    if (!poolId || !runId || !progress) return
    setPausing(true)
    setPauseError(null)
    try {
      await abortLifecycleRun(poolId, runId, 'migrating', false)
      clearReconnectTimer()
      stopPoll()
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }
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
    // In WS mode the worker will emit file_started; in polling mode refresh now.
    if (!wsActiveRef.current) void fetchAll()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const poolDisplayName = pool?.display_name || pool?.name || poolId
  const phase = progress?.run.current_phase ?? 'migrating'

  // Table entries: WS mode uses filesMapRef-derived files; polling uses same files state.
  const tableEntries: MigrationFileEntry[] = files.map(toTableEntry)
  // Stream events: WS mode uses accumulated WS events; polling mode derives from files.
  const liveStreamEvents = wsActiveRef.current
    ? streamEvents
    : files.map(toStreamEvent)

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
                events: liveStreamEvents,
                autoScroll,
                onToggleAutoScroll: () => setAutoScroll((v) => !v),
                targetPoolName: pool?.display_name ?? pool?.name,
              }}
              tableProps={{
                files: tableEntries,
                onRetry: handleRetry,
              }}
            />

            {/* Throughput chart */}
            <ThroughputChart
              samples={throughputSamples}
              errors={files
                .filter((f) => f.status === 'failed' && f.started_at)
                .map((f) => ({ at: f.started_at! }))}
            />

            {/* Progress timeline */}
            <ProgressTimeline
              progress={progress?.phase_progress ?? 0}
              errors={files
                .filter((f) => f.status === 'failed' && f.started_at)
                .map((f) => ({ at: f.started_at!, file_id: f.file_id }))}
              phases={
                progress
                  ? [{ from: 'quiescing', to: 'migrating', at: progress.run.started_at }]
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
