/**
 * Onboarding guide overlay — spec 024 steps 6-9.
 *
 * A single bottom-anchored chip that presents the current onboarding step.
 * Driven by OnboardingContext — call refresh() after each completed action.
 *
 * Steps handled:
 *   welcome_file  → "Click the welcome file to open it"
 *   first_upload  → "Drop any file here to upload it encrypted"
 *   first_share   → "Share a file — the key stays in the URL, never on our servers"
 *   done          → nothing rendered
 */

import { useCallback } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { useOnboarding } from '../lib/onboarding-context'

interface OnboardingGuideProps {
  /** Triggers the system file picker (for the first_upload step). */
  onPickFile: () => void
  /** Opens the share dialog for the most recently uploaded file. */
  onOpenShare: (fileId?: string) => void
  /** ID of the most recently uploaded file — used to pre-select for sharing. */
  lastUploadedFileId?: string | null
}

export function OnboardingGuide({ onPickFile, onOpenShare, lastUploadedFileId }: OnboardingGuideProps) {
  const { step, skipAll, refresh } = useOnboarding()

  const handleSkip = useCallback(() => {
    skipAll()
  }, [skipAll])

  if (step === 'loading' || step === 'done') return null

  const content = (() => {
    switch (step) {
      case 'welcome_file':
        return {
          icon: 'file-text' as const,
          headline: 'Welcome — give it a click.',
          body: 'Your welcome file is in the drive. Click it to open.',
          action: null,
          actionLabel: null,
        }

      case 'first_upload':
        return {
          icon: 'upload' as const,
          headline: 'Upload your first file.',
          body: 'Encrypted on this device before it leaves. Drag a file onto the drive or click below.',
          action: onPickFile,
          actionLabel: 'Pick a file',
        }

      case 'first_share':
        return {
          icon: 'link' as const,
          headline: 'Try sharing a file.',
          body: 'Right-click any file → Share. The decryption key lives in the URL — we never see it.',
          action: lastUploadedFileId
            ? () => onOpenShare(lastUploadedFileId)
            : () => onOpenShare(),
          actionLabel: 'Share a file',
        }

      default:
        return null
    }
  })()

  if (!content) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(520px,calc(100vw-2rem))] pointer-events-auto animate-slide-in-up">
      <div className="bg-ink text-paper rounded-xl shadow-3 overflow-hidden border border-ink-2/30">
        <div className="flex items-start gap-3.5 px-5 py-4">
          {/* Icon */}
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-amber flex items-center justify-center">
            <Icon name={content.icon} size={15} className="text-ink" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-paper leading-tight">{content.headline}</p>
            <p className="text-[12px] text-paper/70 mt-0.5 leading-relaxed">{content.body}</p>
          </div>

          {/* Close */}
          <button
            onClick={handleSkip}
            className="shrink-0 p-0.5 text-paper/40 hover:text-paper/80 transition-colors"
            aria-label="Dismiss onboarding guide"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Actions */}
        {content.action && (
          <div className="flex items-center gap-2 px-5 pb-4 -mt-1">
            <BBButton
              size="sm"
              variant="amber"
              onClick={() => {
                content.action?.()
                void refresh()
              }}
              className="gap-1.5"
            >
              <Icon name={content.icon} size={11} />
              {content.actionLabel}
            </BBButton>
            <button
              onClick={handleSkip}
              className="text-[11.5px] text-paper/50 hover:text-paper/80 transition-colors"
            >
              Skip tour
            </button>
          </div>
        )}

        {!content.action && (
          <div className="px-5 pb-4 -mt-1">
            <button
              onClick={handleSkip}
              className="text-[11.5px] text-paper/50 hover:text-paper/80 transition-colors"
            >
              Skip tour
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
