import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BBButton } from './bb-button'
import { Icon } from './icons'

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
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [useBackup, setUseBackup] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (externalError) setError(externalError)
  }, [externalError])

  // Auto-submit when all 6 digits are entered
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

      // Auto-submit when all filled
      if (char && next.every((d) => d !== '')) {
        const code = next.join('')
        void submitCode(code)
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

    if (text.length === 6) {
      void submitCode(text)
    } else {
      inputRefs.current[text.length]?.focus()
    }
  }, [])

  async function submitCode(code: string) {
    setSubmitting(true)
    setError('')
    try {
      await onVerify(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
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

      {/* 6-digit code input */}
      <div className="flex gap-2 justify-center mb-3.5" onPaste={handlePaste}>
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
            autoFocus={i === 0}
            disabled={submitting}
            className={`w-11 h-[52px] text-center font-mono text-2xl font-semibold border rounded-md bg-paper outline-none transition-all ${
              d
                ? 'border-line-2 text-ink'
                : 'border-line text-ink-4'
            } focus:border-amber-deep focus:ring-2 focus:ring-amber/30`}
          />
        ))}
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
