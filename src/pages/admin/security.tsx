import { useState, useEffect, useCallback } from 'react'
import { AdminShell, AdminHeader } from './admin-shell'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import {
  listAuditLog,
  exportAuditLog,
  listAbuseReports,
  updateAbuseReport,
  listCspReports,
  type AuditEvent,
  type AbuseReport,
  type AbuseReportStatus,
  type CspReport,
} from '../../lib/api'

type Tab = 'audit' | 'abuse' | 'csp'

const TABS: { id: Tab; label: string }[] = [
  { id: 'audit', label: 'Audit log' },
  { id: 'abuse', label: 'Abuse reports' },
  { id: 'csp', label: 'CSP violations' },
]

const ABUSE_FILTERS: { id: AbuseReportStatus | 'all'; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'actioned', label: 'Actioned' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
]

const PAGE_SIZE = 50

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function eventColor(ev: string | null | undefined): string {
  if (!ev) return 'var(--color-ink-2)'
  if (ev.startsWith('auth')) return 'var(--color-amber-deep)'
  if (ev.startsWith('key')) return 'oklch(0.55 0.15 30)'
  return 'var(--color-ink-2)'
}

function abuseStatusChip(status: AbuseReportStatus) {
  switch (status) {
    case 'pending':
      return <BBChip variant="amber">Pending</BBChip>
    case 'reviewing':
      return <BBChip>Reviewing</BBChip>
    case 'actioned':
      return <BBChip variant="green">Actioned</BBChip>
    case 'dismissed':
      return <BBChip>Dismissed</BBChip>
  }
}

export function Security() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('audit')

  // Audit log
  const [actorFilter, setActorFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)

  // Abuse reports
  const [abuseStatus, setAbuseStatus] =
    useState<AbuseReportStatus | 'all'>('pending')
  const [abuseReports, setAbuseReports] = useState<AbuseReport[]>([])
  const [abuseLoading, setAbuseLoading] = useState(false)
  const [abusePending, setAbusePending] = useState<string | null>(null)

  // CSP reports
  const [cspReports, setCspReports] = useState<CspReport[]>([])
  const [cspOffset, setCspOffset] = useState(0)
  const [cspTotal, setCspTotal] = useState(0)
  const [cspLoading, setCspLoading] = useState(false)

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await listAuditLog({
        actor: actorFilter || undefined,
        event: eventFilter || undefined,
        limit: PAGE_SIZE,
        offset: auditOffset,
      })
      setAuditEvents(data.events)
      setAuditTotal(data.total)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to load audit log',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
      setAuditEvents([])
    } finally {
      setAuditLoading(false)
    }
  }, [actorFilter, eventFilter, auditOffset, showToast])

  const loadAbuse = useCallback(async () => {
    setAbuseLoading(true)
    try {
      const data = await listAbuseReports({
        status: abuseStatus === 'all' ? undefined : abuseStatus,
        limit: PAGE_SIZE,
      })
      setAbuseReports(data)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to load reports',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
      setAbuseReports([])
    } finally {
      setAbuseLoading(false)
    }
  }, [abuseStatus, showToast])

  const loadCsp = useCallback(async () => {
    setCspLoading(true)
    try {
      const data = await listCspReports({ limit: PAGE_SIZE, offset: cspOffset })
      setCspReports(data.reports)
      setCspTotal(data.total)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to load CSP reports',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
      setCspReports([])
    } finally {
      setCspLoading(false)
    }
  }, [cspOffset, showToast])

  useEffect(() => {
    if (tab === 'audit') void loadAudit()
  }, [tab, loadAudit])

  useEffect(() => {
    if (tab === 'abuse') void loadAbuse()
  }, [tab, loadAbuse])

  useEffect(() => {
    if (tab === 'csp') void loadCsp()
  }, [tab, loadCsp])

  async function handleExport() {
    try {
      const data = await exportAuditLog()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Export failed',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    }
  }

  async function applyAbuseDecision(id: string, status: AbuseReportStatus) {
    setAbusePending(id)
    try {
      await updateAbuseReport(id, { status })
      showToast({
        icon: status === 'actioned' ? 'shield' : 'check',
        title: status === 'actioned' ? 'Share link revoked' : `Marked ${status}`,
      })
      setAbuseReports(prev =>
        abuseStatus === 'all'
          ? prev.map(r => (r.id === id ? { ...r, status } : r))
          : prev.filter(r => r.id !== id),
      )
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to update report',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setAbusePending(null)
    }
  }

  return (
    <AdminShell activeSection="security">
      <AdminHeader title="Security" />

      {/* Tabs */}
      <div className="flex items-center gap-1 px-7 py-2 border-b border-line bg-paper-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
              tab === t.id
                ? 'bg-paper text-ink font-medium shadow-1'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {tab === 'audit' && (
          <>
            <div className="flex items-center gap-2 px-7 py-2.5 border-b border-line bg-paper-2">
              <input
                className="border border-line-2 rounded-md px-2.5 py-1.5 text-xs font-mono bg-paper placeholder:text-ink-4 w-[200px]"
                placeholder="Filter by actor"
                value={actorFilter}
                onChange={e => setActorFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setAuditOffset(0)
                    void loadAudit()
                  }
                }}
              />
              <input
                className="border border-line-2 rounded-md px-2.5 py-1.5 text-xs font-mono bg-paper placeholder:text-ink-4 w-[200px]"
                placeholder="Filter by event"
                value={eventFilter}
                onChange={e => setEventFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setAuditOffset(0)
                    void loadAudit()
                  }
                }}
              />
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAuditOffset(0)
                  void loadAudit()
                }}
              >
                Apply
              </BBButton>
              <BBChip variant="amber">{auditTotal} total</BBChip>
              <span className="ml-auto">
                <BBButton size="sm" variant="ghost" onClick={handleExport}>
                  <Icon name="download" size={11} className="mr-1.5" />
                  Export signed JSON
                </BBButton>
              </span>
            </div>

            <div className="overflow-x-auto">
              <div
                className="grid px-7 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
                style={{ gridTemplateColumns: '160px 220px 200px 1fr 140px 160px' }}
              >
                <span>Time</span>
                <span>Actor</span>
                <span>Event</span>
                <span>Target</span>
                <span>IP</span>
                <span>Device</span>
              </div>

              {auditLoading ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : auditEvents.length === 0 ? (
                <div className="px-7 py-8 text-center text-xs text-ink-3">No events found</div>
              ) : (
                auditEvents.map(e => (
                  <div
                    key={e.id}
                    className="grid px-7 py-2.5 text-xs border-b border-line items-center"
                    style={{ gridTemplateColumns: '160px 220px 200px 1fr 140px 160px' }}
                  >
                    <span className="font-mono text-[11px] text-ink-3">
                      {formatTime(e.created_at)}
                    </span>
                    <span className="font-mono text-[11px]">{e.actor}</span>
                    <span
                      className="font-mono text-[11px]"
                      style={{ color: eventColor(e.event) }}
                    >
                      {e.event}
                    </span>
                    <span className="text-ink-2 truncate">{e.target ?? ''}</span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {e.ip_address ?? '---'}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {e.device ?? '---'}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 px-7 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
              <span className="font-mono">
                {auditOffset + 1}–{Math.min(auditOffset + auditEvents.length, auditTotal)} of {auditTotal}
              </span>
              <span className="ml-auto flex gap-1.5">
                <BBButton
                  size="sm"
                  variant="ghost"
                  disabled={auditOffset === 0 || auditLoading}
                  onClick={() => setAuditOffset(Math.max(0, auditOffset - PAGE_SIZE))}
                >
                  Previous
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  disabled={auditOffset + auditEvents.length >= auditTotal || auditLoading}
                  onClick={() => setAuditOffset(auditOffset + PAGE_SIZE)}
                >
                  Next
                </BBButton>
              </span>
            </div>
          </>
        )}

        {tab === 'abuse' && (
          <>
            <div className="flex items-center gap-1 px-7 py-2 border-b border-line bg-paper-2">
              {ABUSE_FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setAbuseStatus(f.id)}
                  className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                    abuseStatus === f.id
                      ? 'bg-paper text-ink font-medium shadow-1'
                      : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <BBChip variant="amber" className="ml-2">
                {abuseReports.length} {abuseStatus === 'all' ? 'total' : abuseStatus}
              </BBChip>
              <span className="ml-auto">
                <BBButton size="sm" variant="ghost" onClick={() => void loadAbuse()}>
                  Refresh
                </BBButton>
              </span>
            </div>

            <div className="overflow-x-auto">
              <div
                className="grid px-7 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
                style={{ gridTemplateColumns: '160px 220px 220px 1fr 110px 180px' }}
              >
                <span>Submitted</span>
                <span>Share token</span>
                <span>Reporter</span>
                <span>Reason</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>

              {abuseLoading ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : abuseReports.length === 0 ? (
                <div className="px-7 py-8 text-center text-xs text-ink-3">
                  No {abuseStatus === 'all' ? '' : abuseStatus} reports
                </div>
              ) : (
                abuseReports.map(r => {
                  const reporter = r.reporter_email ?? r.reporter_ip ?? 'anonymous'
                  const isOpen = r.status === 'pending' || r.status === 'reviewing'
                  const isBusy = abusePending === r.id
                  return (
                    <div
                      key={r.id}
                      className="grid px-7 py-3 text-xs border-b border-line items-center"
                      style={{ gridTemplateColumns: '160px 220px 220px 1fr 110px 180px' }}
                    >
                      <span className="font-mono text-[11px] text-ink-3">
                        {formatTime(r.created_at)}
                      </span>
                      <span
                        className="font-mono text-[11px] text-ink truncate"
                        title={r.share_token}
                      >
                        {r.share_token}
                      </span>
                      <span className="text-ink-2 truncate" title={reporter}>
                        {r.reporter_email ? (
                          <span>{r.reporter_email}</span>
                        ) : (
                          <span className="font-mono text-[11px] text-ink-3">{reporter}</span>
                        )}
                      </span>
                      <span className="text-ink-2 truncate" title={r.reason}>
                        {r.reason}
                      </span>
                      <span>{abuseStatusChip(r.status)}</span>
                      <span className="flex justify-end gap-1.5">
                        {isOpen ? (
                          <>
                            {r.status === 'pending' && (
                              <BBButton
                                size="sm"
                                variant="ghost"
                                onClick={() => applyAbuseDecision(r.id, 'reviewing')}
                                disabled={isBusy}
                              >
                                Review
                              </BBButton>
                            )}
                            <BBButton
                              size="sm"
                              variant="danger"
                              onClick={() => applyAbuseDecision(r.id, 'actioned')}
                              disabled={isBusy}
                            >
                              {isBusy ? '...' : 'Action'}
                            </BBButton>
                            <BBButton
                              size="sm"
                              variant="ghost"
                              onClick={() => applyAbuseDecision(r.id, 'dismissed')}
                              disabled={isBusy}
                            >
                              Dismiss
                            </BBButton>
                          </>
                        ) : (
                          <span className="font-mono text-[11px] text-ink-3">
                            {r.resolved_at ? formatTime(r.resolved_at) : '---'}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })
              )}
            </div>

            <div className="flex items-center gap-2 px-7 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
              <Icon name="shield" size={11} className="text-ink-3" />
              <span>Action revokes the share link permanently. Dismiss leaves it live.</span>
              <span className="ml-auto">All decisions are recorded in the audit log</span>
            </div>
          </>
        )}

        {tab === 'csp' && (
          <>
            <div className="flex items-center gap-2 px-7 py-2.5 border-b border-line bg-paper-2">
              <BBChip variant="amber">{cspTotal} total</BBChip>
              <span className="ml-auto">
                <BBButton size="sm" variant="ghost" onClick={() => void loadCsp()}>
                  Refresh
                </BBButton>
              </span>
            </div>

            <div className="overflow-x-auto">
              <div
                className="grid px-7 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
                style={{ gridTemplateColumns: '160px 1fr 1fr 1fr 70px 160px' }}
              >
                <span>Directive</span>
                <span>Blocked URI</span>
                <span>Document URI</span>
                <span>Source file</span>
                <span>Line</span>
                <span>Reported at</span>
              </div>

              {cspLoading ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : cspReports.length === 0 ? (
                <div className="px-7 py-8 text-center text-xs text-ink-3">No CSP violations</div>
              ) : (
                cspReports.map(r => (
                  <div
                    key={r.id}
                    className="grid px-7 py-2.5 text-xs border-b border-line items-center"
                    style={{ gridTemplateColumns: '160px 1fr 1fr 1fr 70px 160px' }}
                  >
                    <span className="font-mono text-[11px] text-ink">
                      {r.violated_directive ?? '---'}
                    </span>
                    <span
                      className="font-mono text-[11px] text-ink-2 truncate"
                      title={r.blocked_uri ?? undefined}
                    >
                      {r.blocked_uri ?? '---'}
                    </span>
                    <span
                      className="font-mono text-[11px] text-ink-3 truncate"
                      title={r.document_uri ?? undefined}
                    >
                      {r.document_uri ?? '---'}
                    </span>
                    <span
                      className="font-mono text-[11px] text-ink-3 truncate"
                      title={r.source_file ?? undefined}
                    >
                      {r.source_file ?? '---'}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {r.line_number ?? '---'}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {formatTime(r.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 px-7 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
              <span className="font-mono">
                {cspOffset + 1}–{Math.min(cspOffset + cspReports.length, cspTotal)} of {cspTotal}
              </span>
              <span className="ml-auto flex gap-1.5">
                <BBButton
                  size="sm"
                  variant="ghost"
                  disabled={cspOffset === 0 || cspLoading}
                  onClick={() => setCspOffset(Math.max(0, cspOffset - PAGE_SIZE))}
                >
                  Previous
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  disabled={cspOffset + cspReports.length >= cspTotal || cspLoading}
                  onClick={() => setCspOffset(cspOffset + PAGE_SIZE)}
                >
                  Next
                </BBButton>
              </span>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  )
}
