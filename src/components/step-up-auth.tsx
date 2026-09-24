import { useCallback, useEffect, useState } from 'react'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { useFocusTrap } from '../hooks/use-focus-trap'
import {
  confirmAction,
  confirmPasskey,
  IncorrectPasswordError,
  SessionTooOldForConfirmationError,
} from '../lib/api'
import { useToast } from './toast'

// True when the browser implements the WebAuthn API at all (matches the
// existing `showPasskeyLogin`/`canUsePasskey` checks in login.tsx,
// vault-unlock.tsx and device-provision.tsx). Passkey-only accounts have no
// password to type here, so this modal must offer the passkey path — not
// just password accounts that happen to also hold a passkey.
const webauthnSupported = typeof window !== 'undefined' && !!window.PublicKeyCredential

interface StepUpAuthProps {
  open: boolean
  onConfirmed: (token: string) => void
  onClose: () => void
  onCancel?: () => void
  description?: string
  submitLabel?: string
}

export function StepUpAuth({
  open,
  onConfirmed,
  onClose,
  onCancel,
  description = 'Enter your password to continue.',
  submitLabel = 'Confirm',
}: StepUpAuthProps) {
  const [mode, setMode] = useState<'password' | 'passkey'>('password')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

  const close = useCallback(() => {
    ;(onCancel ?? onClose)()
  }, [onCancel, onClose])

  useEffect(() => {
    if (!open) return
    setMode('password')
    setPassword('')
    setError(null)
    setLoading(false)
  }, [open])

  const handleSubmit = useCallback(async () => {
    if (!password || loading) return
    setLoading(true)
    setError(null)
    try {
      const { confirmation_token } = await confirmAction(password)
      onConfirmed(confirmation_token)
    } catch (err) {
      if (err instanceof SessionTooOldForConfirmationError) {
        showToast({
          icon: 'shield',
          title: 'Please log out and back in',
          description: 'For security, this action requires a fresh login.',
        })
        close()
      } else if (err instanceof IncorrectPasswordError) {
        setError('Incorrect password')
      } else {
        setError(err instanceof Error ? err.message : 'Could not confirm your identity')
      }
    } finally {
      setLoading(false)
    }
  }, [close, loading, onConfirmed, password, showToast])

  // Passkey-assertion step-up (task 1493) — the only path available to a
  // passkey-only account (no password/OPAQUE credential exists to type
  // here), and offered to every account as an alternative to typing a
  // password. Runs `confirmPasskey()` (a fresh WebAuthn assertion against
  // the caller's OWN passkeys) and hands the resulting X-Confirm-Token to
  // the same `onConfirmed` callback the password path uses — callers never
  // need to know which method produced the token.
  const handlePasskeySubmit = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const { confirmation_token } = await confirmPasskey()
      onConfirmed(confirmation_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm your identity')
    } finally {
      setLoading(false)
    }
  }, [loading, onConfirmed])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (mode === 'password') void handleSubmit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    },
    [close, handleSubmit, mode],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={close}>
      <div className="absolute inset-0 bg-ink/20" />

      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm your identity"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-[420px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="lock" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Confirm your identity</span>
            <button
              onClick={close}
              aria-label="Close"
              className="ml-auto text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        <div className="p-xl">
          <p className="text-[12.5px] text-ink-2 leading-relaxed mb-md">{description}</p>

          {mode === 'password' ? (
            <>
              <BBInput
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                autoFocus
                error={error ?? undefined}
                className="mb-lg"
              />

              <div className="flex items-center justify-between gap-3">
                {webauthnSupported ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('passkey')
                      setError(null)
                    }}
                    disabled={loading}
                    className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Use a passkey instead
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <BBButton size="md" onClick={close} disabled={loading}>
                    Cancel
                  </BBButton>
                  <BBButton
                    size="md"
                    variant="amber"
                    onClick={handleSubmit}
                    disabled={!password || loading}
                  >
                    {loading ? 'Confirming...' : submitLabel}
                  </BBButton>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5 rounded-md border border-line bg-paper-2 px-3 py-2.5 mb-lg">
                <Icon name="shield" size={14} className="text-ink-3 shrink-0" />
                <p className="text-[12px] text-ink-2 leading-relaxed">
                  Your browser will ask you to confirm with Touch ID, Face ID, Windows Hello, or a
                  security key.
                </p>
              </div>
              {error && (
                <p className="text-[12px] text-red mb-md" role="alert">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('password')
                    setError(null)
                  }}
                  disabled={loading}
                  className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                >
                  Use your password instead
                </button>
                <div className="flex gap-2">
                  <BBButton size="md" onClick={close} disabled={loading}>
                    Cancel
                  </BBButton>
                  <BBButton
                    size="md"
                    variant="amber"
                    onClick={handlePasskeySubmit}
                    disabled={loading}
                  >
                    {loading ? 'Confirming...' : 'Confirm with passkey'}
                  </BBButton>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
