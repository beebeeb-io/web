/**
 * Onboarding state machine — spec 024.
 *
 * Derives the current onboarding step by combining:
 *   1. The server's authoritative state (`GET /api/v1/account/onboarding-state`)
 *   2. A localStorage override that lets the user skip/dismiss the guide
 *
 * Step ordering (earliest incomplete step wins):
 *   welcome_file  → step 6: user sees the welcome file for the first time
 *   first_upload  → step 7: user uploads their first real file
 *   first_share   → step 8: user creates their first share link
 *   done          → all steps complete, no guide shown
 *
 * The context is intentionally simple: components read `step` and call
 * `refresh()` after taking an action that might advance the step.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getOnboardingState, type OnboardingState } from './api'
import { useAuth } from './auth-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type OnboardingStep =
  | 'loading'        // initial state while fetching from server
  | 'welcome_file'   // spec 024 step 6
  | 'first_upload'   // spec 024 step 7
  | 'first_share'    // spec 024 step 8
  | 'done'           // all complete

interface OnboardingContextValue {
  /** Current onboarding step. 'loading' while the server fetch is in flight. */
  step: OnboardingStep
  /** Raw server state — useful for components that need individual flag values. */
  serverState: OnboardingState | null
  /**
   * Refetch server state and recompute step.
   * Call this after an action that may advance the flow (upload, share creation).
   */
  refresh: () => Promise<void>
  /**
   * Persist 'done' to localStorage and skip the remainder of the guide.
   * Used by the "Skip" / "Got it" buttons.
   */
  skipAll: () => void
}

// ── localStorage helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = 'beebeeb_onboarding_state'

function readLocalStep(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { step?: string }
    return parsed.step ?? null
  } catch {
    return null
  }
}

function writeLocalStep(step: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step }))
  } catch { /* ignore — localStorage may be unavailable */ }
}

// ── Step computation ───────────────────────────────────────────────────────────

function computeStep(server: OnboardingState, localStep: string | null): OnboardingStep {
  // Explicit skip always wins
  if (localStep === 'done') return 'done'

  // Walk the step ladder — return the first incomplete step
  if (!server.welcome_file_exists) return 'welcome_file'
  if (!server.first_upload_done) return 'first_upload'
  if (!server.first_share_done) return 'first_share'

  // All server flags satisfied — persist done so we never re-fetch
  writeLocalStep('done')
  return 'done'
}

// ── Context + provider ────────────────────────────────────────────────────────

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [step, setStep] = useState<OnboardingStep>('loading')
  const [serverState, setServerState] = useState<OnboardingState | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setStep('done') // Not logged in — nothing to show
      return
    }
    try {
      const state = await getOnboardingState()
      setServerState(state)
      setStep(computeStep(state, readLocalStep()))
    } catch {
      // Can't reach server — don't block the UI
      setStep('done')
    }
  }, [user])

  // Initial fetch on mount / user change
  useEffect(() => { void refresh() }, [refresh])

  const skipAll = useCallback(() => {
    writeLocalStep('done')
    setStep('done')
  }, [])

  return (
    <OnboardingContext.Provider value={{ step, serverState, refresh, skipAll }}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be called inside <OnboardingProvider>')
  return ctx
}
