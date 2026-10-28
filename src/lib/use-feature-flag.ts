/**
 * Runtime feature flags (task 2237b).
 *
 * `shared_folders_v1` is decided by the server, not by a build-time env var:
 * the flag has to be switchable per user without a redeploy. The evaluate
 * endpoint is answered once per page session and cached at module level, so a
 * screen with several consumers still makes one request.
 *
 * Fail closed: a network error, a malformed body or a disabled flag all yield
 * `enabled: false`. The hook never throws.
 */
import { useEffect, useState } from 'react'
import { getEvaluateFlags } from './api'
import { SHARED_FOLDERS_FLAG } from './flags'

let flagsPromise: Promise<Record<string, boolean>> | null = null

/** One request per page session; every caller shares the same promise. */
export function loadFeatureFlagsOnce(): Promise<Record<string, boolean>> {
  if (!flagsPromise) {
    flagsPromise = getEvaluateFlags()
      .then((response) => (response && typeof response.flags === 'object' && response.flags) || {})
      .catch(() => ({}))
  }
  return flagsPromise
}

/** Test hook: forget the cached evaluate result. */
export function resetFeatureFlagCacheForTests(): void {
  flagsPromise = null
}

/**
 * Library code (not a hook): is `shared_folders_v1` on for this session?
 * Fails closed. Every shared-folder request outside the flag-gated panels
 * (custody reads, key publishes, the activity feed) asks this first, so a
 * flag-off session behaves exactly like the app before shared folders.
 */
export async function sharedFoldersEnabled(): Promise<boolean> {
  return (await loadFeatureFlagsOnce())[SHARED_FOLDERS_FLAG] === true
}

/** Sign-out and account switch: the flag is evaluated per user, so forget it. */
export function forgetFeatureFlags(): void {
  flagsPromise = null
}

export function useFeatureFlag(flag: typeof SHARED_FOLDERS_FLAG): {
  enabled: boolean
  loading: boolean
} {
  const [state, setState] = useState<{ enabled: boolean; loading: boolean }>({
    enabled: false,
    loading: true,
  })

  useEffect(() => {
    let live = true
    void loadFeatureFlagsOnce().then((flags) => {
      if (live) setState({ enabled: flags[flag] === true, loading: false })
    })
    return () => {
      live = false
    }
  }, [flag])

  return state
}
