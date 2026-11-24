// The shared frame around the split auth screens: context panel plus form column.
import type { ReactNode, Ref } from 'react'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

/**
 * The auth-card layout WITHOUT anything that talks to the network (task 1920, web#168 review).
 *
 * `AuthShell` is this frame plus the admin-broadcast announcement banner, whose
 * `listAnnouncements()` goes through the shared `request()` client: bearer token from storage and
 * `credentials: 'include'`. That is right for sign-in and onboarding, and wrong for a page that
 * promises not to tie a visit to an account (the exit survey, `/surveys/:id`). Such a page uses
 * this frame directly, so it draws the same card and makes no request of its own.
 *
 * Keep this file free of api, auth, key and vault imports: `test/1920-survey-review.test.tsx`
 * walks the survey page's import graph and fails if it reaches the request client.
 */
export interface AuthShellFrameProps {
  title: string
  subtitle?: string
  step?: number
  totalSteps?: number
  /** Sign-up step bar (master-key-naming 13): "Step n of N" beside the logo and one label per segment. */
  stepLabels?: string[]
  children: ReactNode
  /** Hide the trust footer (default: shown) */
  hideTrust?: boolean
  /** A wider card for plan choice (task 1037: /choose-plan). */
  wide?: boolean
  /** Pinned to the top of the screen (AuthShell passes the announcement banner). */
  banner?: ReactNode
  /**
   * When given, the title heading is focusable (`tabIndex={-1}`) and attached to this ref, so a
   * page can move the focus to the result of an action (task 1918 round 4, the email-link pages).
   */
  titleRef?: Ref<HTMLHeadingElement>
}

export function AuthShellFrame({
  title,
  subtitle,
  step,
  totalSteps,
  stepLabels,
  children,
  hideTrust,
  wide,
  banner,
  titleRef,
}: AuthShellFrameProps) {
  return (
    <div className="auth-bg min-h-screen flex flex-col items-center justify-center bg-paper px-4 py-6 sm:p-xl">
      {banner != null && <div className="fixed top-0 inset-x-0 z-30">{banner}</div>}
      <div className={`auth-card w-full ${wide ? 'max-w-[34rem]' : 'max-w-[28rem]'} bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden`}>
        {/* Header */}
        <div className="px-5 py-4 sm:px-xl sm:py-lg border-b border-line">
          {stepLabels && step != null && totalSteps != null ? (
            <div className="flex items-center justify-between">
              <BBLogo size={16} />
              <span className="text-xs text-ink-3" data-testid="step-count">Step {step} of {totalSteps}</span>
            </div>
          ) : (
            <BBLogo size={16} />
          )}
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
          {stepLabels && step != null && (
            <div className="flex gap-1 mt-2.5" data-testid="step-labels">
              {stepLabels.map((label, i) => (
                <span
                  key={label}
                  className={`flex-1 text-xs ${i + 1 === step ? 'text-ink font-medium' : 'text-ink-4'}`}
                >
                  {i + 1} {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4 sm:px-xl sm:py-lg">
          <h2
            ref={titleRef}
            tabIndex={titleRef ? -1 : undefined}
            className="text-lg font-semibold text-ink mb-1 outline-none"
          >
            {title}
          </h2>
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
