import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

export function ApiTokens() {
  return (
    <AdminShell activeSection="api-tokens">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="key" size={15} />
        <span className="text-sm font-semibold text-ink">API Tokens</span>
        <BBChip>Coming soon</BBChip>
      </div>
      <div className="px-5 py-16 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-paper-2 border border-line-2 border-dashed flex items-center justify-center">
          <Icon name="key" size={24} className="text-ink-4" />
        </div>
        <h3 className="text-sm font-semibold text-ink mb-1">Programmatic access</h3>
        <p className="text-[13px] text-ink-3 max-w-sm mx-auto">
          Create scoped API tokens for CI/CD pipelines, automation, and third-party integrations.
          Every request is end-to-end encrypted — tokens never see plaintext.
        </p>
        <p className="text-[11px] text-ink-4 mt-4">
          This feature is under development.
        </p>
      </div>
    </AdminShell>
  )
}
