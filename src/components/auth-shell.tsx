import type { ReactNode } from 'react'
import { BBLogo } from './bb-logo'

interface AuthShellProps {
  title: string
  subtitle?: string
  step?: number
  totalSteps?: number
  children: ReactNode
}

export function AuthShell({
  title,
  subtitle,
  step,
  totalSteps,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div className="w-full max-w-md bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="px-xl py-lg border-b border-line">
          <BBLogo size={14} />
          {totalSteps != null && step != null && (
            <div className="flex gap-1 mt-3.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-[3px] rounded-full ${
                    i < step ? 'bg-amber' : 'bg-paper-3'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-xl py-lg">
          <h2 className="text-lg font-semibold text-ink mb-1.5">{title}</h2>
          {subtitle && (
            <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
