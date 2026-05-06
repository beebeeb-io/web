/**
 * ConfirmationModal — shared destructive-action modal for the lifecycle wizard.
 *
 * User must type `confirmationText` exactly before the confirm button enables.
 * `variant='danger'` renders a red confirm button; `variant='warning'` uses amber.
 */

import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { BBButton } from '@beebeeb/shared'

interface ConfirmationModalProps {
  open: boolean
  title: string
  description: string | ReactNode
  /**
   * When provided: user must type this string exactly before the confirm
   * button enables. Use for destructive terminal actions (delete pool).
   * When omitted: no text input shown, confirm button is immediately enabled.
   */
  confirmationText?: string
  confirmLabel: string
  variant: 'danger' | 'warning'
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}

export function ConfirmationModal({
  open,
  title,
  description,
  confirmationText,
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
  loading,
}: ConfirmationModalProps) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset input whenever the modal opens or the confirmation text changes.
  useEffect(() => {
    if (open) {
      setTyped('')
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, confirmationText])

  if (!open) return null

  // No confirmationText = no type-to-confirm required (non-terminal actions).
  const confirmed = confirmationText ? typed === confirmationText : true
  const btnVariant = variant === 'danger' ? 'danger' : 'amber'

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      onClick={onCancel}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/30" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[26rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-line">
          <h3
            id="confirm-modal-title"
            className="text-sm font-semibold text-ink"
          >
            {title}
          </h3>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {typeof description === 'string' ? (
            <p className="text-sm text-ink-2 leading-relaxed">{description}</p>
          ) : (
            <div className="text-sm text-ink-2 leading-relaxed">{description}</div>
          )}

          {/* Type-to-confirm input — only shown when confirmationText is set */}
          {confirmationText && (
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">
                Type{' '}
                <span className="font-mono font-semibold text-ink px-1 py-0.5 bg-paper-2 rounded">
                  {confirmationText}
                </span>{' '}
                to confirm
              </label>
              <input
                ref={inputRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && confirmed && !loading) onConfirm()
                }}
                disabled={loading}
                className="w-full bg-paper border border-line rounded-md px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep disabled:opacity-50"
                placeholder={confirmationText}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex justify-end gap-2.5">
          <BBButton variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </BBButton>
          <BBButton
            variant={btnVariant}
            onClick={onConfirm}
            disabled={!confirmed || loading}
          >
            {loading ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </BBButton>
        </div>
      </div>
    </div>
  )
}
