import { useState, useEffect, useRef, useCallback } from 'react'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import {
  listClientDevices,
  listClientSessions,
  getApiUrl,
  getToken,
  type ClientDevice,
  type ClientSession,
} from '../lib/api'

// ─── Helpers ─────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1)
  const value = bytes / Math.pow(1000, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    macos: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
    ios: 'iOS',
    android: 'Android',
  }
  return map[platform.toLowerCase()] ?? platform
}

type HeartbeatStatus = 'active' | 'stale' | 'offline'

function resolveHeartbeatStatus(session: ClientSession): HeartbeatStatus {
  if (session.heartbeat_status === 'error' || session.status === 'stopped') return 'offline'
  if (!session.last_heartbeat) return 'offline'

  const elapsed = Date.now() - new Date(session.last_heartbeat).getTime()
  const intervalMs = (session.heartbeat_interval_secs || 60) * 1000

  if (elapsed > intervalMs * 15) return 'offline'
  if (elapsed > intervalMs * 5) return 'stale'
  return 'active'
}

function statusDot(status: HeartbeatStatus) {
  const colors: Record<HeartbeatStatus, string> = {
    active: 'bg-green',
    stale: 'bg-amber',
    offline: 'bg-red',
  }
  return (
    <span
      className={`inline-block size-2 rounded-full shrink-0 ${colors[status]}`}
      aria-label={status}
    />
  )
}

function heartbeatStatusLabel(session: ClientSession): string {
  const hs = session.heartbeat_status
  if (hs === 'watching') return 'Watching'
  if (hs === 'syncing') return 'Syncing'
  if (hs === 'paused') return 'Paused'
  if (hs === 'error') return 'Error'
  if (hs === 'idle') return 'Idle'
  if (session.status === 'stopped') return 'Stopped'
  if (session.status === 'paused') return 'Paused'
  return 'Active'
}

function sessionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    sync: 'Sync',
    backup: 'Backup',
    mount: 'FUSE mount',
    webdav: 'WebDAV',
  }
  return map[type] ?? type
}

// ─── SSE hook ───────────────────────────────────

function useSessionSSE(
  onEvent: (data: ClientSession) => void,
) {
  const callbackRef = useRef(onEvent)
  callbackRef.current = onEvent

  useEffect(() => {
    const token = getToken()
    if (!token) return

    const url = `${getApiUrl()}/api/v1/clients/sessions/live?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    es.addEventListener('heartbeat', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ClientSession
        callbackRef.current(data)
      } catch {
        // ignore malformed events
      }
    })

    es.addEventListener('session_created', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ClientSession
        callbackRef.current(data)
      } catch {
        // ignore
      }
    })

    es.addEventListener('session_stopped', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ClientSession
        callbackRef.current(data)
      } catch {
        // ignore
      }
    })

    return () => {
      es.close()
    }
  }, [])
}

// ─── Component ──────────────────────────────────

export function DevicesPage() {
  const [devices, setDevices] = useState<ClientDevice[]>([])
  const [sessions, setSessions] = useState<ClientSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [devRes, sessRes] = await Promise.all([
        listClientDevices(),
        listClientSessions(),
      ])
      setDevices(devRes.devices)
      setSessions(sessRes.sessions)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Real-time updates via SSE
  useSessionSSE((updatedSession) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === updatedSession.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updatedSession
        return next
      }
      return [...prev, updatedSession]
    })
  })

  // Update relative timestamps every 30s
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Group sessions by device
  const deviceMap = new Map<string, { device: ClientDevice; sessions: ClientSession[] }>()
  for (const device of devices) {
    deviceMap.set(device.id, { device, sessions: [] })
  }
  for (const session of sessions) {
    const entry = deviceMap.get(session.device_id)
    if (entry) {
      entry.sessions.push(session)
    } else {
      // Session for an unknown device -- create a placeholder
      deviceMap.set(session.device_id, {
        device: {
          id: session.device_id,
          hostname: session.device_hostname,
          platform: session.device_platform,
          bb_version: null,
          last_seen: session.last_heartbeat ?? session.created_at,
          created_at: session.created_at,
          session_count: 1,
        },
        sessions: [session],
      })
    }
  }

  const deviceEntries = Array.from(deviceMap.values()).sort((a, b) =>
    new Date(b.device.last_seen).getTime() - new Date(a.device.last_seen).getTime(),
  )

  return (
    <DriveLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-ink">Devices</h1>
            <p className="mt-1 text-[13px] text-ink-3">
              All registered devices and their sync sessions
            </p>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-amber" />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="rounded-lg border border-red/20 bg-red/5 px-4 py-3 text-[13px] text-red">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && deviceEntries.length === 0 && (
            <div className="text-center py-20">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-paper-3">
                <Icon name="cloud" size={20} className="text-ink-3" />
              </div>
              <h2 className="text-[15px] font-medium text-ink mb-1">No devices registered</h2>
              <p className="text-[13px] text-ink-3 max-w-sm mx-auto">
                Install the Beebeeb CLI and run <span className="font-mono text-ink-2">bb sync</span> to register your first device.
              </p>
            </div>
          )}

          {/* Device list */}
          {!loading && !error && deviceEntries.length > 0 && (
            <div className="space-y-4">
              {deviceEntries.map(({ device, sessions: deviceSessions }) => {
                // Determine worst-case status across all sessions for the device
                const statuses = deviceSessions.map(resolveHeartbeatStatus)
                const worstStatus: HeartbeatStatus = statuses.includes('offline')
                  ? 'offline'
                  : statuses.includes('stale')
                    ? 'stale'
                    : 'active'

                return (
                  <div
                    key={device.id}
                    className="rounded-lg border border-line bg-paper-2 overflow-hidden"
                  >
                    {/* Device header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-paper-2">
                      {statusDot(deviceSessions.length > 0 ? worstStatus : 'offline')}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-[14px] text-ink truncate">
                            {device.hostname}
                          </span>
                          <span className="text-[11px] text-ink-3 font-mono shrink-0">
                            {platformLabel(device.platform)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-ink-4">
                          {device.bb_version && (
                            <span className="font-mono">v{device.bb_version}</span>
                          )}
                          <span>Last seen {timeAgo(device.last_seen)}</span>
                          <span>{deviceSessions.length} session{deviceSessions.length !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>

                    {/* Sessions */}
                    {deviceSessions.length === 0 ? (
                      <div className="px-4 py-3 text-[12px] text-ink-4 italic">
                        No active sessions
                      </div>
                    ) : (
                      <div className="divide-y divide-line">
                        {deviceSessions.map((session) => {
                          const hbStatus = resolveHeartbeatStatus(session)
                          const progressPct =
                            session.bytes_total && session.bytes_total > 0
                              ? Math.min(100, ((session.bytes_synced ?? 0) / session.bytes_total) * 100)
                              : null

                          return (
                            <div key={session.id} className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {statusDot(hbStatus)}
                                <span className="font-medium text-[13px] text-ink truncate">
                                  {session.name}
                                </span>
                                <span className="text-[11px] text-ink-4 font-mono shrink-0">
                                  {sessionTypeLabel(session.session_type)}
                                </span>
                                <span className="ml-auto text-[11px] text-ink-3 shrink-0">
                                  {heartbeatStatusLabel(session)}
                                </span>
                              </div>

                              <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-4 font-mono">
                                <span className="truncate">{session.remote_path}</span>
                              </div>

                              {/* Progress bar for active syncs */}
                              {progressPct != null && session.heartbeat_status === 'syncing' && (
                                <div className="mt-2">
                                  <div className="h-[3px] w-full rounded-full bg-line overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-amber transition-all duration-500 ease-out"
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-ink-4">
                                {session.last_heartbeat && (
                                  <span>Last heartbeat {timeAgo(session.last_heartbeat)}</span>
                                )}
                                {session.files_synced != null && (
                                  <span>
                                    {session.files_synced.toLocaleString()}
                                    {session.files_total != null && ` / ${session.files_total.toLocaleString()}`}
                                    {' '}files
                                  </span>
                                )}
                                {session.bytes_synced != null && (
                                  <span>
                                    {formatBytes(session.bytes_synced)}
                                    {session.bytes_total != null && ` / ${formatBytes(session.bytes_total)}`}
                                  </span>
                                )}
                                {session.speed_bps != null && session.speed_bps > 0 && (
                                  <span>{formatBytes(session.speed_bps)}/s</span>
                                )}
                                {session.current_file && (
                                  <span className="truncate max-w-[200px]" title={session.current_file}>
                                    {session.current_file}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </DriveLayout>
  )
}
