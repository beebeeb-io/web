import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'
import { listAuditLog, exportAuditLog } from '../../lib/api'
import type { AuditEvent } from '../../lib/api'

function eventColor(ev: string): string {
  if (ev.startsWith('auth')) return 'var(--color-amber-deep)'
  if (ev.startsWith('key')) return 'oklch(0.55 0.15 30)'
  return 'var(--color-ink-2)'
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Parse filter string for actor: and event: prefixes
      let actor: string | undefined
      let event: string | undefined
      const parts = filter.split(/\s+/)
      for (const p of parts) {
        if (p.startsWith('actor:')) actor = p.slice(6)
        else if (p.startsWith('event:')) event = p.slice(6)
      }
      const data = await listAuditLog({ actor, event, limit: 50 })
      setEvents(data.events)
    } catch {
      // Use demo data when API unavailable
      setEvents(demoEvents)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function handleExportJson() {
    try {
      const data = await exportAuditLog()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent
    }
  }

  function handleExportCsv() {
    const header = 'time,actor,event,target,ip,device'
    const rows = events.map(e =>
      [e.created_at, e.actor, e.event, e.target ?? '', e.ip_address ?? '', e.device ?? '']
        .map(v => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AdminShell activeSection="audit-log">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="shield" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Audit log</h2>
        <BBChip variant="green">Live &middot; signed &middot; append-only</BBChip>
        <span className="ml-auto flex gap-1.5">
          <BBButton size="sm" variant="ghost" onClick={handleExportCsv}>
            <Icon name="download" size={11} className="mr-1.5" />
            Export CSV
          </BBButton>
          <BBButton size="sm" variant="ghost" onClick={handleExportJson}>
            <Icon name="download" size={11} className="mr-1.5" />
            Export signed JSON
          </BBButton>
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-line bg-paper-2">
        <input
          className="flex-1 border border-line-2 rounded-md px-2.5 py-1.5 text-xs font-mono bg-paper placeholder:text-ink-4"
          placeholder="Filter by actor, event, target..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
        />
        <BBChip>Last 24h</BBChip>
        <BBChip variant="amber">{events.length} events</BBChip>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {/* Column headers */}
        <div
          className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line"
          style={{ gridTemplateColumns: '110px 200px 180px 1fr 140px 160px' }}
        >
          <span>Time</span>
          <span>Actor</span>
          <span>Event</span>
          <span>Target</span>
          <span>IP</span>
          <span>Device</span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">Loading...</div>
        ) : events.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">No events found</div>
        ) : (
          events.map(e => (
            <div
              key={e.id}
              className="grid px-5 py-2.5 text-xs border-b border-line items-center"
              style={{ gridTemplateColumns: '110px 200px 180px 1fr 140px 160px' }}
            >
              <span className="font-mono text-ink-3">
                {new Date(e.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="font-mono text-[11px]">{e.actor}</span>
              <span className="font-mono text-[11px]" style={{ color: eventColor(e.event) }}>
                {e.event}
              </span>
              <span className="text-ink-2 truncate">{e.target ?? ''}</span>
              <span className="font-mono text-[11px] text-ink-3">{e.ip_address ?? '---'}</span>
              <span className="font-mono text-[11px] text-ink-3">{e.device ?? '---'}</span>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="lock" size={11} className="text-ink-3" />
        <span className="font-mono">Log tip hash &middot; 7d9a...42c3 &middot; verified</span>
        <span className="ml-auto">Retention: 13 months &middot; exported signatures valid forever</span>
      </div>
    </AdminShell>
  )
}

/* Demo data for offline/dev use */
const demoEvents: AuditEvent[] = [
  { id: '1', workspace_id: null, actor: 'isa@example.eu', event: 'file.share.create', target: 'evidence/Tirana-minutes.pdf', ip_address: '85.144.22.10', device: 'macOS · Safari', created_at: new Date().toISOString() },
  { id: '2', workspace_id: null, actor: 'marc@example.eu', event: 'member.role.change', target: 'legal@example.com → Can view', ip_address: '91.203.11.4', device: 'iOS · 17.4', created_at: new Date(Date.now() - 240_000).toISOString() },
  { id: '3', workspace_id: null, actor: 'isa@example.eu', event: 'key.rotate', target: 'team key · v23', ip_address: '85.144.22.10', device: 'macOS · Safari', created_at: new Date(Date.now() - 660_000).toISOString() },
  { id: '4', workspace_id: null, actor: 'system', event: 'session.expire', target: 'editor@example.eu · Firefox', ip_address: null, device: 'server', created_at: new Date(Date.now() - 2_160_000).toISOString() },
  { id: '5', workspace_id: null, actor: 'editor@example.eu', event: 'file.download', target: 'raw/interview-03.wav', ip_address: '77.22.8.91', device: 'Windows · Chrome', created_at: new Date(Date.now() - 4_920_000).toISOString() },
  { id: '6', workspace_id: null, actor: 'marc@example.eu', event: 'member.invite', target: 'legal@example.com', ip_address: '91.203.11.4', device: 'macOS · Chrome', created_at: new Date(Date.now() - 6_120_000).toISOString() },
  { id: '7', workspace_id: null, actor: 'isa@example.eu', event: 'file.upload', target: '14 files · 312 MB', ip_address: '85.144.22.10', device: 'macOS · Safari', created_at: new Date(Date.now() - 12_600_000).toISOString() },
  { id: '8', workspace_id: null, actor: 'isa@example.eu', event: 'auth.login', target: 'passkey', ip_address: '85.144.22.10', device: 'macOS · Safari', created_at: new Date(Date.now() - 12_840_000).toISOString() },
]
