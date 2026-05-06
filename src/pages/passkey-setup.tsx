import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  listPasskeys,
  deletePasskey,
  serverOptsToCreateOptions,
  credentialToRegistrationJSON,
  type PasskeyInfo,
} from '../lib/api'

// ─── Device detection ──────────────────────────────

interface DeviceInfo {
  name: string
  detail: string
  authMethod: string
}

function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''

  let name = 'This device'
  let detail = 'Browser'
  let authMethod = 'biometrics'

  if (/Macintosh|MacIntel|MacPPC|Mac OS/.test(ua) || platform.startsWith('Mac')) {
    name = /MacBook/.test(ua) ? 'MacBook Pro' : 'Mac'
    detail = 'Touch ID'
    authMethod = 'Touch ID'

    // Extract macOS version
    const macVer = ua.match(/Mac OS X (\d+[._]\d+)/)
    if (macVer) {
      const ver = macVer[1].replace('_', '.')
      detail = `Touch ID`
      name = `${name} · ${detail}`
      detail = `${/Safari/.test(ua) ? 'Safari' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : 'Browser'} · macOS ${ver} · detected`
    }
  } else if (/Win/.test(platform)) {
    name = 'Windows · Hello'
    detail = 'Windows Hello'
    authMethod = 'Windows Hello'
  } else if (/iPhone|iPad/.test(ua)) {
    name = 'iPhone · Face ID'
    detail = 'iOS Safari · detected'
    authMethod = 'Face ID'
  } else if (/Android/.test(ua)) {
    name = 'Android · Biometrics'
    detail = 'Chrome · detected'
    authMethod = 'biometrics'
  } else if (/Linux/.test(platform)) {
    name = 'Linux · Security key'
    detail = 'Browser · detected'
    authMethod = 'security key'
  }

  return { name, detail, authMethod }
}

// ─── Component ────────────────────────────────────

export function PasskeySetup() {
  const navigate = useNavigate()
  const [device] = useState(detectDevice)
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([])
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadPasskeys()
  }, [])

  async function loadPasskeys() {
    try {
      const keys = await listPasskeys()
      setPasskeys(keys)
    } catch (err) {
      console.error('[Passkeys] Failed to load passkeys:', err)
    }
  }

  async function handleRegister() {
    setError('')
    setSuccess('')
    setRegistering(true)

    try {
      // Step 1: Get challenge from server (binary fields are base64url strings)
      const startRes = await startPasskeyRegistration()

      // Step 2: Convert server options to browser-compatible format
      // (base64url strings → ArrayBuffers for challenge, user.id, excludeCredentials[].id)
      const createOptions = serverOptsToCreateOptions(startRes.publicKey)

      // Step 3: Call WebAuthn API with converted options
      const credential = await navigator.credentials.create({
        publicKey: createOptions,
      }) as PublicKeyCredential | null

      if (!credential) {
        setError('Passkey creation was cancelled')
        setRegistering(false)
        return
      }

      // Step 4: Convert credential response to JSON for webauthn-rs
      // (ArrayBuffers → base64url strings)
      const credentialData = credentialToRegistrationJSON(credential)

      // Step 5: Send to server to complete registration
      await finishPasskeyRegistration(credentialData, startRes.reg_state, device.name)
      setSuccess('Passkey created successfully')
      loadPasskeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create passkey')
    } finally {
      setRegistering(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePasskey(id)
      setPasskeys((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove passkey')
    }
  }

  return (
    <SettingsShell activeSection="account">
      <SettingsHeader
        title="Passkeys"
        subtitle="Faster sign-in. Tied to this device's secure enclave. Replaces your password on trusted devices."
      />

      <div className="p-7">
        {/* Device detection card */}
        <div className="p-[18px] bg-paper-2 rounded-md border border-line mb-3.5">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0"
              style={{
                background: 'var(--color-amber-bg)',
                border: '1px solid oklch(0.86 0.07 90)',
              }}
            >
              <Icon name="key" size={20} className="text-amber-deep" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">{device.name}</div>
              <div className="text-[11px] text-ink-3 mt-0.5">{device.detail}</div>
            </div>
          </div>
        </div>

        {/* Info box */}
        <div
          className="p-3.5 rounded-md flex gap-3 mb-[18px]"
          style={{ border: '1px dashed var(--color-line-2)' }}
        >
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-xs text-ink-2 leading-relaxed">
            Your passkey never leaves this device. Beebeeb only sees its public half — not enough to impersonate you.
          </p>
        </div>

        {/* Register button */}
        <BBButton
          variant="amber"
          size="lg"
          className="w-full gap-2"
          onClick={handleRegister}
          disabled={registering}
        >
          <Icon name="key" size={13} />
          {registering ? 'Waiting for device...' : `Create passkey with ${device.authMethod}`}
        </BBButton>

        {error && (
          <p className="text-xs text-red mt-3">{error}</p>
        )}

        {success && (
          <p className="text-xs text-green mt-3">{success}</p>
        )}

        <div className="text-center mt-3.5">
          <button
            onClick={() => navigate(-1)}
            className="text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors cursor-pointer"
          >
            Not now
          </button>
        </div>

        {/* Existing passkeys */}
        {passkeys.length > 0 && (
          <div className="mt-8 border-t border-line pt-5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-3">
              Registered passkeys
            </div>
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                className="flex items-center gap-3 py-3 border-b border-line last:border-b-0"
              >
                <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center">
                  <Icon name="key" size={13} className="text-ink-2" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink flex items-center gap-2">
                    {pk.name}
                    <BBChip variant="green" className="text-[9.5px]">Active</BBChip>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5 font-mono">
                    Created {new Date(pk.created_at).toLocaleDateString()}
                  </div>
                </div>
                <BBButton
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(pk.id)}
                >
                  Remove
                </BBButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsShell>
  )
}

