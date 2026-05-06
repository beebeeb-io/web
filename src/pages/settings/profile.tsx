import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '../../components/bb-input'
import { BBButton } from '../../components/bb-button'
import { BBToggle } from '../../components/bb-toggle'
import { Icon } from '../../components/icons'
import { useAuth } from '../../lib/auth-context'
import { useToast } from '../../components/toast'
import {
  getPreference, setPreference,
  deleteAccountPermanently, changeEmail, exportAccountData,
  getTrackingPreference, setTrackingPreference,
  clearToken, ApiError,
} from '../../lib/api'
import { ConfirmPasswordModal } from '../../components/confirm-password-modal'

export function SettingsProfile() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [publicProfile, setPublicProfile] = useState(false)
  const [recoveryContact, setRecoveryContact] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [pwPromptOpen, setPwPromptOpen] = useState(false)

  const [trackingOptedIn, setTrackingOptedIn] = useState(false)
  const [trackingLoading, setTrackingLoading] = useState(true)
  const [trackingConfirmOff, setTrackingConfirmOff] = useState(false)
  const [trackingExplainerOn, setTrackingExplainerOn] = useState(false)
  const [trackingSaving, setTrackingSaving] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  useEffect(() => {
    async function load() {
      try {
        const [pref, trackingPref] = await Promise.all([
          getPreference<{ display_name?: string; public_profile?: boolean; recovery_contact?: string }>('profile').catch(() => null),
          getTrackingPreference().catch(() => null),
        ])
        if (pref?.display_name) setDisplayName(pref.display_name)
        if (pref?.public_profile) setPublicProfile(pref.public_profile)
        if (pref?.recovery_contact) setRecoveryContact(pref.recovery_contact)
        setTrackingOptedIn(trackingPref?.tracking_opted_in ?? false)
      } catch {
        // defaults are fine
      } finally {
        setTrackingLoading(false)
      }
    }
    void load()
  }, [])

  const handleSaveProfile = useCallback(async () => {
    setSavingProfile(true)
    try {
      await setPreference('profile', {
        display_name: displayName,
        public_profile: publicProfile,
        recovery_contact: recoveryContact,
      })
      showToast({ icon: 'check', title: 'Profile saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save', danger: true })
    } finally {
      setSavingProfile(false)
    }
  }, [displayName, publicProfile, recoveryContact, showToast])

  const handleChangeEmail = useCallback(async () => {
    setSavingEmail(true)
    try {
      await changeEmail(newEmail, emailPassword)
      showToast({ icon: 'check', title: 'Verification email sent', description: 'Check your inbox to confirm the new address.' })
      setShowChangeEmail(false)
      setNewEmail('')
      setEmailPassword('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change email'
      showToast({ icon: 'x', title: msg, danger: true })
    } finally {
      setSavingEmail(false)
    }
  }, [newEmail, emailPassword, showToast])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const data = await exportAccountData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `beebeeb-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast({ icon: 'check', title: 'Export downloaded' })
    } catch {
      showToast({ icon: 'x', title: 'Export failed', danger: true })
    } finally {
      setExporting(false)
    }
  }, [showToast])

  const handleTrackingToggle = useCallback((newValue: boolean) => {
    if (!newValue) {
      setTrackingConfirmOff(true)
    } else {
      setTrackingExplainerOn(true)
      setTrackingOptedIn(true)
      setTrackingSaving(true)
      setTrackingPreference(true)
        .then(() => { /* saved */ })
        .catch(() => {
          setTrackingOptedIn(false)
          showToast({ icon: 'x', title: 'Failed to save tracking preference', danger: true })
        })
        .finally(() => setTrackingSaving(false))
    }
  }, [showToast])

  const handleTrackingConfirmOff = useCallback(() => {
    setTrackingConfirmOff(false)
    setTrackingOptedIn(false)
    setTrackingSaving(true)
    setTrackingPreference(false)
      .catch(() => {
        setTrackingOptedIn(true)
        showToast({ icon: 'x', title: 'Failed to save tracking preference', danger: true })
      })
      .finally(() => setTrackingSaving(false))
  }, [showToast])

  const handleDeleteAccount = useCallback(() => {
    setPwPromptOpen(true)
  }, [])

  const performDeleteAccount = useCallback(
    async (token: string) => {
      setPwPromptOpen(false)
      setDeleting(true)
      try {
        await deleteAccountPermanently('DELETE', token)
        clearToken()
        navigate('/login')
      } catch (e) {
        const description =
          e instanceof ApiError && e.status === 403 ? 'Re-authentication expired. Try again.' : undefined
        showToast({
          icon: 'x',
          title: 'Deletion failed. Try again.',
          description,
          danger: true,
        })
        setDeleting(false)
      }
    },
    [navigate, showToast],
  )

  return (
    <SettingsShell activeSection="profile">
      <ConfirmPasswordModal
        open={pwPromptOpen}
        title="Confirm account deletion"
        description="Re-enter your password to permanently delete your account. This cannot be undone."
        confirmLabel="Delete account"
        onConfirmed={performDeleteAccount}
        onCancel={() => setPwPromptOpen(false)}
      />

      <SettingsHeader
        title="Profile"
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

      <SettingsRow
        label="Recovery contact"
        hint="Optional. Notified (not given access) if your account is inactive for 180 days."
      >
        <BBInput
          value={recoveryContact}
          onChange={(e) => setRecoveryContact(e.target.value)}
          placeholder="email@example.com"
          className="max-w-[340px]"
        />
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

      {/* ── Activity tracking ────────────────────────────────────────────── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Privacy
        </h2>
      </div>

      {trackingConfirmOff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30"
          onClick={(e) => { if (e.target === e.currentTarget) setTrackingConfirmOff(false) }}
        >
          <div className="w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="text-[15px] font-semibold text-ink">Disable activity tracking?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
                We will stop collecting sign-in and activity data immediately. All data already collected will be deleted within 30 days.
              </p>
              <div className="flex items-center gap-2 p-3 rounded-md bg-paper-2 border border-line mb-5">
                <Icon name="shield" size={13} className="text-ink-3 shrink-0" />
                <p className="text-[11.5px] text-ink-3 leading-relaxed">
                  Deletion is irreversible. This is your right under GDPR Article 17.
                </p>
              </div>
              <div className="flex gap-2">
                <BBButton
                  variant="default"
                  size="md"
                  onClick={handleTrackingConfirmOff}
                  className="flex-1 justify-center"
                >
                  Disable and delete data
                </BBButton>
                <BBButton
                  variant="ghost"
                  size="md"
                  onClick={() => setTrackingConfirmOff(false)}
                >
                  Cancel
                </BBButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsRow
        label="Activity tracking"
        hint="Sign-ins and file activity. Helps us provide support and detect suspicious access. Default: off."
      >
        <div className="flex flex-col gap-3 max-w-[460px]">
          {trackingLoading ? (
            <div className="h-8 flex items-center">
              <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <BBToggle on={trackingOptedIn} onChange={handleTrackingToggle} disabled={trackingSaving} />
                <span className="text-[12.5px] text-ink-3">
                  {trackingOptedIn ? 'Enabled — sign-ins and activity are being logged' : 'Disabled — no activity data is collected'}
                </span>
              </div>

              {trackingExplainerOn && (
                <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-bg border border-amber/20">
                  <Icon name="shield" size={13} className="text-amber-deep shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[12px] text-ink-2 leading-relaxed">
                      We will log sign-ins (anonymized IP, device, country) and file activity (uploads, shares, deletes). You can disable this at any time.
                    </p>
                    <button
                      className="text-[11px] text-amber-deep hover:underline mt-1"
                      onClick={() => setTrackingExplainerOn(false)}
                    >
                      Got it
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-ink-4 leading-relaxed">
                When enabled: we log which devices signed in, and high-level file actions (not file contents — we cannot read them).
                Disabling deletes all collected data within 30 days.{' '}
                <a href="/privacy" className="text-amber-deep hover:underline">Learn more about our privacy practices</a>.
              </p>
            </>
          )}
        </div>
      </SettingsRow>

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-red px-7 py-3">
          Danger zone
        </h2>
      </div>

      <div className="mx-7 mb-6 rounded-lg border border-red/20 bg-red/5 overflow-hidden">
        <SettingsRow label="Change email" hint="Update the email address used to log in." danger>
          {showChangeEmail ? (
            <div className="flex flex-col gap-2 max-w-[360px]">
              <BBInput
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                type="email"
              />
              <BBInput
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Current password"
                type="password"
              />
              <div className="flex gap-2">
                <BBButton
                  size="sm"
                  onClick={handleChangeEmail}
                  disabled={savingEmail || !newEmail || !emailPassword}
                >
                  {savingEmail ? 'Sending...' : 'Send verification email'}
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowChangeEmail(false); setNewEmail(''); setEmailPassword('') }}
                >
                  Cancel
                </BBButton>
              </div>
            </div>
          ) : (
            <BBButton size="sm" variant="ghost" onClick={() => setShowChangeEmail(true)}>
              Change email
            </BBButton>
          )}
        </SettingsRow>

        <SettingsRow label="Export data" hint="Download a copy of your account data and file metadata." danger>
          {showExport ? (
            <div className="flex flex-col gap-2 max-w-[360px]">
              <div className="text-[12.5px] text-ink-2">
                Downloads your preferences, shares, and file metadata as JSON. Art. 20 GDPR.
              </div>
              <div className="flex gap-2">
                <BBButton
                  size="sm"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  <Icon name="download" size={12} className="mr-1.5" />
                  {exporting ? 'Exporting...' : 'Download JSON'}
                </BBButton>
                <BBButton size="sm" variant="ghost" onClick={() => setShowExport(false)}>
                  Cancel
                </BBButton>
              </div>
            </div>
          ) : (
            <BBButton size="sm" variant="ghost" onClick={() => setShowExport(true)}>
              Export data
            </BBButton>
          )}
        </SettingsRow>

        <SettingsRow
          label="Delete account"
          hint="Permanently destroys your encryption keys. All files become unreadable. This cannot be undone."
          danger
        >
          {showDeleteConfirm ? (
            <div className="flex flex-col gap-2 max-w-[360px]">
              <div className="text-[12.5px] text-ink-2">
                This permanently destroys your encryption keys. All files become unreadable. This cannot be undone.
              </div>
              <BBInput
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={`Type ${email} to confirm`}
              />
              <div className="flex gap-2">
                <BBButton
                  size="sm"
                  variant="danger"
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmEmail !== email}
                >
                  {deleting ? 'Deleting...' : 'Delete my account'}
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmEmail('') }}
                >
                  Cancel
                </BBButton>
              </div>
            </div>
          ) : (
            <BBButton size="sm" variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete account
            </BBButton>
          )}
        </SettingsRow>
      </div>
    </SettingsShell>
  )
}
