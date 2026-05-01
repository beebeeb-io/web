import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '../../components/bb-input'
import { BBButton } from '../../components/bb-button'
import { BBToggle } from '../../components/bb-toggle'
import { Icon } from '../../components/icons'
import { useAuth } from '../../lib/auth-context'
import { useToast } from '../../components/toast'
import { RecentActivity } from '../../components/recent-activity'
import {
  getPreference, setPreference, getStorageUsage,
  deleteAccountPermanently, changeEmail, exportAccountData,
  clearToken,
  type StorageUsage,
} from '../../lib/api'
import { StorageBreakdown } from '../../components/storage-breakdown'
import { formatStorageSI } from '../../lib/format'

interface DataRegion {
  id: string
  city: string
  country: string
  flag: string
  provider: string
  available: boolean
}

const DATA_REGIONS: DataRegion[] = [
  { id: 'auto', city: 'Europe', country: '', flag: '', provider: '', available: true },
  { id: 'falkenstein', city: 'Falkenstein', country: 'DE', flag: '\u{1F1E9}\u{1F1EA}', provider: '', available: true },
  { id: 'helsinki', city: 'Helsinki', country: 'FIN', flag: '\u{1F1EB}\u{1F1EE}', provider: '', available: true },
  { id: 'ede', city: 'Ede', country: 'NL', flag: '\u{1F1F3}\u{1F1F1}', provider: 'Beebeeb', available: false },
]

type RegionMode = 'preference' | 'force'

export function SettingsAccount() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  // Profile state
  const [displayName, setDisplayName] = useState('')
  const [publicProfile, setPublicProfile] = useState(false)
  const [recoveryContact, setRecoveryContact] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Storage state
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)

  // Data residency state
  const [selectedRegion, setSelectedRegion] = useState('auto')
  const [savedRegion, setSavedRegion] = useState('auto')
  const [regionMode, setRegionMode] = useState<RegionMode>('preference')
  const [savedRegionMode, setSavedRegionMode] = useState<RegionMode>('preference')
  const [savingRegion, setSavingRegion] = useState(false)

  // Change email state
  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  // Export state
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleting, setDeleting] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  useEffect(() => {
    async function load() {
      try {
        const [pref, regionPref, usageData] = await Promise.all([
          getPreference<{ display_name?: string; public_profile?: boolean; recovery_contact?: string }>('profile').catch(() => null),
          getPreference<{ pool_name: string; mode: RegionMode }>('storage_region').catch(() => null),
          getStorageUsage().catch(() => null),
        ])
        if (pref?.display_name) setDisplayName(pref.display_name)
        if (pref?.public_profile) setPublicProfile(pref.public_profile)
        if (pref?.recovery_contact) setRecoveryContact(pref.recovery_contact)
        if (regionPref?.pool_name) {
          setSelectedRegion(regionPref.pool_name)
          setSavedRegion(regionPref.pool_name)
        }
        if (regionPref?.mode) {
          setRegionMode(regionPref.mode)
          setSavedRegionMode(regionPref.mode)
        }
        if (usageData) setUsage(usageData)
      } catch {
        // defaults are fine
      } finally {
        setLoadingUsage(false)
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

  const hasRegionChanges = selectedRegion !== savedRegion || regionMode !== savedRegionMode

  const handleSaveRegion = useCallback(async () => {
    setSavingRegion(true)
    try {
      await setPreference('storage_region', { pool_name: selectedRegion, mode: regionMode })
      setSavedRegion(selectedRegion)
      setSavedRegionMode(regionMode)
      window.dispatchEvent(new Event('beebeeb:region-changed'))
      showToast({ icon: 'check', title: 'Storage region saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save region', danger: true })
    } finally {
      setSavingRegion(false)
    }
  }, [selectedRegion, regionMode, showToast])

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

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true)
    try {
      await deleteAccountPermanently('DELETE')
      clearToken()
      navigate('/login')
    } catch {
      showToast({ icon: 'x', title: 'Deletion failed. Try again.', danger: true })
      setDeleting(false)
    }
  }, [navigate, showToast])

  const storageSegments = usage
    ? [{ label: 'Used', bytes: usage.used_bytes, color: 'var(--color-amber)' }]
    : []

  return (
    <SettingsShell activeSection="account">
      <SettingsHeader
        title="Account"
        subtitle="Your profile, storage, and account settings."
      />

      {/* ── Section 1: Profile ── */}
      <div className="mt-2 mb-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Profile
        </h2>
      </div>

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

      {/* ── Section: Recent activity ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Recent activity
        </h2>
      </div>
      <div className="px-7 pb-4">
        <RecentActivity limit={5} />
      </div>

      {/* ── Section 2: Storage breakdown ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Storage
        </h2>
      </div>

      <SettingsRow label="Usage" hint="Encrypted storage used across all regions.">
        {loadingUsage ? (
          <div className="h-10 flex items-center">
            <span className="text-[12.5px] text-ink-3">Loading...</span>
          </div>
        ) : usage ? (
          <div className="max-w-[460px] w-full">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm font-semibold text-ink">
                {formatStorageSI(usage.used_bytes)}
              </span>
              <span className="text-[12px] text-ink-3">
                of {formatStorageSI(usage.plan_limit_bytes)}
              </span>
            </div>
            <StorageBreakdown segments={storageSegments} totalBytes={usage.plan_limit_bytes} />
            <div className="text-[11px] text-ink-4 mt-2 font-mono">{usage.plan_name}</div>
          </div>
        ) : (
          <span className="text-[12.5px] text-ink-3">Could not load usage data.</span>
        )}
      </SettingsRow>

      {/* ── Section 3: Data residency ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Data residency
        </h2>
      </div>

      <SettingsRow
        label="Storage region"
        hint="New uploads go to your selected region. Existing files stay where they are."
      >
        <div className="grid gap-2 max-w-[460px]">
          {DATA_REGIONS.map((region) => {
            const isActive = region.id === selectedRegion
            return (
              <button
                key={region.id}
                type="button"
                disabled={!region.available}
                onClick={() => {
                  if (!region.available) return
                  setSelectedRegion(region.id)
                  if (region.id === 'auto') setRegionMode('preference')
                }}
                className={`group/region flex items-center gap-3 px-3.5 py-3 rounded-md border text-left transition-all duration-200 ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg cursor-default'
                    : region.available
                      ? 'border-line bg-paper hover:bg-paper-2 cursor-pointer'
                      : !region.available
                        ? 'border-line bg-paper-2 opacity-60 hover:opacity-100 hover:border-amber/40 hover:shadow-[0_0_20px_oklch(0.82_0.17_84_/_0.15)] cursor-default'
                        : 'border-line bg-paper-2 opacity-50 cursor-not-allowed'
                }`}
              >
                {region.flag ? (
                  <span className="text-[16px] shrink-0">{region.flag}</span>
                ) : (
                  <Icon name="shield" size={15} className={isActive ? 'text-amber-deep shrink-0' : 'text-ink-3 shrink-0'} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[13px] font-mono ${isActive ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                      {region.city}{region.country ? `, ${region.country}` : ''}
                    </span>
                    {region.provider && (
                      <span className="text-[11px] text-ink-4 font-mono">
                        · {region.provider}
                      </span>
                    )}
                  </div>
                  {region.id === 'auto' && (
                    <div className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">
                      Data is sharded across European data centers. No single location holds your complete vault.
                    </div>
                  )}
                  {region.id === 'ede' && (
                    <div className="text-[11px] text-ink-4 mt-0.5 leading-relaxed max-h-0 overflow-hidden opacity-0 group-hover/region:max-h-10 group-hover/region:opacity-100 transition-all duration-300">
                      Our own data center. Built for Beebeeb. Zero third parties.
                    </div>
                  )}
                </div>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep shrink-0" />
                )}
                {!region.available && (
                  <span className="text-[10px] font-medium uppercase tracking-wider shrink-0 transition-colors duration-200 text-ink-4 group-hover/region:text-amber-deep">
                    Coming soon
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="text-[11px] text-ink-3 mt-3 leading-relaxed">
          New uploads go to your selected region. Existing files stay where they are.
          Need to migrate? <a href="mailto:support@beebeeb.io" className="text-amber-deep hover:underline">Contact us</a>.
        </div>
      </SettingsRow>

      {selectedRegion !== 'auto' && (
        <SettingsRow
          label="Storage mode"
          hint={
            regionMode === 'preference'
              ? 'Store here when possible. If this region is full, overflow to another.'
              : 'Only this region. Uploads may fail if capacity is limited.'
          }
        >
          <div className="flex items-center gap-3">
            <div className="flex rounded-md border border-line overflow-hidden w-fit">
              {(['preference', 'force'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRegionMode(mode)}
                  className={`px-4 py-1.5 text-[12.5px] font-medium transition-colors ${
                    regionMode === mode
                      ? 'bg-ink text-paper'
                      : 'bg-paper text-ink-2 hover:bg-paper-2'
                  }`}
                >
                  {mode === 'preference' ? 'Preference' : 'Force'}
                </button>
              ))}
            </div>
            {regionMode === 'force' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-bg text-amber-deep border border-amber-deep/20">
                <Icon name="eye" size={10} />
                Capacity limited — uploads may be rejected when full
              </span>
            )}
          </div>
        </SettingsRow>
      )}

      {hasRegionChanges && (
        <div className="flex justify-end px-7 py-4">
          <BBButton variant="amber" onClick={handleSaveRegion} disabled={savingRegion}>
            {savingRegion ? 'Saving...' : 'Save region'}
          </BBButton>
        </div>
      )}

      {/* ── Section 4: Danger zone ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-red px-7 py-3">
          Danger zone
        </h2>
      </div>

      <div className="mx-7 mb-6 rounded-lg border border-red/20 bg-red/5 overflow-hidden">
        {/* Change email */}
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

        {/* Export data */}
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

        {/* Delete account */}
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
