import { useState, useCallback, useEffect } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from './bb-button'
import { BBInput } from './bb-input'
import { Icon } from './icons'
import { changePassword as apiChangePassword, confirmAction, ApiError } from '../lib/api'

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
  onSuccess?: (newSessionToken: string) => void
}

interface PasswordStrength {
  score: number // 0–4
  label: string
  color: string
}

function evaluateStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return { score: 0, label: '', color: 'var(--color-line)' }
  let score = 0
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++

  const labels = ['Weak', 'Fair', 'Good', 'Strong']
  const colors = ['var(--color-red)', 'oklch(0.65 0.14 55)', 'oklch(0.55 0.12 155)', 'oklch(0.45 0.12 155)']
  const idx = Math.min(score, 3)
  return { score: score + 1, label: labels[idx], color: colors[idx] }
}

export function ChangePasswordDialog({ open, onClose, onSuccess }: ChangePasswordDialogProps) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)

  // Reset on open
  useEffect(() => {
    if (open) {
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setError(null)
      setLoading(false)
    }
  }, [open])

  const strength = evaluateStrength(newPw)
  const mismatch = confirmPw.length > 0 && newPw !== confirmPw
  const canSubmit =
    currentPw.length > 0 &&
    newPw.length >= 12 &&
    newPw === confirmPw &&
    !loading

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      // Step-up re-auth: exchange current password for a confirmation token,
      // then send it on the change-password call. setToken() inside
      // apiChangePassword keeps us logged in on this device.
      const { confirmation_token } = await confirmAction(currentPw)
      const result = await apiChangePassword(currentPw, newPw, confirmation_token)
      onSuccess?.(result.session_token)
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('Current password is incorrect.')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to change password')
      }
    } finally {
      setLoading(false)
    }
  }, [canSubmit, currentPw, newPw, onClose, onSuccess])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Dialog */}
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="lock" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Change password</span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-auto text-ink-3 hover:text-ink transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-xl">
          {/* Warning */}
          <div className="flex items-start gap-2.5 px-3 py-2.5 mb-lg rounded-md bg-amber-bg border border-amber-deep/20">
            <Icon name="shield" size={12} className="text-amber-deep mt-0.5 shrink-0" />
            <p className="text-[12px] text-ink-2 leading-relaxed">
              This will invalidate all other sessions. You will stay logged in on this device only.
            </p>
          </div>

          {/* Current password */}
          <BBInput
            label="Current password"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Enter current password"
            className="mb-md"
          />

          {/* New password */}
          <BBInput
            label="New password"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="At least 12 characters"
            hint={newPw.length > 0 && newPw.length < 12 ? 'Must be at least 12 characters' : undefined}
            error={newPw.length > 0 && newPw.length < 12 ? 'Too short' : undefined}
            className="mb-1"
          />

          {/* Strength meter */}
          {newPw.length > 0 && (
            <div className="mb-md">
              <div className="flex gap-1 mt-2">
                {[1, 2, 3, 4].map((seg) => (
                  <div
                    key={seg}
                    className="flex-1 h-[3px] rounded-sm transition-colors"
                    style={{
                      background: seg <= strength.score ? strength.color : 'var(--color-paper-3)',
                    }}
                  />
                ))}
              </div>
              <div className="text-[11px] mt-1" style={{ color: strength.color }}>
                {strength.label} {newPw.length > 0 && <span className="text-ink-4">-- {newPw.length} chars</span>}
              </div>
            </div>
          )}

          {/* Confirm new password */}
          <BBInput
            label="Confirm new password"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Re-enter new password"
            error={mismatch ? 'Passwords do not match' : undefined}
            className="mb-lg"
          />

          {/* Error */}
          {error && (
            <div className="mb-md px-3 py-2 bg-red/10 border border-red/20 rounded-md text-xs text-red">
              {error}
            </div>
          )}

          {/* Submit */}
          <BBButton
            variant="amber"
            size="lg"
            className="w-full justify-center"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {loading ? 'Changing...' : 'Change password'}
          </BBButton>
        </div>
      </div>
    </div>
  )
}
