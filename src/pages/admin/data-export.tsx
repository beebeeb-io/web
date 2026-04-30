import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

export function DataExport() {
  return (
    <AdminShell activeSection="data-export">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="download" size={15} />
        <span className="text-sm font-semibold text-ink">Data Export</span>
        <BBChip>Coming soon</BBChip>
      </div>
      <div className="px-5 py-16 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-paper-2 border border-line-2 border-dashed flex items-center justify-center">
          <Icon name="download" size={24} className="text-ink-4" />
        </div>
        <h3 className="text-sm font-semibold text-ink mb-1">GDPR data export</h3>
        <p className="text-[13px] text-ink-3 max-w-sm mx-auto">
          Download an encrypted archive of all your data. Article 20 GDPR — your right,
          our obligation. Includes files, metadata, sharing history, and audit logs.
        </p>
        <p className="text-[11px] text-ink-4 mt-4">
          This feature is under development.
        </p>
      </div>
    </AdminShell>
  )
}
