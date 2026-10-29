import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBToggle } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../../lib/auth-context'
import { useToast } from '../../components/toast'
import {
  getPreference, setPreference,
  emailChangeStart, emailChangeFinish,
  getMyProfile, updatePublicProfile,
} from '../../lib/api'
import { ConfirmPasswordModal } from '../../components/confirm-password-modal'
import {
  opaqueRegistrationStart, opaqueRegistrationFinish,
  computeRecoveryCheck, deriveX25519Public, toBase64, fromBase64,
} from '../../lib/crypto'
import { useKeys } from '../../lib/key-context'

export function SettingsProfile() {
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()
  const { getMasterKey } = useKeys()

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [publicProfile, setPublicProfile] = useState(false)
  const [recoveryContact, setRecoveryContact] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [emailChangePwOpen, setEmailChangePwOpen] = useState(false)
  const [emailChangeInputOpen, setEmailChangeInputOpen] = useState(false)
  const [emailChangePendingToken, setEmailChangePendingToken] = useState('')
  const [emailChangePendingPw, setEmailChangePendingPw] = useState('')
  const [newEmailForChange, setNewEmailForChange] = useState('')
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null)
  const [emailChangeProcessing, setEmailChangeProcessing] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  useEffect(() => {
    async function load() {
      try {
        const [pref, profileData] = await Promise.all([
          getPreference<{ display_name?: string; public_profile?: boolean; recovery_contact?: string }>('profile').catch(() => null),
          getMyProfile().catch(() => null),
        ])
        if (pref?.display_name) setDisplayName(pref.display_name)
        if (pref?.public_profile) setPublicProfile(pref.public_profile)
        if (pref?.recovery_contact) setRecoveryContact(pref.recovery_contact)
        if (profileData?.username) setUsername(profileData.username)
      } catch {
        // defaults are fine
      }
    }
    void load()
  }, [])

  const handleSaveProfile = useCallback(async () => {
    // Validate username before saving
    if (username) {
      const usernameOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(username)
      if (!usernameOk) {
        setUsernameError('3-32 chars, lowercase letters, numbers, or hyphens. Must start and end with a letter or number.')
        return
      }
    }
    setUsernameError(null)
    setSavingProfile(true)
    try {
      await Promise.all([
        setPreference('profile', {
          display_name: displayName,
          public_profile: publicProfile,
          recovery_contact: recoveryContact,
        }),
        // Save username + display_name to the users table via the profile endpoint
        updatePublicProfile({
          username: username || undefined,
          display_name: displayName || undefined,
        }),
      ])
      showToast({ icon: 'check', title: 'Profile saved' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      if (msg.toLowerCase().includes('taken') || msg.toLowerCase().includes('already')) {
        setUsernameError('Username is already taken. Choose a different one.')
      } else {
        showToast({ icon: 'x', title: 'Failed to save', danger: true })
      }
    } finally {
      setSavingProfile(false)
    }
  }, [displayName, username, publicProfile, recoveryContact, showToast])

  const handleEmailChangePwConfirmed = useCallback((token: string, password: string) => {
    setEmailChangePendingToken(token)
    setEmailChangePendingPw(password)
    setEmailChangePwOpen(false)
    setNewEmailForChange('')
    setEmailChangeError(null)
    setEmailChangeInputOpen(true)
  }, [])

  const handleEmailChangeSubmit = useCallback(async () => {
    if (!newEmailForChange || emailChangeProcessing) return
    setEmailChangeProcessing(true)
    setEmailChangeError(null)
    try {
      const regStart = await opaqueRegistrationStart(emailChangePendingPw)
      const startResult = await emailChangeStart(newEmailForChange, toBase64(regStart.message), emailChangePendingToken)
      const regUpload = await opaqueRegistrationFinish(regStart.state, emailChangePendingPw, fromBase64(startResult.server_message))
      const masterKey = getMasterKey()
      const [recoveryCheckBytes, x25519Pub] = await Promise.all([
        computeRecoveryCheck(masterKey),
        deriveX25519Public(masterKey),
      ])
      await emailChangeFinish(
        startResult.email_change_token,
        toBase64(regUpload),
        toBase64(recoveryCheckBytes),
        toBase64(x25519Pub),
      )
      await refreshUser()
      setEmailChangeInputOpen(false)
      setEmailChangePendingToken('')
      setEmailChangePendingPw('')
      setNewEmailForChange('')
      showToast({ icon: 'check', title: `Email changed to ${newEmailForChange}`, description: 'Check your inbox for verification.' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change email'
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('in use')) {
        setEmailChangeError('This email is already in use.')
      } else {
        setEmailChangeError(msg)
      }
    } finally {
      setEmailChangeProcessing(false)
    }
  }, [newEmailForChange, emailChangeProcessing, emailChangePendingPw, emailChangePendingToken, getMasterKey, refreshUser, showToast])

  return (
    <SettingsShell activeSection="profile">

      <ConfirmPasswordModal
        open={emailChangePwOpen}
        title="Confirm it's you"
        description="Re-enter your password to start the email change process."
        confirmLabel="Continue"
        onConfirmed={handleEmailChangePwConfirmed}
        onCancel={() => setEmailChangePwOpen(false)}
      />

      {emailChangeInputOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20"
          onClick={(e) => { if (e.target === e.currentTarget && !emailChangeProcessing) { setEmailChangeInputOpen(false) } }}
        >
          <div className="w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-line flex items-center gap-2.5">
              <Icon name="lock" size={14} className="text-ink" />
              <span className="text-sm font-semibold text-ink">Change email address</span>
              <button
                className="ml-auto text-ink-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-40"
                onClick={() => { if (!emailChangeProcessing) setEmailChangeInputOpen(false) }}
                disabled={emailChangeProcessing}
                aria-label="Close"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-[12.5px] text-ink-2 leading-relaxed mb-4">
                Enter your new email address. You will receive a verification link there.
              </p>
              <BBInput
                label="New email address"
                type="email"
                value={newEmailForChange}
                onChange={(e) => { setNewEmailForChange(e.target.value); setEmailChangeError(null) }}
                placeholder="new@example.com"
                autoComplete="email"
                autoFocus
                error={emailChangeError ?? undefined}
                className="mb-4"
                disabled={emailChangeProcessing}
              />
              <div className="flex gap-2 justify-end">
                <BBButton
                  size="md"
                  onClick={() => { if (!emailChangeProcessing) setEmailChangeInputOpen(false) }}
                  disabled={emailChangeProcessing}
                >
                  Cancel
                </BBButton>
                <BBButton
                  size="md"
                  variant="amber"
                  onClick={handleEmailChangeSubmit}
                  disabled={!newEmailForChange || emailChangeProcessing}
                >
                  {emailChangeProcessing ? 'Updating…' : 'Change email'}
                </BBButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsHeader
        title="Account"
        subtitle="Your identity and how you appear to others."
      />

      <SettingsRow label="Email" hint="Your login email.">
        <BBInput value={email} readOnly className="max-w-[340px]" />
      </SettingsRow>

      <SettingsRow label="Display name" hint="Shown on shared links if you choose to reveal it.">
        <BBInput
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          className="max-w-[340px]"
        />
      </SettingsRow>

      <SettingsRow label="Username" hint="Your public handle at app.beebeeb.io/p/:username — lowercase, 3-32 chars.">
        <div className="flex flex-col gap-1 max-w-[340px]">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-ink-3 select-none">@</span>
            <BBInput
              value={username}
              onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUsernameError(null) }}
              placeholder="your-handle"
              className="pl-7 max-w-[340px]"
              error={usernameError ?? undefined}
            />
          </div>
          {username && !usernameError && (
            <span className="text-[11px] text-ink-4 font-mono">
              app.beebeeb.io/p/{username}
            </span>
          )}
        </div>
      </SettingsRow>

      <SettingsRow label="Avatar" hint="Derived from your email. Avatar upload is not available in a zero-knowledge vault.">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-paper text-[22px] font-semibold shrink-0"
          style={{ background: 'linear-gradient(135deg, oklch(0.8 0.15 82), oklch(0.6 0.14 50))' }}
        >
          {initials}
        </div>
      </SettingsRow>

      <SettingsRow label="Public profile" hint="Let people find you by handle when sharing.">
        <div className="flex items-center gap-2.5">
          <BBToggle on={publicProfile} onChange={setPublicProfile} />
          <span className="text-[12.5px] text-ink-3">
            {publicProfile ? 'On' : 'Off'} · you are {publicProfile ? 'visible' : 'invisible'} by handle
          </span>
        </div>
      </SettingsRow>

      <SettingsRow label="Account created" hint="">
        <span className="text-sm text-ink-3 font-mono">
          {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '--'}
        </span>
      </SettingsRow>

      <div className="flex justify-end px-7 py-4">
        <BBButton variant="amber" onClick={handleSaveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save profile'}
        </BBButton>
      </div>

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-red px-7 py-3">
          Danger zone
        </h2>
      </div>

      <div className="mx-7 mb-6 rounded-lg border border-red/20 bg-red/5 overflow-hidden">
        <SettingsRow label="Change email" hint="Update the email address used to log in." danger>
          <BBButton size="sm" variant="ghost" onClick={() => setEmailChangePwOpen(true)}>
            Change email
          </BBButton>
        </SettingsRow>

      </div>
    </SettingsShell>
  )
}
