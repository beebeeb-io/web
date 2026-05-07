import { useState, useCallback, useEffect } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import {
  confirmAction,
  IncorrectPasswordError,
  SessionTooOldForConfirmationError,
} from '../lib/api'
import { useToast } from './toast'

interface ConfirmPasswordModalProps {
  open: boolean
  title?: string
  description?: string
  confirmLabel?: string
  /**
   * Called with the short-lived confirmation token after successful re-auth.
   * The verified password is also provided so callers that need to perform
   * multiple destructive operations can mint additional single-use tokens
   * via confirmAction(password) without re-prompting the user.
   */
  onConfirmed: (token: string, password: string) => void
  onCancel: () => void
}

export function ConfirmPasswordModal({
  open,
  title = 'Confirm it’s you',
  description = 'Re-enter your password to authorise this action.',
  confirmLabel = 'Confirm',
  onConfirmed,
  onCancel,
}: ConfirmPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

  useEffect(() => {
    if (open) {
      setPassword('')
      setError(null)
      setLoading(false)
    }
  }, [open])

  const handleSubmit = useCallback(async () => {
    if (password.length === 0 || loading) return
    setLoading(true)
    setError(null)
    try {
      const { confirmation_token } = await confirmAction(password)
      onConfirmed(confirmation_token, password)
    } catch (e) {
      if (e instanceof SessionTooOldForConfirmationError) {
        // Re-typing the password cannot fix this — the session itself is too
        // old. Close the modal and surface a toast directing the user to
        // log out and back in.
        showToast({
          icon: 'shield',
          title: 'Please log out and back in',
          description:
            'For security, this action requires a fresh login. Your data is safe.',
        })
        onCancel()
        return
      }
      if (e instanceof IncorrectPasswordError) {
        setError('Incorrect password.')
      } else {
        setError(e instanceof Error ? e.message : 'Could not confirm. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [password, loading, onConfirmed, onCancel, showToast])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-ink/20" />

      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-[420px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="lock" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">{title}</span>
            <button
              onClick={onCancel}
              aria-label="Close"
              className="ml-auto text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        <div className="p-xl">
          <p className="text-[12.5px] text-ink-2 leading-relaxed mb-md">{description}</p>

          <BBInput
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            autoFocus
            error={error ?? undefined}
            className="mb-lg"
          />

          <div className="flex gap-2 justify-end">
            <BBButton size="md" onClick={onCancel} disabled={loading}>
              Cancel
            </BBButton>
            <BBButton
              size="md"
              variant="amber"
              onClick={handleSubmit}
              disabled={password.length === 0 || loading}
            >
              {loading ? 'Confirming…' : confirmLabel}
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
