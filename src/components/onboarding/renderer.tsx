import { useMemo } from 'react'
import { planScreen } from '../../lib/onboarding/plan'
import type { OnboardingPorts } from '../../lib/onboarding/ports'
import type { OnboardingDocument } from '../../lib/onboarding/types'
import { AccountView, VerifyEmailStep } from './account-view'
import { OnboardingFrame } from './frame'
import { PreAccountFlow, renderTerminalScreen } from './signup-flow'

/**
 * Renders an onboarding document (contract v1, task 1745, spec 5.9 web row).
 *
 * The document decides everything this component shows: `stage` picks the
 * pre-account signup flow or the account view, `planScreen` applies the
 * forward-compatibility rules, and the ports carry every side effect. Mount it
 * with real ports for the live app (behind `FEATURE_ONBOARDING_DOCUMENT`), or
 * with stubs for the fixture page and the tests.
 */
export function OnboardingRenderer({
  doc,
  ports,
  initialCompleted,
}: {
  doc: OnboardingDocument
  ports: OnboardingPorts
  initialCompleted?: readonly string[]
}) {
  if (doc.stage === 'pre_account') {
    // Remount on a new document identity only through the parent's key; the
    // flow owns a ceremony that must not be recreated by a re-render.
    return <PreAccountFlow doc={doc} ports={ports} initialCompleted={initialCompleted} />
  }
  return <AccountFlow doc={doc} ports={ports} />
}

function AccountFlow({ doc, ports }: { doc: OnboardingDocument; ports: OnboardingPorts }) {
  const screen = useMemo(() => planScreen(doc), [doc])
  const refresh = () => void ports.actions.refresh()

  switch (screen.kind) {
    case 'step':
      if (screen.stepId === 'verify_email') return <VerifyEmailStep screen={screen} ports={ports} />
      // A required step this build knows by name but cannot draw (billing_profile,
      // accept_terms in the account stage): the planner already routed unknown
      // ids to the fallback; this one is a known id we have no screen for yet.
      return (
        <OnboardingFrame
          screen={`step:${screen.stepId}`}
          title="One more step"
          subtitle="This step is finished on the web."
          position={screen.position}
          total={screen.total}
        >
          <a
            className="inline-flex w-full items-center justify-center rounded-lg bg-amber px-lg py-md text-base font-medium text-[oklch(0.22_0.01_70)]"
            href={doc.fallback?.url ?? 'https://beebeeb.io'}
            rel="noopener noreferrer"
          >
            Continue on the web
          </a>
        </OnboardingFrame>
      )
    case 'account':
      return <AccountView doc={doc} screen={screen} ports={ports} />
    default:
      return <>{renderTerminalScreen(screen, refresh, ports.signOut)}</>
  }
}
