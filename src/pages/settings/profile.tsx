import { useState } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '../../components/bb-input'
import { BBButton } from '../../components/bb-button'
import { BBToggle } from '../../components/bb-toggle'
import { useAuth } from '../../lib/auth-context'

export function SettingsProfile() {
  const { user } = useAuth()
  const [publicProfile, setPublicProfile] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  return (
    <SettingsShell activeSection="profile">
      <SettingsHeader
        title="Profile"
        subtitle="Only you and people you share with see this. Server stores an encrypted blob."
      />

      <SettingsRow label="Email" hint="Your login email. Cannot be changed yet.">
        <BBInput value={email} readOnly className="max-w-[340px]" />
      </SettingsRow>

      <SettingsRow label="Display name" hint="Shown on shared links if you choose to reveal it">
        <BBInput defaultValue="" placeholder="Your name" className="max-w-[340px]" />
      </SettingsRow>

      <SettingsRow label="Avatar" hint="Stored encrypted. Shown only when you choose.">
        <div className="flex items-center gap-3.5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-paper text-[22px] font-semibold shrink-0"
            style={{ background: 'linear-gradient(135deg, oklch(0.8 0.15 82), oklch(0.6 0.14 50))' }}
          >
            {initials}
          </div>
          <BBButton size="sm">Upload</BBButton>
          <BBButton size="sm" variant="ghost">Remove</BBButton>
        </div>
      </SettingsRow>

      <SettingsRow label="Public profile" hint="Let people find you by handle when sharing">
        <div className="flex items-center gap-2.5">
          <BBToggle on={publicProfile} onChange={setPublicProfile} />
          <span className="text-[12.5px] text-ink-3">
            {publicProfile ? 'On' : 'Off'} {'·'} you are {publicProfile ? 'visible' : 'invisible'} by handle
          </span>
        </div>
      </SettingsRow>

      <SettingsRow label="Recovery contact" hint="Optional. Notified (not given access) if your account is inactive for 180 days.">
        <BBInput placeholder="email@example.com" className="max-w-[340px]" />
      </SettingsRow>

      <SettingsRow label="Account created" hint="">
        <span className="text-sm text-ink-3 font-mono">
          {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '--'}
        </span>
      </SettingsRow>
    </SettingsShell>
  )
}
