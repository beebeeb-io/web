import type { ReactNode } from 'react'
import { AuthShell } from '../auth-shell'

/**
 * The one frame every onboarding screen sits in. `data-screen` is the stable
 * hook the fixture specs assert on ("which screen did the planner pick"), so a
 * renamed heading never makes a test lie.
 */
export function OnboardingFrame({
  screen,
  title,
  subtitle,
  position,
  total,
  wide,
  children,
}: {
  screen: string
  title: string
  subtitle?: string
  position?: number
  total?: number
  wide?: boolean
  children: ReactNode
}) {
  return (
    <AuthShell
      title={title}
      subtitle={subtitle}
      step={position}
      totalSteps={total}
      hideTrust
      wide={wide}
    >
      <div data-testid="onboarding-screen" data-screen={screen}>
        {children}
      </div>
    </AuthShell>
  )
}

export function ErrorLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="alert" className="text-xs text-red mb-3" data-testid={testId ?? 'onboarding-error'}>
      {children}
    </p>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-3" role="status">
      <div className="w-4 h-4 border-2 border-ink-3 border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}

/** "Stored in the EU." style footer line, only when the server sent one. */
export function RegionFooter({ line }: { line: string | undefined }) {
  if (!line) return null
  return (
    <div className="border-t border-line mt-[18px] pt-3.5 text-[11px] text-ink-3" data-testid="region-line">
      End-to-end encrypted · {line}
    </div>
  )
}
