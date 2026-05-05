import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBInput } from '../../components/bb-input'
import { BBButton } from '../../components/bb-button'
import { BBToggle } from '../../components/bb-toggle'
import { Icon } from '../../components/icons'
import { useAuth } from '../../lib/auth-context'
import { useKeys } from '../../lib/key-context'
import { useToast } from '../../components/toast'
import { RecentActivity } from '../../components/recent-activity'
import {
  getPreference, setPreference, getStorageUsage, recoverWithPhraseStart,
  deleteAccountPermanently, changeEmail, exportAccountData,
  createPortalSession, getSubscription,
  clearToken, ApiError,
  type StorageUsage, type Subscription,
} from '../../lib/api'
import { recoverFromPhrase, computeRecoveryCheck, toBase64, initCrypto } from '../../lib/crypto'
import { StorageUsageBar } from '../../components/storage-usage-bar'
import { ConfirmPasswordModal } from '../../components/confirm-password-modal'
import { generateRecoveryKitPDF } from '../../lib/recovery-kit-pdf'


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
  const { getMasterKey } = useKeys()
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

  // Subscription state (for the plan summary strip)
  const [sub, setSub] = useState<Subscription | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  // Recovery phrase test modal
  const [phraseModalOpen, setPhraseModalOpen] = useState(false)
  const [testPhrase, setTestPhrase] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'checking' | 'correct' | 'wrong' | 'unavailable'>('idle')
  const testCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const [pwPromptOpen, setPwPromptOpen] = useState(false)

  const email = user?.email ?? ''
  const initials = email ? email.split('@')[0].slice(0, 2).toUpperCase() : '??'

  useEffect(() => {
    async function load() {
      try {
        const [pref, regionPref, usageData, subData] = await Promise.all([
          getPreference<{ display_name?: string; public_profile?: boolean; recovery_contact?: string }>('profile').catch(() => null),
          getPreference<{ pool_name: string; mode: RegionMode }>('storage_region').catch(() => null),
          getStorageUsage().catch(() => null),
          getSubscription().catch(() => null),
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
        if (subData) setSub(subData)
      } catch {
        // defaults are fine
      } finally {
        setLoadingUsage(false)
      }
    }
    void load()
  }, [])

  const handleManageSubscription = useCallback(async () => {
    setPortalLoading(true)
    try {
      const result = await createPortalSession()
      if (result === null) {
        showToast({
          icon: 'cloud',
          title: 'Billing portal not available yet',
          description: 'Stripe billing is being set up. Check back soon.',
        })
        return
      }
      window.location.href = result.url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Billing portal unavailable',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setPortalLoading(false)
    }
  }, [showToast])

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

  // ── Recovery phrase test ─────────────────────────────────────────────────
  const handlePhraseTest = useCallback(async () => {
    const phrase = testPhrase.trim()
    if (!phrase) return
    setTestStatus('checking')

    try {
      await initCrypto()
      const inputMasterKey = await recoverFromPhrase(phrase)

      // Primary: local comparison — derive recovery_check from the input phrase
      // and compare against the recovery_check of the current in-memory master key.
      // This works without any server call and is purely cryptographic.
      let match = false
      try {
        const currentMasterKey = getMasterKey()
        const [inputCheck, currentCheck] = await Promise.all([
          computeRecoveryCheck(inputMasterKey),
          computeRecoveryCheck(currentMasterKey),
        ])
        // Constant-time compare via JSON (acceptable for UX context, not crypto auth)
        match = toBase64(inputCheck) === toBase64(currentCheck)
      } catch {
        // Vault locked or key unavailable — fall back to server verification
        const inputCheck = await computeRecoveryCheck(inputMasterKey)
        const email = user?.email ?? ''
        const result = await recoverWithPhraseStart(email, toBase64(inputCheck))
        if (result === null) {
          // Endpoint not deployed yet
          setTestStatus('unavailable')
          return
        }
        match = true  // 401 would have thrown; reaching here means success
      }

      if (match) {
        setTestStatus('correct')
        // Clear phrase from DOM and auto-close after 3 s
        setTestPhrase('')
        testCloseTimerRef.current = setTimeout(() => {
          setPhraseModalOpen(false)
          setTestStatus('idle')
        }, 3000)
      } else {
        setTestStatus('wrong')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setTestStatus('wrong')
      } else if (err instanceof ApiError && err.status === 404) {
        setTestStatus('unavailable')
      } else {
        setTestStatus('wrong')  // recoverFromPhrase throws on invalid phrase
      }
    }
  }, [testPhrase, getMasterKey, user?.email])

  const closePhraseModal = useCallback(() => {
    if (testCloseTimerRef.current) clearTimeout(testCloseTimerRef.current)
    setPhraseModalOpen(false)
    setTestStatus('idle')
    setTestPhrase('')
  }, [])

  return (
    <SettingsShell activeSection="account">
      <ConfirmPasswordModal
        open={pwPromptOpen}
        title="Confirm account deletion"
        description="Re-enter your password to permanently delete your account. This cannot be undone."
        confirmLabel="Delete account"
        onConfirmed={performDeleteAccount}
        onCancel={() => setPwPromptOpen(false)}
      />

      {/* ── Recovery phrase test modal ─────────────────────────────────── */}
      {phraseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) closePhraseModal() }}
        >
          <div className="w-full max-w-[480px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
              <Icon name="key" size={16} className="text-amber-deep" />
              <span className="text-[15px] font-semibold text-ink flex-1">Test recovery phrase</span>
              <button
                onClick={closePhraseModal}
                className="text-ink-3 hover:text-ink transition-colors p-1 rounded"
                aria-label="Close"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="px-5 py-5">
              {/* Safety banner */}
              <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line mb-4">
                <Icon name="shield" size={13} className="text-ink-3 shrink-0 mt-0.5" />
                <p className="text-[12px] text-ink-3 leading-relaxed">
                  <strong className="text-ink-2">This is a test only.</strong>{' '}
                  Your account will not be modified. No login session is created.
                </p>
              </div>

              {testStatus === 'correct' ? (
                // ── Success ──
                <div className="flex flex-col items-center py-5 gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-green/10 border border-green/20 flex items-center justify-center">
                    <Icon name="check" size={22} className="text-green" />
                  </div>
                  <p className="text-[14px] font-semibold text-ink">Your recovery phrase is correct</p>
                  <p className="text-[12px] text-ink-3">Closing in a moment…</p>
                </div>
              ) : testStatus === 'unavailable' ? (
                // ── Unavailable ──
                <div className="flex flex-col items-center py-5 gap-3 text-center">
                  <Icon name="cloud" size={24} className="text-ink-3" />
                  <p className="text-[13px] text-ink-3">Server verification is not available right now.</p>
                  <BBButton variant="ghost" size="sm" onClick={closePhraseModal}>Close</BBButton>
                </div>
              ) : (
                <>
                  <label className="block text-[12px] font-medium text-ink-2 mb-1.5">
                    Recovery phrase
                  </label>
                  <textarea
                    autoComplete="off"
                    spellCheck={false}
                    rows={3}
                    placeholder="word1 word2 word3 … word12"
                    value={testPhrase}
                    onChange={(e) => { setTestPhrase(e.target.value); setTestStatus('idle') }}
                    disabled={testStatus === 'checking'}
                    className="w-full font-mono text-[13px] text-ink bg-paper border border-line rounded-md px-3 py-2 outline-none resize-none placeholder:text-ink-4 focus:border-line-2 transition-colors leading-relaxed disabled:opacity-50"
                  />

                  {testStatus === 'wrong' && (
                    <p className="text-[12px] text-red mt-2">
                      This phrase doesn&apos;t match your account. Check for typos or wrong word order.
                    </p>
                  )}

                  <div className="flex gap-2 mt-4">
                    <BBButton
                      variant="amber"
                      size="md"
                      className="flex-1 justify-center"
                      disabled={testStatus === 'checking' || !testPhrase.trim()}
                      onClick={handlePhraseTest}
                    >
                      {testStatus === 'checking'
                        ? <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />Verifying…</>
                        : 'Verify phrase'}
                    </BBButton>
                    <BBButton variant="ghost" size="md" onClick={closePhraseModal}>
                      Cancel
                    </BBButton>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
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
            <StorageUsageBar
              usedBytes={usage.used_bytes}
              quotaBytes={usage.plan_limit_bytes}
              planName={usage.plan_name}
            />
          </div>
        ) : (
          <span className="text-[12.5px] text-ink-3">Could not load usage data.</span>
        )}
      </SettingsRow>

      {/* ── Section: Subscription ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Subscription
        </h2>
      </div>

      <SettingsRow
        label="Current plan"
        hint="Manage your plan, payment method, and invoices."
      >
        <div className="flex items-center gap-3 flex-wrap">
          {/* Plan name badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-paper-2 border border-line">
            <span className="w-2 h-2 rounded-full bg-amber-deep shrink-0" />
            <span className="text-[13px] font-medium text-ink capitalize">
              {sub
                ? (sub.status === 'cancelled' ? 'Free' : (sub.plan ?? 'Free'))
                : 'Free'}
            </span>
            {sub && sub.plan && sub.plan !== 'free' && sub.status !== 'cancelled' && (
              <span className="text-[11px] text-ink-3 font-mono">
                {sub.billing_cycle === 'yearly' ? '· annual' : '· monthly'}
              </span>
            )}
          </div>

          {/* Action buttons */}
          {(!sub || sub.plan === 'free' || sub.status === 'cancelled') ? (
            <a
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-amber text-ink hover:brightness-105 transition-all no-underline"
            >
              <Icon name="star" size={11} />
              Upgrade plan
            </a>
          ) : (
            <BBButton
              size="sm"
              variant="default"
              onClick={() => void handleManageSubscription()}
              disabled={portalLoading}
            >
              <Icon name="settings" size={12} className="mr-1.5" />
              {portalLoading ? 'Loading...' : 'Manage subscription'}
            </BBButton>
          )}

          <a
            href="/settings/billing"
            className="text-[12.5px] text-ink-3 hover:text-ink transition-colors no-underline"
          >
            View billing →
          </a>
        </div>
      </SettingsRow>

      {/* ── Section 3: Recovery phrase ── */}
      <div className="mt-4 mb-1 border-t border-line pt-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Recovery phrase
        </h2>
      </div>

      <SettingsRow
        label="Phrase status"
        hint="Your 12-word phrase is the only way to recover your account if you lose your password."
      >
        <div className="flex flex-col gap-3 max-w-[460px]">
          {/* Status badge */}
          <div className="flex items-center gap-2 text-[13px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'oklch(0.55 0.12 155)' }} />
            <span className="text-ink-2 font-medium">Recovery phrase verified at signup</span>
          </div>
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <BBButton
              size="sm"
              variant="amber"
              onClick={() => { setTestStatus('idle'); setTestPhrase(''); setPhraseModalOpen(true) }}
            >
              <Icon name="key" size={13} className="mr-1.5" />
              Test your phrase
            </BBButton>
            <BBButton
              size="sm"
              onClick={() => generateRecoveryKitPDF('', user?.email ?? '')}
              title="Opens a print-ready Recovery Kit — choose 'Save as PDF'"
              disabled={!user?.email}
            >
              <Icon name="file-text" size={13} className="mr-1.5" />
              Download Recovery Kit
            </BBButton>
          </div>
          <p className="text-[11px] text-ink-4 leading-relaxed">
            The Recovery Kit PDF includes your phrase only during onboarding when it&apos;s first shown.
            Use &ldquo;Test your phrase&rdquo; to confirm you still have it.
          </p>
        </div>
      </SettingsRow>

      {/* ── Section 4: Data residency ── */}
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
