import { useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import type { IconName } from './icons'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { BBLogo } from './bb-logo'

interface TourStep {
  title: string
  description: string
  icon: IconName
  done: boolean
  href?: string
}

interface WelcomeTourProps {
  open: boolean
  onClose: () => void
  /** Called when the user clicks Continue on a step — persist + close the tour */
  onCompleteStep?: (title: string) => void
  userName?: string
  completedSteps?: Set<string>
}

const ALL_STEPS: Omit<TourStep, 'done'>[] = [
  {
    title: 'Your recovery phrase',
    description:
      'This is the only key to your vault. We saved it encrypted — you should print a copy.',
    icon: 'key',
    href: '/security',
  },
  {
    title: 'Add a second device',
    description:
      'Install the desktop app or iOS app so you can work anywhere.',
    icon: 'cloud',
  },
  {
    title: 'Upload your first file',
    description:
      'Drag one in, or drop a folder. Encryption happens on your laptop.',
    icon: 'upload',
    href: '/',
  },
  {
    title: 'Invite a person',
    description:
      'Keys exchange happens between your devices, not through our servers.',
    icon: 'users',
    href: '/team',
  },
  {
    title: 'Turn on passkey',
    description: "Faster sign-in with your device's biometrics.",
    icon: 'shield',
    href: '/settings/2fa',
  },
]

export function WelcomeTour({
  open,
  onClose,
  onCompleteStep,
  userName,
  completedSteps = new Set(),
}: WelcomeTourProps) {
  const navigate = useNavigate()

  if (!open) return null

  const steps: TourStep[] = ALL_STEPS.map((s) => ({
    ...s,
    done: completedSteps.has(s.title),
  }))

  const doneCount = steps.filter((s) => s.done).length
  const activeIndex = steps.findIndex((s) => !s.done)

  const displayName = userName ?? 'there'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 pointer-events-none">
      <div
        className="bg-paper rounded-xl border border-line-2 shadow-3 overflow-hidden pointer-events-auto"
        style={{ width: 680 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-line">
          <BBLogo size={14} />
          <span className="text-sm font-semibold text-ink">
            Welcome, {displayName}
          </span>
          <BBChip variant="amber" className="ml-auto">
            {doneCount} of {steps.length} done
          </BBChip>
        </div>

        {/* Steps */}
        <div className="py-2">
          {steps.map((step, i) => {
            const isActive = i === activeIndex
            return (
              <div
                key={step.title}
                className="flex items-start gap-3.5 px-5 py-3 transition-colors"
                style={{
                  background: isActive
                    ? 'var(--color-amber-bg)'
                    : 'transparent',
                  borderLeft: isActive
                    ? '3px solid var(--color-amber-deep)'
                    : '3px solid transparent',
                }}
              >
                {/* Step number / checkmark */}
                <div
                  className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                  style={{
                    background: step.done
                      ? 'oklch(0.72 0.16 155)'
                      : isActive
                        ? 'var(--color-amber-deep)'
                        : 'var(--color-paper-2)',
                    color:
                      step.done || isActive
                        ? 'var(--color-paper)'
                        : 'var(--color-ink-3)',
                    border:
                      step.done || isActive
                        ? 'none'
                        : '1px solid var(--color-line-2)',
                  }}
                >
                  {step.done ? (
                    <Icon name="check" size={11} />
                  ) : (
                    i + 1
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[13.5px] font-semibold leading-snug ${
                      step.done
                        ? 'text-ink-3 line-through'
                        : 'text-ink'
                    }`}
                  >
                    {step.title}
                  </div>
                  <div className="text-[12.5px] text-ink-2 mt-0.5 leading-relaxed">
                    {step.description}
                  </div>
                </div>

                {/* Action button for active step */}
                {isActive && step.href && (
                  <BBButton
                    size="sm"
                    variant="amber"
                    onClick={() => {
                      // Mark this step done so it stays checked when the
                      // tour reopens — do this BEFORE navigating, since
                      // some hrefs leave the drive page.
                      if (onCompleteStep) {
                        onCompleteStep(step.title)
                      } else {
                        onClose()
                      }
                      navigate(step.href!)
                    }}
                  >
                    Continue
                  </BBButton>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-t border-line bg-paper-2">
          <span className="text-[11px] text-ink-3">
            Skip for now — you can find this in Settings anytime
          </span>
          <BBButton
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={onClose}
          >
            Dismiss tour
          </BBButton>
        </div>
      </div>
    </div>
  )
}
