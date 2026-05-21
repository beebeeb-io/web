import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface TwoFactorPromptProps {
  onVerify: (code: string) => Promise<void>
  onCancel?: () => void
  error?: string
}

export function TwoFactorPrompt({
  onVerify,
  onCancel,
  error: externalError,
}: TwoFactorPromptProps) {
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (externalError) setError(externalError)
  }, [externalError])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleCodeChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    setError('')

    if (digits.length === 6) {
      void submitCode(digits)
    }
  }, [])

  async function submitCode(c: string) {
    setSubmitting(true)
    setError('')
    try {
      await onVerify(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      setCode('')
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBackupSubmit(e: FormEvent) {
    e.preventDefault()
    if (!backupCode.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await onVerify(backupCode.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup code')
    } finally {
      setSubmitting(false)
    }
  }

  if (useBackup) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            className="text-ink-3 hover:text-ink transition-colors cursor-pointer"
            onClick={() => {
              setUseBackup(false)
              setError('')
            }}
          >
            <Icon name="chevron-right" size={16} className="rotate-180" />
          </button>
          <h3 className="text-base font-semibold text-ink">
            Enter backup code
          </h3>
        </div>
        <p className="text-[13px] text-ink-3 leading-relaxed mb-4">
          Enter one of the 8-digit backup codes you saved when enabling 2FA.
        </p>
        <form onSubmit={handleBackupSubmit}>
          <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 mb-3 focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
            <input
              type="text"
              value={backupCode}
              onChange={(e) => {
                setBackupCode(e.target.value)
                setError('')
              }}
              placeholder="12345678"
              className="flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-4 tracking-widest"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-red mb-3">{error}</p>}
          <BBButton
            type="submit"
            variant="amber"
            size="lg"
            className="w-full"
            disabled={submitting || !backupCode.trim()}
          >
            {submitting ? 'Verifying...' : 'Verify backup code'}
          </BBButton>
        </form>
      </div>
    )
  }

  const digits = code.padEnd(6, ' ').split('')

  return (
    <div>
      <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
        Enter the 6-digit code from your authenticator app.
      </p>

      {/* Single input for password manager autofill — visually hidden behind the digit boxes */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          maxLength={6}
          disabled={submitting}
          className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-text"
          aria-label="6-digit verification code"
        />

        {/* Visual digit boxes */}
        <div className="flex gap-2 justify-center mb-3.5 pointer-events-none" aria-hidden="true">
          {digits.map((d, i) => (
            <div
              key={i}
              className={`w-11 h-[52px] flex items-center justify-center font-mono text-2xl font-semibold border rounded-md bg-paper transition-all ${
                d.trim()
                  ? 'border-line-2 text-ink'
                  : i === code.length
                    ? 'border-amber-deep ring-2 ring-amber/30 text-ink-4'
                    : 'border-line text-ink-4'
              }`}
            >
              {d.trim() || ''}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red mb-3 text-center">{error}</p>}

      {submitting && (
        <p className="text-xs text-ink-3 text-center mb-3">Verifying...</p>
      )}

      <div className="flex items-center justify-between mt-5">
        {onCancel && (
          <button
            type="button"
            className="text-xs text-ink-3 hover:text-ink cursor-pointer transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="text-xs text-amber-deep font-medium hover:underline cursor-pointer ml-auto"
          onClick={() => {
            setUseBackup(true)
            setError('')
          }}
        >
          Use backup code
        </button>
      </div>
    </div>
  )
}
