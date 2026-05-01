import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import {
  listAbuseReports,
  updateAbuseReport,
  type AbuseReport,
  type AbuseReportStatus,
} from '../../lib/api'

const STATUS_TABS: { id: AbuseReportStatus | 'all'; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'actioned', label: 'Actioned' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
]

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusChip(status: AbuseReportStatus) {
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

export function AbuseReports() {
  const { showToast } = useToast()
  const [reports, setReports] = useState<AbuseReport[]>([])
  const [activeTab, setActiveTab] = useState<AbuseReportStatus | 'all'>('pending')
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAbuseReports({
        status: activeTab === 'all' ? undefined : activeTab,
        limit: 50,
      })
      setReports(data)
    } catch (err) {
      console.error('[AbuseReports] Failed to load reports:', err)
      showToast({
        icon: 'x',
        title: 'Failed to load reports',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, showToast])

  useEffect(() => { load() }, [load])

  async function applyDecision(id: string, status: AbuseReportStatus) {
    setPendingId(id)
    try {
      await updateAbuseReport(id, { status })
      showToast({
        icon: status === 'actioned' ? 'shield' : 'check',
        title: status === 'actioned' ? 'Share link revoked' : 'Report dismissed',
      })
      // Drop the row from the current view if its status no longer matches the filter
      setReports((prev) =>
        activeTab === 'all'
          ? prev.map((r) => (r.id === id ? { ...r, status } : r))
          : prev.filter((r) => r.id !== id),
      )
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to update report',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <AdminShell activeSection="abuse-reports">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="shield" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Abuse reports</h2>
        <BBChip variant="amber">{reports.length} {activeTab === 'all' ? 'total' : activeTab}</BBChip>
        <span className="ml-auto">
          <BBButton size="sm" variant="ghost" onClick={load}>
            Refresh
          </BBButton>
        </span>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-line bg-paper-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
              activeTab === tab.id
                ? 'bg-paper text-ink font-medium shadow-1'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <div
          className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
          style={{ gridTemplateColumns: '160px 220px 220px 1fr 110px 180px' }}
        >
          <span>Submitted</span>
          <span>Share token</span>
          <span>Reporter</span>
          <span>Reason</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : reports.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">
            No {activeTab === 'all' ? '' : activeTab} reports
          </div>
        ) : (
          reports.map((r) => {
            const reporter = r.reporter_email ?? r.reporter_ip ?? 'anonymous'
            const isPending = r.status === 'pending' || r.status === 'reviewing'
            const isBusy = pendingId === r.id
            return (
              <div
                key={r.id}
                className="grid px-5 py-3 text-xs border-b border-line items-center"
                style={{ gridTemplateColumns: '160px 220px 220px 1fr 110px 180px' }}
              >
                <span className="font-mono text-[11px] text-ink-3">
                  {formatTimestamp(r.created_at)}
                </span>
                <span className="font-mono text-[11px] text-ink truncate" title={r.share_token}>
                  {r.share_token}
                </span>
                <span className="text-ink-2 truncate" title={reporter}>
                  {r.reporter_email ? (
                    <span>{r.reporter_email}</span>
                  ) : (
                    <span className="font-mono text-[11px] text-ink-3">{reporter}</span>
                  )}
                </span>
                <span className="text-ink-2 truncate" title={r.reason}>{r.reason}</span>
                <span>{statusChip(r.status)}</span>
                <span className="flex justify-end gap-1.5">
                  {isPending ? (
                    <>
                      <BBButton
                        size="sm"
                        variant="danger"
                        onClick={() => applyDecision(r.id, 'actioned')}
                        disabled={isBusy}
                      >
                        {isBusy ? '...' : 'Action'}
                      </BBButton>
                      <BBButton
                        size="sm"
                        variant="ghost"
                        onClick={() => applyDecision(r.id, 'dismissed')}
                        disabled={isBusy}
                      >
                        Dismiss
                      </BBButton>
                    </>
                  ) : (
                    <span className="font-mono text-[11px] text-ink-3">
                      {r.resolved_at ? formatTimestamp(r.resolved_at) : '---'}
                    </span>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="shield" size={11} className="text-ink-3" />
        <span>Action revokes the share link permanently. Dismiss leaves it live.</span>
        <span className="ml-auto">All decisions are recorded in the audit log</span>
      </div>
    </AdminShell>
  )
}
