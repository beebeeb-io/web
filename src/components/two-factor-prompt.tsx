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

  // Watch for password manager autofill via native input events
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    function onInput() {
      const digits = (el!.value ?? '').replace(/\D/g, '').slice(0, 6)
      setCode(digits)
      setError('')
      if (digits.length === 6) {
        void submitCode(digits)
      }
    }
    el.addEventListener('input', onInput)
    return () => el.removeEventListener('input', onInput)
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
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

  return (
    <div>
      <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
        Enter the 6-digit code from your authenticator app.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) void submitCode(code) }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          name="totp-code"
          id="totp-code"
          value={code}
          onChange={handleChange}
          maxLength={6}
          placeholder="000000"
          disabled={submitting}
          className="w-full text-center font-mono text-3xl font-semibold tracking-[0.5em] border border-line rounded-lg bg-paper px-4 py-3 outline-none transition-all focus:border-amber-deep focus:ring-2 focus:ring-amber/30 placeholder:text-ink-4/30 mb-3.5"
          aria-label="6-digit verification code"
        />
      </form>

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
