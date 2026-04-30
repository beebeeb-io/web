import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

export function Compliance() {
  return (
    <AdminShell activeSection="compliance">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="shield" size={15} />
        <span className="text-sm font-semibold text-ink">Compliance</span>
        <BBChip>Coming soon</BBChip>
      </div>
      <div className="px-5 py-16 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-paper-2 border border-line-2 border-dashed flex items-center justify-center">
          <Icon name="check" size={24} className="text-ink-4" />
        </div>
        <h3 className="text-sm font-semibold text-ink mb-1">Compliance dashboard</h3>
        <p className="text-[13px] text-ink-3 max-w-sm mx-auto">
          GDPR readiness checklist, data processing agreements, encryption attestation,
          and audit-ready documentation — all in one place.
        </p>
        <p className="text-[11px] text-ink-4 mt-4">
          This feature is under development for the Business plan.
        </p>
      </div>
    </AdminShell>
  )
}
