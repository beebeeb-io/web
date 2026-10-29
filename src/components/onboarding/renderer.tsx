import { useMemo } from 'react'
import { planScreen } from '../../lib/onboarding/plan'
import type { OnboardingPorts } from '../../lib/onboarding/ports'
import type { OnboardingDocument } from '../../lib/onboarding/types'
import { AccountView, AcceptTermsStep, VerifyEmailStep } from './account-view'
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
      if (screen.stepId === 'accept_terms') return <AcceptTermsStep screen={screen} ports={ports} />
      // The planner only stops the account on a step this build draws (task 1822), so
      // this is unreachable; if it ever is reached it must not strand the account on a
      // card that says "Continue on the web" while the person is already on the web.
      return <AccountView doc={doc} screen={{ kind: 'account', actions: [], unsupported: [screen.stepId] }} ports={ports} />
    case 'account':
      return <AccountView doc={doc} screen={screen} ports={ports} />
    default:
      return <>{renderTerminalScreen(screen, refresh, ports.signOut)}</>
  }
}
