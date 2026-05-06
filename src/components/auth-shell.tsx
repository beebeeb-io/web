import type { ReactNode } from 'react'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface AuthShellProps {
  title: string
  subtitle?: string
  step?: number
  totalSteps?: number
  children: ReactNode
  /** Hide the trust footer (default: shown) */
  hideTrust?: boolean
}

export function AuthShell({
  title,
  subtitle,
  step,
  totalSteps,
  children,
  hideTrust,
}: AuthShellProps) {
  return (
    <div className="auth-bg min-h-screen flex flex-col items-center justify-center bg-paper px-4 py-6 sm:p-xl">
      <div className="auth-card w-full max-w-[28rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 sm:px-xl sm:py-lg border-b border-line">
          <BBLogo size={16} />
          {totalSteps != null && step != null && (
            <div className="flex gap-1 mt-3.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-[3px] rounded-full transition-colors duration-300 ${
                    i < step ? 'bg-amber' : 'bg-paper-3'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4 sm:px-xl sm:py-lg">
          <h2 className="text-lg font-semibold text-ink mb-1">{title}</h2>
          {subtitle && (
            <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>

      {/* Trust indicator — outside the card, below */}
      {!hideTrust && (
        <div className="auth-trust mt-6 flex items-center gap-1.5 text-[11px] text-ink-4">
          <Icon name="shield" size={12} className="text-amber-deep" />
          <span>End-to-end encrypted</span>
          <span className="mx-0.5 text-line-2">·</span>
          <span>EU servers</span>
          <span className="mx-0.5 text-line-2">·</span>
          <span>Zero-knowledge</span>
        </div>
      )}
    </div>
  )
}
