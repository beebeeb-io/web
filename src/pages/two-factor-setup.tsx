import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { Icon } from '../components/icons'
import { enable2fa, setup2fa } from '../lib/api'

export function TwoFactorSetup() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [secret, setSecret] = useState('')
  const [qrUri, setQrUri] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])

  // 6-digit code input
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setup2fa()
      .then((data) => {
        setSecret(data.secret)
        setQrUri(data.qr_uri)
        setBackupCodes(data.backup_codes)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to set up 2FA')
      })
      .finally(() => setLoading(false))
  }, [])

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      const char = value.replace(/\D/g, '').slice(-1)
      const next = [...digits]
      next[index] = char
      setDigits(next)
      setError('')

      if (char && index < 5) {
        inputRefs.current[index + 1]?.focus()
      }
    },
    [digits],
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
    },
    [digits],
  )

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 0) return
    const next = [...Array(6)].map((_, i) => text[i] ?? '')
    setDigits(next)
    setError('')
    if (text.length < 6) {
      inputRefs.current[text.length]?.focus()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const code = digits.join('')
    if (code.length !== 6) return

    setSubmitting(true)
    setError('')
    try {
      await enable2fa(code)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  // Success: show backup codes
  if (success) {
    return (
      <AuthShell
        title="2FA enabled"
        subtitle="Save these backup codes somewhere safe. Each can be used once if you lose your authenticator."
        step={3}
        totalSteps={3}
      >
        <div className="grid grid-cols-2 gap-2 mb-5">
          {backupCodes.map((code) => (
            <div
              key={code}
              className="font-mono text-sm text-center py-2 px-3 bg-paper-2 border border-line rounded-md tracking-widest"
            >
              {code}
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-amber-bg border border-amber/20 rounded-md">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-xs text-ink-2 leading-relaxed">
            Store these codes in a password manager or print them. They will not be shown again.
          </p>
        </div>
        <BBButton
          variant="amber"
          size="lg"
          className="w-full"
          onClick={() => navigate('/security')}
        >
          Done
        </BBButton>
      </AuthShell>
    )
  }

  if (loading) {
    return (
      <AuthShell title="Set up two-factor" step={1} totalSteps={3}>
        <p className="text-sm text-ink-3">Loading...</p>
      </AuthShell>
    )
  }

  // Format the secret for display: groups of 4
  const secretFormatted = secret.replace(/(.{4})/g, '$1 ').trim()

  return (
    <AuthShell
      title="Set up two-factor"
      subtitle="Scan with your authenticator app, then enter the 6-digit code."
      step={1}
      totalSteps={3}
    >
      <div className="grid gap-4.5" style={{ gridTemplateColumns: '160px 1fr' }}>
        {/* QR code */}
        <div className="bg-paper p-2.5 border border-line-2 rounded-md flex items-center justify-center">
          {qrUri ? (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(qrUri)}`}
              alt="Scan this QR code with your authenticator app"
              width={140}
              height={140}
              className="rounded"
            />
          ) : (
            <div className="w-[140px] h-[140px] bg-paper-2 rounded" />
          )}
        </div>

        {/* Manual entry + recommendations */}
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">
            Or enter manually
          </label>
          <div
            className="font-mono text-xs font-medium px-2.5 py-2 bg-paper-2 border border-line rounded-md mb-3 leading-relaxed select-all"
            style={{ wordBreak: 'break-all' }}
          >
            {secretFormatted}
          </div>
          <p className="text-[11px] text-ink-3 leading-relaxed">
            Recommended: <strong>Aegis</strong> (Android),{' '}
            <strong>Raivo</strong> (iOS), <strong>1Password</strong>.
          </p>
        </div>
      </div>

      <div className="border-t border-line my-5" />

      {/* Code input */}
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-ink-2 mb-1.5">
          Enter 6-digit code
        </label>
        <div className="flex gap-2 mb-3" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={submitting}
              className={`w-full h-10 text-center font-mono text-base font-semibold border rounded-md bg-paper outline-none transition-all ${
                d ? 'border-line-2 text-ink' : 'border-line text-ink-4'
              } focus:border-amber-deep focus:ring-2 focus:ring-amber/30`}
              style={{ letterSpacing: '0.15em' }}
            />
          ))}
        </div>

        {error && <p className="text-xs text-red mb-3">{error}</p>}

        <div className="flex gap-2.5 mt-2">
          <BBButton
            type="button"
            variant="default"
            className="flex-1"
            onClick={() => navigate(-1)}
          >
            Skip for now
          </BBButton>
          <BBButton
            type="submit"
            variant="amber"
            className="flex-1"
            disabled={submitting || digits.some((d) => !d)}
          >
            {submitting ? 'Verifying...' : 'Enable 2FA'}
          </BBButton>
        </div>
      </form>
    </AuthShell>
  )
}
