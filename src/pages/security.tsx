import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../components/settings-shell'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { useToast } from '../components/toast'
import { ChangePasswordDialog } from '../components/change-password-dialog'
import { useKeys } from '../lib/key-context'
import { encryptForQr, generateCode } from '../lib/qr-crypto'
import {
  listSessions, revokeSession,
  listPasskeys, deletePasskey,
  startPasskeyRegistration, finishPasskeyRegistration,
  setup2fa, enable2fa, disable2fa,
  getPreference,
  serverOptsToCreateOptions, credentialToRegistrationJSON,
  type Session, type PasskeyInfo,
} from '../lib/api'
import QRCode from 'qrcode'

/* ── Recovery phrase ────────────────────────────── */

function RecoveryPhraseSection() {
  const { getMasterKey, isUnlocked } = useKeys()
  const { showToast } = useToast()
  const [phrase, setPhrase] = useState<string[] | null>(null)
  const [hideTimer, setHideTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const handleView = useCallback(() => {
    if (!isUnlocked) {
      showToast({ icon: 'lock', title: 'Vault locked', description: 'Unlock your vault to view the recovery phrase.' })
      return
    }
    try {
      const key = getMasterKey()
      // Display key bytes as BIP39-style hex words (12 groups of 2 bytes each = 24 hex chars)
      const hex = Array.from(key).map((b) => b.toString(16).padStart(2, '0')).join('')
      const words: string[] = []
      for (let i = 0; i < 24; i += 2) words.push(hex.slice(i, i + 2))
      setPhrase(words)
      if (hideTimer) clearTimeout(hideTimer)
      const t = setTimeout(() => setPhrase(null), 30_000)
      setHideTimer(t)
    } catch {
      showToast({ icon: 'x', title: 'Could not read recovery phrase', danger: true })
    }
  }, [getMasterKey, isUnlocked, showToast, hideTimer])

  const handleDownload = useCallback(() => {
    if (!isUnlocked) {
      showToast({ icon: 'lock', title: 'Vault locked', description: 'Unlock your vault to download the recovery phrase.' })
      return
    }
    try {
      const key = getMasterKey()
      const hex = Array.from(key).map((b) => b.toString(16).padStart(2, '0')).join('')
      const words: string[] = []
      for (let i = 0; i < 24; i += 2) words.push(hex.slice(i, i + 2))
      const content = [
        'BEEBEEB RECOVERY PHRASE',
        'Keep this safe. Do not share it. We cannot recover it.',
        '',
        words.join(' '),
        '',
        `Generated: ${new Date().toISOString()}`,
      ].join('\n')
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'beebeeb-recovery-phrase.txt'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast({ icon: 'x', title: 'Could not generate download', danger: true })
    }
  }, [getMasterKey, isUnlocked, showToast])

  return (
    <SettingsRow
      label="Recovery phrase"
      hint="This is the only key to your vault. If you lose it, we can't help."
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <BBButton size="sm" onClick={handleView}>
            <Icon name="eye" size={12} className="mr-1.5" />
            View phrase
          </BBButton>
          <BBButton size="sm" variant="ghost" onClick={handleDownload}>
            <Icon name="download" size={12} className="mr-1.5" />
            Download
          </BBButton>
        </div>
        {phrase && (
          <div className="flex flex-wrap gap-1.5 p-3 bg-paper-2 border border-line rounded-md max-w-[420px]">
            {phrase.map((w, i) => (
              <span key={i} className="font-mono text-xs text-ink bg-paper border border-line rounded px-1.5 py-0.5">
                {i + 1}. {w}
              </span>
            ))}
            <div className="w-full text-[11px] text-ink-3 mt-1">
              Auto-hidden in 30 seconds. Do not share.
            </div>
          </div>
        )}
      </div>
    </SettingsRow>
  )
}

/* ── Master password ─────────────────────────────── */

function MasterPasswordSection() {
  const [open, setOpen] = useState(false)
  const { showToast } = useToast()

  return (
    <>
      <SettingsRow
        label="Master password"
        hint="Used to decrypt your key bundle. Argon2id — memory-hard on your device."
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-3" style={{ letterSpacing: '0.15em' }}>
            ••••••••••••••••••••••••
          </span>
          <BBButton size="sm" onClick={() => setOpen(true)}>Change password</BBButton>
        </div>
      </SettingsRow>
      <ChangePasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          showToast({ icon: 'check', title: 'Password changed', description: 'All other sessions have been signed out' })
        }}
      />
    </>
  )
}

/* ── Passkeys ────────────────────────────────────── */

function PasskeysSection() {
  const { showToast } = useToast()
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [addingPasskey, setAddingPasskey] = useState(false)

  useEffect(() => {
    listPasskeys().then(setPasskeys).catch(() => {})
  }, [])

  const handleAdd = useCallback(async () => {
    setAddingPasskey(true)
    try {
      const { publicKey, reg_state } = await startPasskeyRegistration()
      const createOpts = serverOptsToCreateOptions(publicKey)
      const credential = await navigator.credentials.create({ publicKey: createOpts }) as PublicKeyCredential | null
      if (!credential) {
        showToast({ icon: 'x', title: 'Passkey creation cancelled', danger: true })
        return
      }
      const json = credentialToRegistrationJSON(credential)
      const info = await finishPasskeyRegistration(json, reg_state)
      setPasskeys((prev) => [...prev, info])
      showToast({ icon: 'check', title: 'Passkey added' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add passkey'
      showToast({ icon: 'x', title: msg, danger: true })
    } finally {
      setAddingPasskey(false)
    }
  }, [showToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deletePasskey(id)
      setPasskeys((prev) => prev.filter((p) => p.id !== id))
      setDeletingId(null)
      showToast({ icon: 'check', title: 'Passkey removed' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to remove passkey', danger: true })
    }
  }, [showToast])

  return (
    <SettingsRow
      label="Passkeys"
      hint="Sign in with your device's biometrics instead of a password."
    >
      <div className="flex flex-col gap-2 max-w-[420px]">
        {passkeys.map((pk) => (
          <div key={pk.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-3 py-2 bg-paper-2 border border-line rounded-md">
              <Icon name="key" size={13} className="text-amber-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink truncate">{pk.name}</div>
                <div className="text-[11px] font-mono text-ink-3">
                  Added {new Date(pk.created_at).toLocaleDateString()}
                </div>
              </div>
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => setDeletingId(pk.id)}
              >
                Remove
              </BBButton>
            </div>
            {deletingId === pk.id && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red/30 bg-red/5">
                <span className="text-xs text-ink-2 flex-1">Remove this passkey?</span>
                <BBButton size="sm" variant="danger" onClick={() => handleDelete(pk.id)}>
                  Confirm
                </BBButton>
                <BBButton size="sm" variant="ghost" onClick={() => setDeletingId(null)}>
                  Cancel
                </BBButton>
              </div>
            )}
          </div>
        ))}
        <BBButton size="sm" variant="ghost" onClick={handleAdd} disabled={addingPasskey}>
          <Icon name="plus" size={12} className="mr-1.5" />
          {addingPasskey ? 'Adding...' : 'Add passkey'}
        </BBButton>
      </div>
    </SettingsRow>
  )
}

/* ── TOTP / 2FA ──────────────────────────────────── */

type TotpStep = 'idle' | 'setup' | 'verify' | 'backup'

function TotpSection() {
  const { showToast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [step, setStep] = useState<TotpStep>('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [disableCode, setDisableCode] = useState('')
  const [error, setError] = useState('')

  const handleSetup = useCallback(async () => {
    setError('')
    try {
      const data = await setup2fa()
      setSecret(data.secret)
      setBackupCodes(data.backup_codes)
      const url = await QRCode.toDataURL(data.qr_uri, { width: 180, margin: 1 })
      setQrDataUrl(url)
      setStep('setup')
    } catch {
      showToast({ icon: 'x', title: 'Failed to start 2FA setup', danger: true })
    }
  }, [showToast])

  const handleVerify = useCallback(async () => {
    setError('')
    try {
      await enable2fa(code)
      setStep('backup')
    } catch {
      setError('Invalid code. Try again.')
    }
  }, [code])

  const handleBackupDone = useCallback(() => {
    setEnabled(true)
    setStep('idle')
    setCode('')
    setQrDataUrl('')
    showToast({ icon: 'check', title: 'Two-factor authentication enabled' })
  }, [showToast])

  const handleDisable = useCallback(async () => {
    setError('')
    try {
      await disable2fa(disableCode)
      setEnabled(false)
      setDisabling(false)
      setDisableCode('')
      showToast({ icon: 'check', title: 'Two-factor authentication disabled' })
    } catch {
      setError('Invalid code. Try again.')
    }
  }, [disableCode, showToast])

  if (step === 'setup') {
    return (
      <SettingsRow
        label="Two-factor authentication"
        hint="Scan the QR code with your authenticator app, then enter the 6-digit code."
      >
        <div className="flex flex-col gap-4 max-w-[420px]">
          {qrDataUrl && (
            <div className="flex gap-4 items-start">
              <div className="rounded-md border border-line p-1.5 bg-white shrink-0">
                <img src={qrDataUrl} alt="QR code" width={120} height={120} />
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-ink-3 mb-1">Or enter manually:</div>
                <code className="text-[12px] font-mono text-ink-2 break-all">{secret}</code>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <BBInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              className="max-w-[200px] font-mono"
              maxLength={6}
            />
            {error && <div className="text-xs text-red">{error}</div>}
          </div>
          <div className="flex gap-2">
            <BBButton size="sm" onClick={handleVerify} disabled={code.length < 6}>
              Verify
            </BBButton>
            <BBButton size="sm" variant="ghost" onClick={() => { setStep('idle'); setCode(''); setError('') }}>
              Cancel
            </BBButton>
          </div>
        </div>
      </SettingsRow>
    )
  }

  if (step === 'backup') {
    return (
      <SettingsRow
        label="Two-factor authentication"
        hint="Save these backup codes. They won't be shown again."
      >
        <div className="flex flex-col gap-3 max-w-[420px]">
          <div className="grid grid-cols-2 gap-1 p-3 bg-paper-2 border border-line rounded-md font-mono text-sm">
            {backupCodes.map((c, i) => (
              <span key={i} className="text-ink">{c}</span>
            ))}
          </div>
          <div className="text-[11px] text-ink-3">
            Store these somewhere safe. Each code works once if you lose access to your authenticator.
          </div>
          <BBButton size="sm" onClick={handleBackupDone}>I've saved these codes</BBButton>
        </div>
      </SettingsRow>
    )
  }

  return (
    <SettingsRow
      label="Two-factor authentication"
      hint="Add a second layer with an authenticator app."
    >
      {enabled ? (
        <div className="flex flex-col gap-2 max-w-[420px]">
          <div className="flex items-center gap-2">
            <BBChip variant="green">Enabled</BBChip>
            <BBButton size="sm" variant="ghost" onClick={() => { setDisabling(true); setError('') }}>
              Disable
            </BBButton>
          </div>
          {disabling && (
            <div className="flex flex-col gap-2 p-3 bg-paper-2 border border-line rounded-md">
              <div className="text-[12.5px] text-ink-2">Enter your current authenticator code to disable 2FA.</div>
              <BBInput
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="6-digit code"
                className="max-w-[200px] font-mono"
                maxLength={6}
              />
              {error && <div className="text-xs text-red">{error}</div>}
              <div className="flex gap-2">
                <BBButton size="sm" variant="danger" onClick={handleDisable} disabled={disableCode.length < 6}>
                  Disable 2FA
                </BBButton>
                <BBButton size="sm" variant="ghost" onClick={() => { setDisabling(false); setDisableCode(''); setError('') }}>
                  Cancel
                </BBButton>
              </div>
            </div>
          )}
        </div>
      ) : (
        <BBButton size="sm" onClick={handleSetup}>Set up</BBButton>
      )}
    </SettingsRow>
  )
}

/* ── Add Device Panel ────────────────────────────── */

function AddDevicePanel() {
  const { getMasterKey, isUnlocked } = useKeys()
  const [showQr, setShowQr] = useState(false)
  const [code, setCode] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [error, setError] = useState('')
  const [expiresIn, setExpiresIn] = useState(300)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startProvisioning = useCallback(async () => {
    setError('')
    try {
      const masterKey = getMasterKey()
      const numericCode = generateCode()
      const payload = await encryptForQr(masterKey, numericCode)
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 240,
        margin: 2,
        color: { dark: '#1a1714', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setCode(numericCode)
      setQrDataUrl(dataUrl)
      setShowQr(true)
      setExpiresIn(300)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate QR code')
    }
  }, [getMasterKey])

  useEffect(() => {
    if (!showQr) return
    timerRef.current = setInterval(() => {
      setExpiresIn((prev) => {
        if (prev <= 1) {
          setShowQr(false)
          setCode('')
          setQrDataUrl('')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [showQr])

  const cancelProvisioning = () => {
    setShowQr(false)
    setCode('')
    setQrDataUrl('')
    setExpiresIn(300)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  if (!isUnlocked) return null

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12.5px] font-medium text-ink">Add a device</div>
        {!showQr && (
          <BBButton size="sm" variant="ghost" onClick={startProvisioning}>
            <Icon name="plus" size={12} className="mr-1.5" />
            Generate QR
          </BBButton>
        )}
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed mb-2">
        Scan on a new device to transfer your vault key securely.
      </p>
      {error && <p className="text-xs text-red mt-2">{error}</p>}
      {showQr && (
        <div className="mt-3 flex gap-6 items-start">
          <div className="shrink-0">
            <div className="rounded-lg border border-line p-2 bg-white">
              <img src={qrDataUrl} alt="Device provisioning QR code" width={200} height={200} className="block" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ink-2 mb-2 leading-relaxed">
              Open Beebeeb on the new device, sign in, and choose "Scan QR". Then enter this code:
            </p>
            <div className="inline-flex items-center gap-3 bg-paper-2 border border-line rounded-lg px-4 py-2.5">
              <span className="text-xl font-mono font-bold text-ink tracking-[0.2em]">
                {code.slice(0, 3)} {code.slice(3)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Icon name="clock" size={11} className="text-ink-3" />
              <span className="text-[11px] font-mono text-ink-3">Expires in {formatTime(expiresIn)}</span>
            </div>
            <div className="mt-3">
              <BBButton size="sm" variant="ghost" onClick={cancelProvisioning}>Cancel</BBButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Devices & sessions ──────────────────────────── */

function DevicesSessionsSection() {
  const { showToast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    listSessions().then((data) => setSessions(data.sessions)).catch(() => {})
  }, [])

  const confirmRevoke = useCallback(async (id: string) => {
    try {
      await revokeSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setRevoking(null)
      showToast({ icon: 'check', title: 'Session revoked' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to revoke session', danger: true })
    }
  }, [showToast])

  return (
    <SettingsRow
      label="Devices & sessions"
      hint="Every device holding an active session."
    >
      <div className="flex flex-col gap-2 max-w-[480px]">
        <AddDevicePanel />
        {sessions.length === 0 ? (
          <div className="text-[12.5px] text-ink-3 py-2">Loading sessions...</div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-paper-2 border border-line rounded-md">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center border shrink-0"
                  style={{
                    background: s.is_current ? 'var(--color-ink)' : 'var(--color-paper-3)',
                    borderColor: s.is_current ? 'var(--color-ink)' : 'var(--color-line)',
                    color: s.is_current ? 'var(--color-amber)' : 'var(--color-ink-3)',
                  }}
                >
                  <Icon name="lock" size={11} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    Session
                    {s.is_current && <BBChip variant="amber">Current</BBChip>}
                  </div>
                  <div className="text-[11px] font-mono text-ink-3">
                    Created {new Date(s.created_at).toLocaleDateString()} · expires {new Date(s.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {!s.is_current && (
                  <BBButton size="sm" variant="ghost" onClick={() => setRevoking(s.id)}>
                    Revoke
                  </BBButton>
                )}
              </div>
              {revoking === s.id && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red/30 bg-red/5">
                  <span className="text-xs text-ink-2 flex-1">This device will be signed out.</span>
                  <BBButton size="sm" variant="danger" onClick={() => confirmRevoke(s.id)}>
                    Confirm revoke
                  </BBButton>
                  <BBButton size="sm" variant="ghost" onClick={() => setRevoking(null)}>
                    Cancel
                  </BBButton>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </SettingsRow>
  )
}

/* ── Trusted contact ─────────────────────────────── */

function TrustedContactSection() {
  const [contact, setContact] = useState<string | null>(null)

  useEffect(() => {
    getPreference<{ display_name?: string; public_profile?: boolean; recovery_contact?: string }>('profile')
      .then((pref) => setContact(pref?.recovery_contact ?? null))
      .catch(() => {})
  }, [])

  return (
    <SettingsRow
      label="Trusted contact"
      hint="Notified (not given access) if your account is inactive for 180 days."
    >
      {contact ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink font-mono">{contact}</span>
          <Link to="/settings/account" className="text-xs text-amber-deep hover:underline">
            Change
          </Link>
        </div>
      ) : (
        <Link to="/settings/account" className="text-sm text-amber-deep hover:underline">
          Set up in Account settings
        </Link>
      )}
    </SettingsRow>
  )
}

/* ── Main security page ──────────────────────────── */

export function Security() {
  return (
    <SettingsShell activeSection="security">
      <SettingsHeader
        title="Security"
        subtitle="Your vault keys, authentication methods, and active sessions."
      />
      <RecoveryPhraseSection />
      <MasterPasswordSection />
      <PasskeysSection />
      <TotpSection />
      <DevicesSessionsSection />
      <TrustedContactSection />
    </SettingsShell>
  )
}
