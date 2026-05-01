import { useState, useEffect, useRef } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from './bb-button'
import { Icon } from './icons'
import { reportShareLink } from '../lib/api'
import { useToast } from './toast'

interface ReportDialogProps {
  open: boolean
  onClose: () => void
  shareToken: string
}

const PRESETS = [
  'Malware',
  'Copyright violation',
  'Illegal content',
  'Spam',
  'Other',
]

export function ReportDialog({ open, onClose, shareToken }: ReportDialogProps) {
  const [reason, setReason] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setReason('')
      setSelectedPreset(null)
      setSubmitting(false)
      setSubmitted(false)
    }
  }, [open])

  // Focus textarea when dialog opens
  useEffect(() => {
    if (open && !submitted) {
      const t = setTimeout(() => textareaRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, submitted])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const fullReason = selectedPreset
    ? selectedPreset === 'Other'
      ? reason.trim()
      : reason.trim()
        ? `${selectedPreset}: ${reason.trim()}`
        : selectedPreset
    : reason.trim()

  const isValid = fullReason.length >= 10 && fullReason.length <= 2000

  const handleSubmit = async () => {
    if (!isValid || submitting) return
    setSubmitting(true)
    try {
      await reportShareLink(shareToken, fullReason)
      setSubmitted(true)
    } catch (e) {
      showToast({
        icon: 'x',
        title: 'Failed to submit report',
        description: e instanceof Error ? e.message : 'Please try again later.',
        danger: true,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Dialog */}
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report this link"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] mx-4 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
          <Icon name="shield" size={14} className="text-ink" />
          <span className="text-sm font-semibold text-ink">Report this link</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-[22px]">
          {submitted ? (
            /* Success state */
            <div className="text-center py-2">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-green/10 flex items-center justify-center">
                <Icon name="check" size={18} className="text-green" />
              </div>
              <p className="text-sm font-medium text-ink mb-1">
                Report submitted.
              </p>
              <p className="text-xs text-ink-3 mb-4">
                We review all reports within 48 hours.
              </p>
              <BBButton size="md" onClick={onClose} className="mx-auto">
                Done
              </BBButton>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-3 mb-4">
                If this shared link contains harmful or illegal content, let us know.
                Select a reason and provide details below.
              </p>

              {/* Reason presets */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      setSelectedPreset(selectedPreset === preset ? null : preset)
                    }
                    className={`inline-flex items-center px-sm py-xs text-xs font-medium rounded-sm border transition-colors ${
                      selectedPreset === preset
                        ? 'bg-amber-bg text-amber-deep border-amber-deep/30'
                        : 'bg-paper-2 text-ink-2 border-line hover:border-line-2'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {/* Reason textarea */}
              <label className="block text-xs font-medium text-ink-2 mb-1.5">
                Details
              </label>
              <textarea
                ref={textareaRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe the issue..."
                rows={3}
                maxLength={2000}
                className="w-full border border-line rounded-md bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 resize-y transition-colors focus:border-line-2 mb-1"
              />
              <div className="text-[11px] text-ink-4 mb-5 text-right">
                {fullReason.length} / 2000
              </div>

              {/* Submit button */}
              <BBButton
                variant="amber"
                size="lg"
                className="w-full justify-center gap-2"
                onClick={handleSubmit}
                disabled={!isValid || submitting}
              >
                <Icon name="shield" size={13} />
                {submitting ? 'Submitting...' : 'Submit report'}
              </BBButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
