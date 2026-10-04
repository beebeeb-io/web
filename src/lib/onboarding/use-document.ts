import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOnboardingDocument, type FetchOutcome } from './client'

export type DocumentState = { kind: 'loading' } | FetchOutcome

/**
 * Fetch the onboarding document on mount and on `refresh()` (after each step
 * that changes it, on route enter, and on return from checkout: spec 5.9 web
 * row). A refresh keeps showing the last document while it is in flight so the
 * screen never flashes empty; the very first load is `loading`.
 */
export function useOnboardingDocument(): { state: DocumentState; refresh: () => Promise<void> } {
  const [state, setState] = useState<DocumentState>({ kind: 'loading' })
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const outcome = await fetchOnboardingDocument()
    if (alive.current) setState(outcome)
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  return { state, refresh }
}
