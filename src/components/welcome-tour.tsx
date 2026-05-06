import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'

interface TourStep {
  id: string
  title: string
  description: string
  icon: IconName
  done: boolean
  href?: string
  action?: string
}

interface WelcomeTourProps {
  open: boolean
  onClose: () => void
  onCompleteStep?: (id: string) => void
  userName?: string
  completedSteps?: Set<string>
  onUpload?: () => void
}

const ALL_STEPS: Omit<TourStep, 'done'>[] = [
  {
    id: 'upload',
    title: 'Upload your first file',
    description:
      'Drag a file into the drive, or click here. Everything is encrypted on your device before it leaves.',
    icon: 'upload',
    action: 'Upload a file',
  },
  {
    id: 'security',
    title: 'Set up two-factor auth',
    description:
      'Add an extra layer of protection with TOTP or a passkey. Takes 30 seconds.',
    icon: 'shield',
    href: '/security',
    action: 'Set up 2FA',
  },
  {
    id: 'share',
    title: 'Share something securely',
    description:
      'Create an encrypted share link. You control expiry, download limits, and passphrase.',
    icon: 'link',
    href: '/',
    action: 'Go to drive',
  },
  {
    id: 'device',
    title: 'Add a second device',
    description:
      'Install the iOS app or desktop client. Your encryption keys sync securely between devices.',
    icon: 'cloud',
    href: '/settings/devices',
    action: 'See devices',
  },
]

export function WelcomeTour({
  open,
  onClose,
  onCompleteStep,
  userName,
  completedSteps = new Set(),
  onUpload,
}: WelcomeTourProps) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState<string | null>(null)

  if (!open) return null

  const steps: TourStep[] = ALL_STEPS.map((s) => ({
    ...s,
    done: completedSteps.has(s.id),
  }))

  const doneCount = steps.filter((s) => s.done).length
  const firstIncomplete = steps.find((s) => !s.done)
  const expandedId = activeId ?? firstIncomplete?.id ?? steps[0].id

  const displayName = userName ?? 'there'
  const allDone = doneCount === steps.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30">
      <div
        className="bg-paper rounded-xl border border-line-2 shadow-3 overflow-hidden w-full max-w-[520px] mx-4"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5 mb-3">
            <BBLogo size={14} />
            <span className="text-[15px] font-semibold text-ink">
              Welcome, {displayName}
            </span>
          </div>
          <p className="text-[13px] text-ink-3 leading-relaxed">
            {allDone
              ? 'All set — your vault is ready to go.'
              : 'A few things to get the most out of your encrypted vault.'}
          </p>
          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-paper-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber transition-all duration-500"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-ink-3 shrink-0">
              {doneCount}/{steps.length}
            </span>
          </div>
        </div>

        {/* Steps — accordion style */}
        <div className="py-1.5">
          {steps.map((step) => {
            const isExpanded = step.id === expandedId
            return (
              <div key={step.id}>
                {/* Step header — clickable */}
                <button
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-paper-2/50"
                  onClick={() => setActiveId(step.id === activeId ? null : step.id)}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: step.done
                        ? 'oklch(0.72 0.16 155)'
                        : isExpanded
                          ? 'var(--color-amber)'
                          : 'var(--color-paper-3)',
                      color: step.done || isExpanded
                        ? 'var(--color-paper)'
                        : 'var(--color-ink-3)',
                    }}
                  >
                    {step.done ? (
                      <Icon name="check" size={12} />
                    ) : (
                      <Icon name={step.icon} size={12} />
                    )}
                  </div>
                  <span
                    className={`flex-1 text-[13px] font-medium ${
                      step.done ? 'text-ink-3 line-through' : 'text-ink'
                    }`}
                  >
                    {step.title}
                  </span>
                  <Icon
                    name="arrow-up"
                    size={10}
                    className={`text-ink-4 transition-transform ${isExpanded ? '' : 'rotate-180'}`}
                  />
                </button>

                {/* Expanded content */}
                {isExpanded && !step.done && (
                  <div className="px-5 pb-3 pl-14">
                    <p className="text-[12.5px] text-ink-2 leading-relaxed mb-3">
                      {step.description}
                    </p>
                    <BBButton
                      size="sm"
                      variant="amber"
                      onClick={() => {
                        if (step.id === 'upload' && onUpload) {
                          onUpload()
                          onCompleteStep?.(step.id)
                          onClose()
                        } else if (step.href) {
                          onCompleteStep?.(step.id)
                          navigate(step.href)
                          onClose()
                        }
                      }}
                      className="gap-1.5"
                    >
                      <Icon name={step.icon} size={11} />
                      {step.action ?? 'Continue'}
                    </BBButton>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center px-5 py-3 border-t border-line bg-paper-2">
          <span className="text-[11px] text-ink-4">
            Find this in Settings anytime
          </span>
          <BBButton
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={onClose}
          >
            {allDone ? 'Close' : 'Skip for now'}
          </BBButton>
        </div>
      </div>
    </div>
  )
}
