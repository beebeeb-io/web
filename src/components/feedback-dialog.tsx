import { useState, useEffect, useRef } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
  defaultCategory?: string
}

const CATEGORIES = [
  'Sharing limits',
  'Bug report',
  'Feature request',
  'Other',
]

export function FeedbackDialog({ open, onClose, defaultCategory }: FeedbackDialogProps) {
  const [category, setCategory] = useState(defaultCategory ?? CATEGORIES[0])
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory ?? CATEGORIES[0])
      setMessage('')
      setSent(false)
      setDropdownOpen(false)
    }
  }, [open, defaultCategory])

  // Focus textarea when dialog opens
  useEffect(() => {
    if (open && !sent) {
      // Small delay so the dialog renders first
      const t = setTimeout(() => textareaRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, sent])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  if (!open) return null

  const handleSend = () => {
    const trimmed = message.trim()
    if (!trimmed) return

    // MVP: open mailto link with category + message
    const subject = encodeURIComponent(`[${category}] Feedback from app`)
    const body = encodeURIComponent(`Category: ${category}\n\n${trimmed}`)
    window.open(`mailto:feedback@beebeeb.io?subject=${subject}&body=${body}`, '_blank')

    setSent(true)
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
        aria-label="Share feedback"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
          <Icon name="mail" size={14} className="text-ink" />
          <span className="text-sm font-semibold text-ink">Share feedback</span>
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
          {sent ? (
            /* Success state */
            <div className="text-center py-2">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-green/10 flex items-center justify-center">
                <Icon name="check" size={18} className="text-green" />
              </div>
              <p className="text-sm font-medium text-ink mb-1">
                Thanks for the feedback.
              </p>
              <p className="text-xs text-ink-3 mb-4">
                We read every message.
              </p>
              <BBButton size="md" onClick={onClose} className="mx-auto">
                Done
              </BBButton>
            </div>
          ) : (
            <>
              {/* Category selector */}
              <label className="block text-xs font-medium text-ink-2 mb-1.5">
                Category
              </label>
              <div ref={dropdownRef} className="relative mb-4">
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 text-[13px] text-ink transition-all hover:border-line-2"
                >
                  <span className="flex-1 text-left">{category}</span>
                  <Icon name="chevron-down" size={12} className="text-ink-4" />
                </button>
                {dropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-paper border border-line-2 rounded-lg shadow-2 z-30 overflow-hidden">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                          cat === category
                            ? 'bg-amber-bg text-amber-deep font-medium'
                            : 'text-ink hover:bg-paper-2'
                        }`}
                        onClick={() => {
                          setCategory(cat)
                          setDropdownOpen(false)
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message textarea */}
              <label className="block text-xs font-medium text-ink-2 mb-1.5">
                Message
              </label>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what's going on..."
                rows={3}
                className="w-full border border-line rounded-md bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 resize-y transition-colors focus:border-line-2 mb-5"
              />

              {/* Send button */}
              <BBButton
                variant="amber"
                size="lg"
                className="w-full justify-center gap-2"
                onClick={handleSend}
                disabled={!message.trim()}
              >
                <Icon name="mail" size={13} />
                Send feedback
              </BBButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
