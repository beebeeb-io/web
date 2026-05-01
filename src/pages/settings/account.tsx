import { useState, useEffect, useCallback, useRef } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '../../components/bb-input'
import { BBButton } from '../../components/bb-button'
import { BBToggle } from '../../components/bb-toggle'
import { Icon } from '../../components/icons'
import { useAuth } from '../../lib/auth-context'
import { useToast } from '../../components/toast'
import { getPreference, setPreference, getStorageUsage, type StorageUsage } from '../../lib/api'
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
  { id: 'auto', city: 'Auto', country: 'EU', flag: '', provider: '', available: true },
  { id: 'falkenstein', city: 'Falkenstein', country: 'DE', flag: '\u{1F1E9}\u{1F1EA}', provider: '', available: true },
  { id: 'helsinki', city: 'Helsinki', country: 'FIN', flag: '\u{1F1EB}\u{1F1EE}', provider: '', available: true },
  { id: 'ede', city: 'Ede', country: 'NL', flag: '\u{1F1F3}\u{1F1F1}', provider: 'Beebeeb', available: false },
]

type RegionMode = 'preference' | 'force'

export function SettingsAccount() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Profile state
  const [displayName, setDisplayName] = useState('')
  const [publicProfile, setPublicProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  // Storage state
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)

  // Data residency state
  const [selectedRegion, setSelectedRegion] = useState('frankfurt')
  const [savedRegion, setSavedRegion] = useState('frankfurt')
  const [regionMode, setRegionMode] = useState<RegionMode>('preference')
  const [savedRegionMode, setSavedRegionMode] = useState<RegionMode>('preference')
  const [savingRegion, setSavingRegion] = useState(false)

  // Danger zone state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  useEffect(() => {
    async function load() {
      try {
        const [pref, regionPref, usageData] = await Promise.all([
          getPreference<{ display_name: string; public_profile: boolean }>('profile').catch(() => null),
          getPreference<{ pool_name: string; mode: RegionMode }>('storage_region').catch(() => null),
          getStorageUsage().catch(() => null),
        ])
        if (pref?.display_name) setDisplayName(pref.display_name)
        if (pref?.public_profile) setPublicProfile(pref.public_profile)
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
      await setPreference('profile', { display_name: displayName, public_profile: publicProfile })
      showToast({ icon: 'check', title: 'Profile saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save', danger: true })
    } finally {
      setSavingProfile(false)
    }
  }, [displayName, publicProfile, showToast])

  const hasRegionChanges = selectedRegion !== savedRegion || regionMode !== savedRegionMode

  const handleSaveRegion = useCallback(async () => {
    setSavingRegion(true)
    try {
      await setPreference('storage_region', { pool_name: selectedRegion, mode: regionMode })
      setSavedRegion(selectedRegion)
      setSavedRegionMode(regionMode)
      showToast({ icon: 'check', title: 'Storage region saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save region', danger: true })
    } finally {
      setSavingRegion(false)
    }
  }, [selectedRegion, regionMode, showToast])

  const handleFileSelected = useCallback(() => {
    showToast({ icon: 'check', title: 'Avatar upload coming soon' })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [showToast])

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

      <SettingsRow label="Avatar" hint="Stored encrypted. Shown only when you choose.">
        <div className="flex items-center gap-3.5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-paper text-[22px] font-semibold shrink-0"
            style={{ background: 'linear-gradient(135deg, oklch(0.8 0.15 82), oklch(0.6 0.14 50))' }}
          >
            {initials}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelected}
          />
          <BBButton size="sm" onClick={() => fileInputRef.current?.click()}>Upload</BBButton>
          <BBButton size="sm" variant="ghost">Remove</BBButton>
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
        <BBInput placeholder="email@example.com" className="max-w-[340px]" />
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
                onClick={() => region.available && setSelectedRegion(region.id)}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-md border text-left transition-colors ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg cursor-default'
                    : region.available
                      ? 'border-line bg-paper hover:bg-paper-2 cursor-pointer'
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
                      {region.city}{region.flag ? `, ${region.country}` : ''}
                    </span>
                    {region.provider && (
                      <span className="text-[11px] text-ink-4 font-mono">
                        · {region.provider}
                      </span>
                    )}
                  </div>
                  {region.id === 'auto' && (
                    <div className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">
                      Data is sharded across all available regions. No single data center holds your complete vault.
                    </div>
                  )}
                </div>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep shrink-0" />
                )}
                {!region.available && (
                  <span className="text-[10px] font-medium text-ink-4 uppercase tracking-wider shrink-0">
                    Coming soon
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label="Storage mode"
        hint={
          regionMode === 'preference'
            ? 'Store here when possible. If this region is full, overflow to another.'
            : 'Only this region. Uploads may fail if capacity is limited.'
        }
      >
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
      </SettingsRow>

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
        <SettingsRow label="Change email" hint="Update the email address used to log in." danger>
          <BBButton
            size="sm"
            variant="ghost"
            onClick={() => showToast({ icon: 'x', title: 'Email change coming soon', danger: true })}
          >
            Change email
          </BBButton>
        </SettingsRow>

        <SettingsRow label="Export data" hint="Download a copy of all your encrypted files and metadata." danger>
          <BBButton
            size="sm"
            variant="ghost"
            onClick={() => showToast({ icon: 'x', title: 'Data export coming soon', danger: true })}
          >
            Export data
          </BBButton>
        </SettingsRow>

        <SettingsRow label="Delete account" hint="Permanently deletes your account and all data. We cannot recover this." danger>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-red">Are you sure?</span>
              <BBButton
                size="sm"
                variant="danger"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  showToast({ icon: 'x', title: 'Account deletion coming soon', danger: true })
                }}
              >
                Delete account
              </BBButton>
              <BBButton size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </BBButton>
            </div>
          ) : (
            <BBButton
              size="sm"
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete account
            </BBButton>
          )}
        </SettingsRow>
      </div>
    </SettingsShell>
  )
}
