import { useState } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { BBToggle } from '../../components/bb-toggle'
import { AdminShell } from './admin-shell'

const providers = ['Okta', 'Entra ID', 'JumpCloud', 'Generic'] as const

const policies = [
  { label: 'Require SSO for example.eu addresses', defaultOn: true },
  { label: 'Allow personal Beebeeb for guests', defaultOn: true },
  { label: 'Just-in-time provisioning', defaultOn: true },
  { label: 'SCIM user sync', defaultOn: false },
]

export function SsoSetup() {
  const [selectedProvider, setSelectedProvider] = useState(0)
  const [policyState, setPolicyState] = useState(
    policies.map(p => p.defaultOn),
  )

  function togglePolicy(idx: number) {
    setPolicyState(prev => prev.map((v, i) => (i === idx ? !v : v)))
  }

  return (
    <AdminShell activeSection="sso">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="key" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">SSO &middot; SAML 2.0</h2>
        <BBChip variant="amber">Business tier</BBChip>
        <BBChip variant="green" className="ml-auto">Configured</BBChip>
      </div>

      {/* Body */}
      <div className="grid grid-cols-2 gap-6 p-6">
        {/* Left column */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            1 &middot; Your SAML provider
          </div>
          <div className="flex gap-2 mb-4">
            {providers.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelectedProvider(i)}
                className={`px-2.5 py-1.5 text-[11.5px] rounded-md border cursor-pointer transition-colors ${
                  selectedProvider === i
                    ? 'bg-amber-bg border-amber-deep font-medium'
                    : 'bg-paper-2 border-line-2 hover:border-line'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            2 &middot; IdP metadata URL
          </div>
          <div className="px-2.5 py-2 rounded-md border border-line-2 bg-paper-2 font-mono text-[11.5px] text-ink-2 break-all mb-4">
            https://panorama.okta.com/app/exk1a2b3/sso/saml/metadata
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            3 &middot; Domain claim
          </div>
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border"
            style={{ background: 'oklch(0.96 0.04 155)', borderColor: 'oklch(0.87 0.08 155)' }}
          >
            <span
              className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: 'oklch(0.72 0.16 155)' }}
            >
              <Icon name="check" size={10} />
            </span>
            <div>
              <div className="font-mono text-xs">example.eu</div>
              <div className="text-[10px] text-ink-3">TXT record verified 2d ago</div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Beebeeb &rarr; IdP
          </div>
          <div className="p-3.5 rounded-lg bg-paper-2 border border-line font-mono text-[11px] text-ink-2 leading-relaxed mb-4">
            <div><span className="text-ink-3">ACS URL:</span> https://beebeeb.io/sso/panorama/acs</div>
            <div><span className="text-ink-3">Entity ID:</span> urn:beebeeb:panorama</div>
            <div><span className="text-ink-3">NameID:</span> emailAddress</div>
            <div><span className="text-ink-3">Signing cert:</span> SHA-256 &middot; c2f1...8a9e</div>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Policy
          </div>
          <div className="flex flex-col gap-2 mb-5">
            {policies.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 px-2.5 py-2 bg-paper-2 rounded-md border border-line"
              >
                <BBToggle on={policyState[i]} onChange={() => togglePolicy(i)} />
                <span className="text-[12.5px]">{p.label}</span>
              </div>
            ))}
          </div>

          <div className="p-3 bg-amber-bg border border-amber-deep rounded-lg text-[11.5px] text-ink-2 leading-relaxed">
            <strong>E2EE note:</strong> SSO authenticates the session. Your vault key is still derived from the recovery phrase --- IdP never sees it.
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-line bg-paper-2 mt-auto justify-end">
        <BBButton variant="ghost">Test login</BBButton>
        <BBButton variant="amber">Save configuration</BBButton>
      </div>
    </AdminShell>
  )
}
