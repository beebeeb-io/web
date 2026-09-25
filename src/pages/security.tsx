import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader, SettingsRow } from '../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from '../components/toast'
import { ChangePasswordDialog } from '../components/change-password-dialog'
import { StepUpAuth } from '../components/step-up-auth'
import { useKeys } from '../lib/key-context'
import {
  listSessions, revokeSession,
  listPasskeys, deletePasskey,
  setup2fa, enable2fa, disable2fa,
  getPreference,
  type Session, type PasskeyInfo,
} from '../lib/api'
import { removeVaultWrapKey } from '../lib/passkey-vault'
import { useAddPasskeyFlow } from '../hooks/use-add-passkey-flow'
import QRCode from 'qrcode'

/* ── Recovery phrase ────────────────────────────── */

function RecoveryPhraseSection() {
  return (
    <SettingsRow
      label="Recovery phrase"
      hint="Your 12-word recovery phrase was shown once during signup. We cannot display it again."
    >
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-ink-2 leading-relaxed max-w-[420px]">
          If you saved your recovery phrase during account creation, keep it stored
          safely. It is the only way to recover your vault if you lose access to all
          your devices.
        </p>
        <p className="text-[12.5px] text-ink-3 leading-relaxed max-w-[420px]">
          We cannot retrieve, reset, or regenerate your recovery phrase.
          This is by design — zero-knowledge means only you have access.
        </p>
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
  // shared with passkey-setup.tsx and settings/security.tsx.
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
// it works)". The add-device-via-QR panel (this used to be `AddDevicePanel`,
// generating a QR + 6-digit code for a new device to scan) is hidden
// entirely — not deleted. The underlying src/lib/qr-crypto.ts module
// (encryptForQr/generateCode) and the scanning half in device-provision.tsx
// are both left in place, just unreferenced from any UI entry point.
//
// NOTE: this whole page (src/pages/security.tsx) is unrouted dead code —
// app.tsx redirects /security → /settings/security and never imports this
// module. Edited anyway per the 1528/1529 brief's explicit file:line
// reference; see the lane report for the grep proof.

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
          <Link to="/settings/profile" className="text-xs text-amber-deep hover:underline">
            Change
          </Link>
        </div>
      ) : (
        <Link to="/settings/profile" className="text-sm text-amber-deep hover:underline">
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
