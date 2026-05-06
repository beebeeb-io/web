import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { BBInput } from '../../components/bb-input'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import { useAuth } from '../../lib/auth-context'
import { useKeys } from '../../lib/key-context'
import { ChangePasswordDialog } from '../../components/change-password-dialog'
import { encryptForQr, generateCode } from '../../lib/qr-crypto'
import {
  listSessions, revokeSession,
  listPasskeys, deletePasskey,
  startPasskeyRegistration, finishPasskeyRegistration,
  setup2fa, enable2fa, disable2fa,
  getMe,
  getMySignIns,
  serverOptsToCreateOptions, credentialToRegistrationJSON,
  type Session, type PasskeyInfo, type MySignIn,
} from '../../lib/api'
import { generateRecoveryKitPDF } from '../../lib/recovery-kit-pdf'
import QRCode from 'qrcode'

/* ── Recovery phrase ────────────────────────────── */

function RecoveryPhraseSection() {
  const { user } = useAuth()
  const recoveryPhrase = ''
  return (
    <SettingsRow
      label="Recovery phrase"
      hint="Your 12-word phrase is the only way to recover your account if you lose your password."
    >
      <div className="flex flex-col gap-3 max-w-[460px]">
        <div className="flex items-center gap-2">
          <Icon name="check" size={14} className="text-green" />
          <span className="text-[14px] text-ink">Recovery phrase saved during account setup</span>
        </div>
        <p className="text-[12px] text-ink-3 mt-1">
          If you need your recovery phrase, check your password manager or printed copy.
        </p>
        <div className="flex flex-wrap gap-2">
          <BBButton
            size="sm"
            onClick={() => recoveryPhrase && generateRecoveryKitPDF(recoveryPhrase, user?.email ?? '')}
            title="Opens a print-ready Recovery Kit — choose 'Save as PDF'"
            disabled={!recoveryPhrase || !user?.email}
          >
            <Icon name="file-text" size={13} className="mr-1.5" />
            Download Recovery Kit
          </BBButton>
        </div>
        <p className="text-[11px] text-ink-4 leading-relaxed">
          We cannot retrieve, reset, or regenerate your recovery phrase.
          This is by design — zero-knowledge means only you have access.
        </p>
      </div>
    </SettingsRow>
  )
}

/* ── Recent sign-ins ─────────────────────────────── */

function formatSignInTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device'
  // Compact UA → "Browser on OS"
  const m = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/i)
  const browser = m ? m[1] : 'Browser'
  if (/iphone|ios/i.test(ua)) return `${browser} on iOS`
  if (/android/i.test(ua)) return `${browser} on Android`
  if (/mac os|macintosh/i.test(ua)) return `${browser} on macOS`
  if (/windows/i.test(ua)) return `${browser} on Windows`
  if (/linux/i.test(ua)) return `${browser} on Linux`
  return browser
}

function RecentSignInsSection() {
  const [loading, setLoading] = useState(true)
  const [optedIn, setOptedIn] = useState(false)
  const [signIns, setSignIns] = useState<MySignIn[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMySignIns()
      .then((res) => {
        if (cancelled) return
        setOptedIn(res.opted_in)
        setSignIns(res.sign_ins)
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not load sign-in history.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <SettingsRow
      label="Recent sign-ins"
      hint="The last 10 sign-ins on your account. Available when activity tracking is enabled."
    >
      <div className="max-w-[640px] w-full">
        {loading ? (
          <div className="h-8 flex items-center">
            <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <span className="text-[12.5px] text-ink-3">{error}</span>
        ) : !optedIn ? (
          <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line">
            <Icon name="eye-off" size={13} className="text-ink-3 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Enable activity tracking in <Link to="/settings/privacy" className="text-amber-deep hover:underline">Settings &gt; Privacy</Link> to see sign-in history.
            </p>
          </div>
        ) : signIns.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">No sign-ins recorded yet.</p>
        ) : (
          <div className="border border-line rounded-md overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-paper-2 border-b border-line">
                <tr className="text-left text-[11px] text-ink-3 uppercase tracking-wider">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {signIns.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-ink-2">{formatSignInTime(s.at)}</td>
                    <td className="px-3 py-2 text-ink-2">{deviceLabel(s.user_agent)}</td>
                    <td className="px-3 py-2 font-mono text-ink-3">{s.country_code ?? '—'}</td>
                    <td className="px-3 py-2">
                      {s.success ? (
                        <BBChip variant="green">Success</BBChip>
                      ) : (
                        <span className="inline-flex items-center px-sm py-xs text-xs font-medium rounded-sm bg-red/10 text-red">
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

  useEffect(() => {
    let cancelled = false

    getMe()
      .then((user) => {
        if (cancelled) return
        const status =
          user.totp_enabled ??
          user.two_factor_enabled ??
          user.twoFactorEnabled
        if (typeof status === 'boolean') {
          setEnabled(status)
        }
      })
      .catch(() => {
        // No dedicated 2FA status endpoint exists; leave the setup affordance visible
        // when /me does not expose a usable TOTP flag.
      })

    return () => { cancelled = true }
  }, [])

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
    const copyBackupCodes = () => {
      const text = backupCodes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`).join('\n')
      const full = `Beebeeb — 2FA Backup Codes\n${'─'.repeat(30)}\n\n${text}\n\nEach code can only be used once.\nGenerated: ${new Date().toISOString()}`
      navigator.clipboard.writeText(full)
      showToast({ icon: 'check', title: 'Backup codes copied to clipboard' })
    }

    return (
      <SettingsRow
        label="Two-factor authentication"
        hint="Save these backup codes. They won't be shown again."
      >
        <div className="flex flex-col gap-3 max-w-[420px]">
          <div className="p-4 bg-paper-2 border border-line rounded-lg">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {backupCodes.map((c, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-ink-4 w-4 text-right select-none">{i + 1}.</span>
                  <span className="font-mono text-[14px] font-medium text-ink tracking-wide">{c}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-line flex items-center gap-2">
              <BBButton size="sm" variant="ghost" onClick={copyBackupCodes} className="gap-1.5">
                <Icon name="copy" size={11} />
                Copy all codes
              </BBButton>
            </div>
          </div>
          <div className="text-[11px] text-ink-3 leading-relaxed">
            Store these somewhere safe — a password manager or printed copy.
            Each code works once if you lose access to your authenticator app.
          </div>
          <BBButton size="sm" variant="amber" onClick={handleBackupDone}>I've saved these codes</BBButton>
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
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    listSessions().then((data) => setSessions(data.sessions)).catch(() => {}).finally(() => setSessionsLoading(false))
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
        {sessionsLoading ? (
          <div className="h-8 flex items-center">
            <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-[12.5px] text-ink-3 py-2">No active sessions</div>
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

/* ── Main security page ──────────────────────────── */

export function SettingsSecurity() {
  return (
    <SettingsShell activeSection="security">
      <SettingsHeader
        title="Security"
        subtitle="Your vault keys, authentication methods, and active sessions."
      />
      <RecoveryPhraseSection />
      <RecentSignInsSection />
      <MasterPasswordSection />
      <PasskeysSection />
      <TotpSection />
      <DevicesSessionsSection />
    </SettingsShell>
  )
}
