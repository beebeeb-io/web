// Second-factor code for deleting an account that has 2FA: a 6-digit authenticator code or an
// 8-digit backup code, asked after the password step-up.
import { useEffect, useState } from 'react'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { isPlausibleSecondFactorCode } from '../lib/delete-second-factor'

interface DeleteCodePromptProps {
  open: boolean
  busy: boolean
  /** The server's refusal of the last code, shown under the field; null when there is none. */
  error: string | null
  onSubmit: (code: string) => void
  onClose: () => void
}

export function DeleteCodePrompt({ open, busy, error, onSubmit, onClose }: DeleteCodePromptProps) {
  const [code, setCode] = useState('')
  const trapRef = useFocusTrap<HTMLDivElement>(open)

  useEffect(() => {
    if (open) setCode('')
  }, [open])

  if (!open) return null
  const ready = isPlausibleSecondFactorCode(code) && !busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/20" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Enter your two-factor code"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && ready) {
            event.preventDefault()
            onSubmit(code.trim())
          }
        }}
        className="relative w-full max-w-[420px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="shield" size={14} className="text-ink" />
            <span className="text-sm font-semibold text-ink">Two-factor code</span>
          </div>
        </div>
        <div className="p-xl">
          <p className="text-[12.5px] text-ink-2 leading-relaxed mb-md">
            Enter the 6-digit code from your authenticator app, or an 8-digit backup code. A backup
            code works once.
          </p>
          <BBInput
            label="Code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            error={error ?? undefined}
            className="mb-lg font-mono"
          />
          <div className="flex justify-end gap-2">
            <BBButton size="md" onClick={onClose} disabled={busy}>
              Cancel
            </BBButton>
            <BBButton
              size="md"
              variant="danger"
              onClick={() => onSubmit(code.trim())}
              disabled={!ready}
            >
              {busy ? 'Deleting...' : 'Delete account'}
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
