import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { OnboardingRenderer } from '../components/onboarding/renderer'
import { OnboardingFrame, Spinner } from '../components/onboarding/frame'
import { UnsupportedSchema } from '../components/onboarding/blocking-screens'
import {
  accountStateFromError,
  resolveAccountState,
} from '../lib/account-state'
import { getSubscription, setEmail } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { useKeys } from '../lib/key-context'
import { clearLegacyBearer } from '@beebeeb/shared'
import { parsePlanIntent, postSignupDestination, readPlanIntent, savePlanIntent } from '../lib/plan-intent'
import { unsupportedSchemaScreen } from '../lib/onboarding/plan'
import { coreCeremonyPorts, fetchBreachBody, httpActions, type OnboardingPorts } from '../lib/onboarding/ports'
import { useOnboardingDocument } from '../lib/onboarding/use-document'
import { markWelcomeFilePending, uploadWelcomeFile } from '../lib/welcome-file-upload'
import { welcomeFileAtSignup } from '../lib/welcome-file'
import { REFERRAL_CODE_KEY, REFERRAL_SHARER_KEY, REFERRAL_SOURCE_KEY, Signup } from './signup'

/**
 * Document-driven pages (task 1745), mounted ONLY when
 * `FEATURE_ONBOARDING_DOCUMENT` is on (see `app.tsx`). With the flag off none
 * of this is imported on a route, and `/signup` is the legacy page.
 *
 * Rule 6 (spec 5.8): a 404 from an old server, a network failure or a document
 * we cannot draw falls back to the legacy page, unchanged. Only a document
 * from a NEWER schema major than ours shows the "update" screen.
 *
 * What T8 (the remaining part of this task's epic step) removes once the
 * endpoint is live: the legacy `Signup` / `Onboarding` pages, `TRIAL_PLAN_SLUGS`
 * (`trial-checkout.ts`), `INTENT_PLANS` (`plan-intent.ts`) and the charge-date
 * maths, `planGateRedirect`. None of them is touched here. (The legacy
 * password signup caller, `api.ts` `signup()`, was already removed in task 1799.)
 */

function Loading() {
  return (
    <OnboardingFrame screen="loading" title="One moment">
      <Spinner label="Loading" />
    </OnboardingFrame>
  )
}

/** Persist the landing-URL attribution exactly as the legacy signup page does. */
function usePersistLandingParams() {
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const ref = searchParams.get('ref')
    const sharer = searchParams.get('sharer')
    const code = searchParams.get('code')
    try {
      if (ref) localStorage.setItem(REFERRAL_SOURCE_KEY, ref)
      if (sharer) localStorage.setItem(REFERRAL_SHARER_KEY, sharer)
      if (code) localStorage.setItem(REFERRAL_CODE_KEY, code)
    } catch {
      /* storage blocked: attribution is best effort */
    }
    const intent = parsePlanIntent(searchParams.get('plan'), searchParams.get('cycle'))
    if (intent) savePlanIntent(intent)
  }, [searchParams])
}

function readReferral() {
  try {
    return {
      source: localStorage.getItem(REFERRAL_SOURCE_KEY) ?? undefined,
      sharerId: localStorage.getItem(REFERRAL_SHARER_KEY) ?? undefined,
      code: localStorage.getItem(REFERRAL_CODE_KEY) ?? undefined,
    }
  } catch {
    return {}
  }
}

/** `/signup` with the flag on. */
export function SignupFromDocument() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const { setMasterKey } = useKeys()
  const { state, refresh } = useOnboardingDocument()
  usePersistLandingParams()

  const ports = useMemo<OnboardingPorts>(
    () => ({
      actions: httpActions(refresh),
      ceremony: coreCeremonyPorts,
      fetchBreachBody,
      referral: readReferral,
      async onAccountCreated({ userId, email, masterKey, password }) {
        // Same post-creation sequence as the legacy onboarding page (steps 4 to 6),
        // kept identical on purpose so flipping the flag changes the form, not the vault.
        setEmail(email)
        clearLegacyBearer()
        await setMasterKey(masterKey, password, userId)
        try {
          const sub = await getSubscription().catch(() => null)
          if (welcomeFileAtSignup(resolveAccountState(sub)) === 'defer') {
            await markWelcomeFilePending()
          } else {
            await uploadWelcomeFile(masterKey)
          }
        } catch (err) {
          if (accountStateFromError(err)) await markWelcomeFilePending().catch(() => {})
        }
        for (const k of [REFERRAL_SOURCE_KEY, REFERRAL_SHARER_KEY, REFERRAL_CODE_KEY]) {
          try {
            localStorage.removeItem(k)
          } catch {
            /* ignore */
          }
        }
        await refreshUser()
        navigate(postSignupDestination(readPlanIntent()), { replace: true })
      },
    }),
    [refresh, navigate, refreshUser, setMasterKey],
  )

  switch (state.kind) {
    case 'loading':
      return <Loading />
    case 'legacy':
      return <Signup />
    case 'unsupported_schema':
      return <UnsupportedSchema screen={unsupportedSchemaScreen()} />
    case 'document':
      // Only a pre-account document belongs on /signup; an account-stage one
      // (a signed-in visitor) is the account page's to render.
      if (state.doc.stage !== 'pre_account') return <Signup />
      return <OnboardingRenderer doc={state.doc} ports={ports} />
  }
}

/** `/account-status` with the flag on: the account-stage document, signed in. */
export function AccountStatusFromDocument() {
  const { state, refresh: refreshDocument } = useOnboardingDocument()
  const { refreshPlanDetails } = useDriveData()
  // The route gate (PlanGate) reads its own copy of the account document from the
  // drive data context; completing a blocking step here must refresh THAT copy
  // too, or the gate keeps redirecting back to this page.
  const refresh = useCallback(async () => {
    await refreshDocument()
    refreshPlanDetails()
  }, [refreshDocument, refreshPlanDetails])
  const navigate = useNavigate()
  const { logout } = useAuth()

  const ports = useMemo<OnboardingPorts>(
    () => ({
      actions: httpActions(refresh),
      ceremony: coreCeremonyPorts,
      fetchBreachBody,
      onAccountCreated: async () => {
        /* an account page never creates an account */
      },
      // Contract rule 7: update_required still allows Sign out.
      signOut: async () => {
        await logout()
        navigate('/login', { replace: true })
      },
    }),
    [refresh, logout, navigate],
  )

  useEffect(() => {
    // Legacy outcome: the document is unavailable, so this page has nothing to
    // say. Send the person to the app, whose own gate (PlanGate, app.tsx) decides.
    if (state.kind === 'legacy') navigate('/', { replace: true })
  }, [state.kind, navigate])

  switch (state.kind) {
    case 'loading':
    case 'legacy':
      return <Loading />
    case 'unsupported_schema':
      return <UnsupportedSchema screen={unsupportedSchemaScreen()} />
    case 'document':
      return <OnboardingRenderer doc={state.doc} ports={ports} />
  }
}
