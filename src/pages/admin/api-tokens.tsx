import { useState } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

interface ApiToken {
  id: string
  name: string
  scope: string
  lastUsed: string
  expires: string
  active: boolean
}

const initialTokens: ApiToken[] = [
  { id: '1', name: 'deploy-bot', scope: 'read:files · write:uploads', lastUsed: '12 min ago', expires: 'never', active: true },
  { id: '2', name: 'isa-laptop-rclone', scope: 'read:* · write:*', lastUsed: '2h ago', expires: 'May 2026', active: true },
  { id: '3', name: 'old-ci-token', scope: 'read:files', lastUsed: '41 days ago', expires: 'expired', active: false },
]

const connectedApps = ['rclone', 'Zapier', 'n8n', 'Raycast', 'bb CLI']

export function ApiTokens() {
  const [tokens, setTokens] = useState(initialTokens)

  function handleRevoke(id: string) {
    setTokens(prev => prev.filter(t => t.id !== id))
  }

  return (
    <AdminShell activeSection="api-tokens">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="key" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">API tokens & connected apps</h2>
        <BBButton size="sm" variant="amber" className="ml-auto">+ New token</BBButton>
      </div>

      {/* Token list */}
      <div className="px-2">
        {tokens.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-3.5 px-3.5 py-3.5 ${
              i < tokens.length - 1 ? 'border-b border-line' : ''
            }`}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
              style={{
                background: t.active ? 'var(--color-amber-bg)' : 'var(--color-paper-2)',
                borderColor: t.active ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
              }}
            >
              <Icon
                name={t.active ? 'key' : 'x'}
                size={14}
                style={{ color: t.active ? 'var(--color-amber-deep)' : 'var(--color-ink-4)' }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">{t.name}</div>
              <div className="font-mono text-[11px] text-ink-3 mt-0.5">{t.scope}</div>
            </div>
            <div className="text-[10px] text-ink-3 w-[120px]">Last used {t.lastUsed}</div>
            <BBChip variant={t.expires === 'expired' ? 'default' : t.expires === 'never' ? 'amber' : 'default'}>
              Expires {t.expires}
            </BBChip>
            <BBButton size="sm" variant="ghost" onClick={() => handleRevoke(t.id)}>
              Revoke
            </BBButton>
          </div>
        ))}
      </div>

      {/* Connected apps */}
      <div className="px-5 py-3.5 border-t border-line bg-paper-2 mt-auto">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
          Connected apps
        </div>
        <div className="flex gap-2 flex-wrap">
          {connectedApps.map(app => (
            <div
              key={app}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-paper border border-line-2 text-[11.5px]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green" />
              {app}
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  )
}
