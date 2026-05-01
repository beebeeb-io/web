import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { useAuth } from '../lib/auth-context'
import { verifyEmail, resendVerification, ApiError } from '../lib/api'

const CODE_LENGTH = 6
const RESEND_SECONDS = 60

export function VerifyEmail() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(RESEND_SECONDS)
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus first input on mount
  useEffect(() => {
    inputsRef.current[0]?.focus()
  }, [])

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCountdown])

  const isFilled = digits.every((d) => d !== '')

  const updateDigit = useCallback(
    (index: number, value: string) => {
      const next = [...digits]
      next[index] = value
      setDigits(next)
      setError('')
    },
    [digits],
  )

  function handleInput(index: number, value: string) {
    // Only accept single digit
    const char = value.replace(/\D/g, '').slice(-1)
    updateDigit(index, char)
    if (char && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        updateDigit(index, '')
      } else if (index > 0) {
        updateDigit(index - 1, '')
        inputsRef.current[index - 1]?.focus()
      }
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (pasted.length === 0) return
    const next = [...digits]
    for (let i = 0; i < CODE_LENGTH; i++) {
      next[i] = pasted[i] || ''
    }
    setDigits(next)
    setError('')
    // Focus the last filled input or the next empty one
    const focusIndex = Math.min(pasted.length, CODE_LENGTH - 1)
    inputsRef.current[focusIndex]?.focus()
  }

  async function handleSubmit() {
    if (!isFilled || submitting) return
    setError('')
    setSubmitting(true)
    try {
      const code = digits.join('')
      await verifyEmail(code)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
      // Clear digits so user can re-enter
      setDigits(Array(CODE_LENGTH).fill(''))
      inputsRef.current[0]?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    if (resendCountdown > 0) return
    try {
      await resendVerification()
      setResendCountdown(RESEND_SECONDS)
      setError('')
    } catch (err) {
      // 429 surfaces the server's rate-limit message ("Too many verification
      // emails. Please try again later."). Anything else surfaces verbatim.
      if (err instanceof ApiError && err.status === 429) {
        setResendCountdown(RESEND_SECONDS)
      }
      setError(err instanceof Error ? err.message : 'Failed to resend verification email')
    }
  }

  const subtitle = user?.email
    ? `We sent a verification code to ${user.email}. Enter it below.`
    : 'We sent a verification code to your email. Enter it below.'

  return (
    <AuthShell title="Check your inbox" subtitle={subtitle}>
      {/* Digit inputs */}
      <div className="flex gap-2 mb-3.5 justify-center">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            onChange={(e) => handleInput(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className="w-[44px] h-[52px] text-center font-mono text-2xl font-semibold border-[1.5px] rounded-md bg-paper text-ink outline-none transition-all border-line-2 focus:border-amber-deep focus:shadow-[0_0_0_2px_var(--amber-bg)]"
            aria-label={`Digit ${i + 1}`}
          />
        ))}
      </div>

      {error && <p className="text-xs text-red mb-3 text-center">{error}</p>}

      <BBButton
        variant="amber"
        size="lg"
        className="w-full"
        disabled={!isFilled || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Verifying...' : 'Verify email'}
      </BBButton>

      {/* Resend row */}
      <div className="flex items-center justify-between mt-4 text-[11.5px]">
        <span className="text-ink-3">Didn't receive it?</span>
        {resendCountdown > 0 ? (
          <span className="text-amber-deep font-medium font-mono">
            Resend in {resendCountdown}s
          </span>
        ) : (
          <button
            type="button"
            className="text-amber-deep font-medium cursor-pointer hover:underline"
            onClick={handleResend}
          >
            Resend code
          </button>
        )}
      </div>
    </AuthShell>
  )
}
