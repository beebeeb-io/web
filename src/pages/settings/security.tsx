import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import { useKeys } from '../../lib/key-context'
import { useAuth } from '../../lib/auth-context'
import { ChangePasswordDialog } from '../../components/change-password-dialog'
import { StepUpAuth } from '../../components/step-up-auth'
import {
  getAccountSessions, revokeAccountSession, revokeAllOtherSessions,
  listPasskeys, deletePasskey,
  setup2fa, enable2fa, disable2fa,
  getMe,
  getMySignIns,
  type AccountSession, type PasskeyInfo, type MySignIn,
} from '../../lib/api'
import { getVaultTTL, setVaultTTL, TTL_OPTIONS } from '../../lib/session-persist'
import { removeVaultWrapKey } from '../../lib/passkey-vault'
import { useAddPasskeyFlow } from '../../hooks/use-add-passkey-flow'
import QRCode from 'qrcode'

/* ── Recovery phrase ────────────────────────────── */

function RecoveryPhraseSection() {
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
        <div className="flex items-start gap-2.5 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <Icon name="file-text" size={13} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Your recovery phrase was shown once during onboarding. If you downloaded it then, keep it safe. It cannot be shown again.
          </p>
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
              Enable activity tracking in <Link to="/settings/profile" className="text-amber-deep hover:underline">Settings &gt; Profile</Link> to see sign-in history.
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

/* ── Vault timeout ──────────────────────────────── */

function VaultTimeoutSection() {
  const [ttl, setTtl] = useState(() => getVaultTTL())
  const { showToast } = useToast()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value, 10)
    setTtl(val)
    setVaultTTL(val)
    showToast({
      icon: 'check',
      title: 'Stay unlocked updated',
      description: val === 0 ? 'Password required on every refresh' : `Stay unlocked for up to ${TTL_OPTIONS.find(o => o.value === val)?.label ?? 'custom duration'} of inactivity on this browser`,
    })
  }

  return (
    <SettingsRow
      label="Stay unlocked"
      hint="How long you can stay idle before this browser asks you to unlock again. Any activity resets the clock — up to 60 minutes."
    >
      <select
        value={ttl}
        onChange={handleChange}
        className="rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink font-sans focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber cursor-pointer"
      >
        {TTL_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </SettingsRow>
  )
}

/* ── Passkeys ────────────────────────────────────── */

function PasskeysSection() {
  const { showToast } = useToast()
  const { getMasterKey, isUnlocked } = useKeys()
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    listPasskeys().then(setPasskeys).catch(() => {})
  }, [])

  // Task 1493: adding a passkey now requires a fresh step-up (password, or
  // a passkey assertion for passkey-only accounts) before the server will
  // issue a registration challenge. `useAddPasskeyFlow` owns the step-up
  // modal + the WebAuthn create ceremony + vault-key escrow wrapping —
  // shared with passkey-setup.tsx and security.tsx.
  const { stepUpOpen, adding, requestAddPasskey, closeStepUp, handleStepUpConfirmed } = useAddPasskeyFlow({
    isUnlocked,
    getMasterKey,
    onAdded: (info) => {
      setPasskeys((prev) => [...prev, info])
      showToast({ icon: 'check', title: 'Passkey added' })
    },
    onError: (message) => {
      showToast({ icon: 'x', title: message, danger: true })
    },
  })

  const handleAdd = useCallback(() => {
    requestAddPasskey()
  }, [requestAddPasskey])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deletePasskey(id)
      removeVaultWrapKey(id) // Clean up localStorage fallback key
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
      <StepUpAuth
        open={stepUpOpen}
        onConfirmed={handleStepUpConfirmed}
        onClose={closeStepUp}
        description="Confirm your identity before adding a new passkey."
        submitLabel="Continue"
      />
      <div className="flex flex-col gap-2 max-w-[420px]">
        {passkeys.map((pk) => (
          <div key={pk.id ?? ''} className="flex flex-col gap-1">
            <div
              data-testid="passkey-row"
              className="flex items-center gap-2 px-3 py-2 bg-paper-2 border border-line rounded-md"
            >
              <Icon name="key" size={13} className="text-amber-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink truncate">{pk.name ?? '—'}</div>
                <div className="text-[11px] font-mono text-ink-3">
                  Added {pk.created_at ? new Date(pk.created_at).toLocaleDateString() : '—'}
                </div>
              </div>
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => setDeletingId(pk.id ?? null)}
              >
                Remove
              </BBButton>
            </div>
            {pk.id && deletingId === pk.id && (
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
        <BBButton size="sm" variant="ghost" onClick={handleAdd} disabled={adding}>
          <Icon name="plus" size={12} className="mr-1.5" />
          {adding ? 'Adding...' : 'Add passkey'}
        </BBButton>
      </div>
    </SettingsRow>
  )
}

/* ── TOTP / 2FA ──────────────────────────────────── */

type TotpStep = 'idle' | 'setup' | 'verify' | 'backup'

function TotpSection() {
  const { showToast } = useToast()
  const { refreshUser } = useAuth()
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
      // Refresh AuthProvider's `user` so anything deriving live state from
      // `user.totp_enabled` (e.g. the drive's welcome checklist, task 1527)
      // sees this immediately instead of the stale value from login/boot
      // until a full page reload (Codex review, PR #74).
      refreshUser().catch(() => {})
    } catch {
      setError('Invalid code. Try again.')
    }
  }, [code, refreshUser])

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
      // See handleVerify above — same stale-`user` fix (Codex review, PR #74).
      refreshUser().catch(() => {})
    } catch {
      setError('Invalid code. Try again.')
    }
  }, [disableCode, showToast, refreshUser])

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
    const copyBackupCodes = async () => {
      const text = backupCodes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`).join('\n')
      const full = `Beebeeb — 2FA Backup Codes\n${'─'.repeat(30)}\n\n${text}\n\nEach code can only be used once.\nGenerated: ${new Date().toISOString()}`
      await navigator.clipboard.writeText(full)
      // Auto-clear clipboard after 60s to limit exposure of backup codes
      setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}) }, 60000)
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
//
// Task 1528 (Guus ruling, 2026-09-25): "remove scan QR for now (not sure if
// it works)". The add-device-via-QR panel (formerly `AddDevicePanel`,
// generating a QR + 6-digit code for a new device to scan) is removed from
// this UI. Corrected 2026-09-25 (web #73 continuation, item 9): this
// comment previously claimed the QR-scanning half was "left in place, just
// unreferenced" in device-provision.tsx — that's wrong; it was actually
// DELETED from that file by the same 1528 change (jsQR, decryptFromQr, and
// all camera/scan state — see device-provision.tsx's own header comment
// and the PR #73 diff). Only src/lib/qr-crypto.ts's three exports
// (encryptForQr/decryptFromQr/generateCode) remain, as dead code with zero
// call sites anywhere in src/ as of this date.

/* ── Devices & sessions ──────────────────────────── */

// Task 1543 finding 4: the old `Session` shape (list_sessions) carried no
// device_name/kind/country, so every row rendered the literal word "Session"
// — a user responding to a suspected compromise had no way to tell which row
// was which device. Reuse the richer /api/v1/account/sessions endpoint
// (AccountSession: device_name, device_kind, country_code, last_active_at)
// that the orphaned AccountActivityPanel already consumed but nothing ever
// rendered.
function sessionDeviceIcon(kind: string): 'file-code' | 'settings' | 'link' | 'shield' | 'cloud' {
  switch (kind) {
    case 'cli': return 'file-code'
    case 'desktop': return 'settings'
    case 'api': return 'link'
    case 'ios':
    case 'android': return 'shield'
    default: return 'cloud'
  }
}

function timeAgoLabel(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'Active just now'
  if (mins < 60) return `Active ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Active ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Active ${days}d ago`
  return `Active ${new Date(iso).toLocaleDateString()}`
}

function DevicesSessionsSection() {
  const { showToast } = useToast()
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  useEffect(() => {
    getAccountSessions().then((data) => setSessions(data.sessions)).catch(() => {}).finally(() => setSessionsLoading(false))
  }, [])

  const confirmRevoke = useCallback(async (id: string) => {
    try {
      await revokeAccountSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setRevoking(null)
      showToast({ icon: 'check', title: 'Session revoked' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to revoke session', danger: true })
    }
  }, [showToast])

  // Task 1543 finding 1: this bulk action existed server-side and in a
  // client wrapper (revokeAllOtherSessions) but was reachable from NO
  // rendered page — every logout affordance in the app only ever signed out
  // the current session, one at a time. A user who suspects their account is
  // compromised needs to kill every OTHER session in one action.
  const handleRevokeAll = useCallback(async () => {
    setRevokingAll(true)
    try {
      const result = await revokeAllOtherSessions()
      setSessions((prev) => prev.filter((s) => s.is_current))
      const n = result.revoked
      showToast({ icon: 'check', title: `Signed out of ${n} other ${n === 1 ? 'session' : 'sessions'}` })
    } catch {
      showToast({ icon: 'x', title: 'Failed to sign out other sessions', danger: true })
    } finally {
      setRevokingAll(false)
    }
  }, [showToast])

  const otherSessionsCount = sessions.filter((s) => !s.is_current).length

  return (
    <SettingsRow
      label="Devices & sessions"
      hint="Every device holding an active session."
    >
      <div className="flex flex-col gap-2 max-w-[480px]">
        {!sessionsLoading && otherSessionsCount > 0 && (
          <div className="flex justify-end mb-0.5">
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => void handleRevokeAll()}
              disabled={revokingAll}
              className="text-ink-3 hover:text-red"
            >
              {revokingAll ? (
                <>
                  <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin mr-1.5 inline-block" />
                  Signing out…
                </>
              ) : 'Sign out everywhere'}
            </BBButton>
          </div>
        )}
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
                  <Icon name={sessionDeviceIcon(s.device_kind)} size={11} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <span className="truncate">{s.device_name}</span>
                    {s.is_current && <BBChip variant="amber">Current</BBChip>}
                  </div>
                  <div className="text-[11px] font-mono text-ink-3">
                    {timeAgoLabel(s.last_active_at ?? s.created_at)}
                    {s.country_code && <> · {s.country_code}</>}
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
      <VaultTimeoutSection />
      <PasskeysSection />
      <TotpSection />
      <DevicesSessionsSection />
    </SettingsShell>
  )
}
