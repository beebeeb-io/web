import { useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import type { Fallback } from '../../lib/onboarding/types'
import type {
  BlockedScreen,
  FallbackScreen,
  SignupUnavailableScreen,
  UnsupportedSchemaScreen,
  UpdateRequiredScreen,
} from '../../lib/onboarding/plan'
import { OnboardingFrame } from './frame'

function FallbackAction({ fallback, testId }: { fallback: Fallback; testId: string }) {
  // `update_app` on the web means the page itself is out of date: a reload
  // fetches the current build. It never links anywhere (the web has no store).
  if (fallback.kind === 'update_app') {
    return (
      <BBButton variant="amber" size="lg" className="w-full" data-testid={testId} onClick={() => window.location.reload()}>
        Reload to update
      </BBButton>
    )
  }
  if (fallback.kind === 'contact_support') {
    return (
      <a
        href="mailto:support@beebeeb.io"
        data-testid={testId}
        className="inline-flex w-full items-center justify-center rounded-lg bg-amber px-lg py-md text-base font-medium text-[oklch(0.22_0.01_70)] hover:brightness-95"
      >
        Contact support
      </a>
    )
  }
  if (fallback.url) {
    return (
      <a
        href={fallback.url}
        data-testid={testId}
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center rounded-lg bg-amber px-lg py-md text-base font-medium text-[oklch(0.22_0.01_70)] hover:brightness-95"
      >
        Continue on the web
        <Icon name="chevron-right" size={16} className="ml-1.5" />
      </a>
    )
  }
  return null
}

export function UpdateRequired({ screen, onSignOut }: { screen: UpdateRequiredScreen; onSignOut?: () => Promise<void> }) {
  const [signingOut, setSigningOut] = useState(false)
  return (
    <OnboardingFrame
      screen="update_required"
      title="This version is too old"
      subtitle={
        screen.minVersion
          ? `Beebeeb ${screen.minVersion} or newer is needed to continue. Nothing else works until you update.`
          : 'A newer version is needed to continue. Nothing else works until you update.'
      }
    >
      <FallbackAction fallback={screen.fallback} testId="update-required-action" />
      {onSignOut ? (
        <BBButton
          variant="ghost"
          className="w-full mt-2"
          data-testid="update-required-sign-out"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            try {
              await onSignOut()
            } finally {
              setSigningOut(false)
            }
          }}
        >
          Sign out
        </BBButton>
      ) : null}
    </OnboardingFrame>
  )
}

export function UnsupportedSchema({ screen }: { screen: UnsupportedSchemaScreen }) {
  return (
    <OnboardingFrame
      screen="unsupported_schema"
      title="Update to continue"
      subtitle="The server is speaking a newer version of sign-up than this page understands. We will not guess."
    >
      <FallbackAction fallback={screen.fallback} testId="unsupported-schema-action" />
    </OnboardingFrame>
  )
}

export function SignupUnavailable({ screen }: { screen: SignupUnavailableScreen }) {
  return (
    <OnboardingFrame
      screen="signup_unavailable"
      title="Sign-up is not open here"
      subtitle="You can create your account on the web."
    >
      {screen.webUrl ? (
        <FallbackAction fallback={{ kind: 'use_web', url: screen.webUrl }} testId="signup-unavailable-action" />
      ) : null}
    </OnboardingFrame>
  )
}

export function StepFallback({ screen }: { screen: FallbackScreen }) {
  return (
    <OnboardingFrame
      screen="fallback"
      title="We cannot do this step here yet"
      subtitle="This step is newer than this page. Finish it where it is supported, then come back."
    >
      <p className="text-[11px] text-ink-3 mb-4">
        Step <span className="font-mono" data-testid="fallback-step-id">{screen.stepId}</span>
      </p>
      <FallbackAction fallback={screen.fallback} testId="step-fallback-action" />
    </OnboardingFrame>
  )
}

export function StepBlocked({ screen, onRefresh }: { screen: BlockedScreen; onRefresh: () => void }) {
  return (
    <OnboardingFrame
      screen="blocked"
      title="This step is not available right now"
      subtitle="We could not start it. Nothing was lost; try again in a moment."
    >
      <p className="text-[11px] text-ink-3 mb-4">
        Step <span className="font-mono" data-testid="blocked-step-id">{screen.stepId}</span>
      </p>
      {screen.fallback ? <FallbackAction fallback={screen.fallback} testId="step-blocked-action" /> : null}
      <BBButton variant="ghost" className="w-full mt-2" onClick={onRefresh}>
        Check again
      </BBButton>
    </OnboardingFrame>
  )
}
