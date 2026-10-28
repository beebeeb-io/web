/**
 * Runtime feature flags (task 2237b).
 *
 * `shared_folders_v1` is decided by the server, not by a build-time env var:
 * the flag has to be switchable per user without a redeploy. The evaluate
 * endpoint is answered once per page session and cached at module level, so a
 * screen with several consumers still makes one request.
 *
 * Fail closed: a network error, a malformed body, a request that takes longer
 * than FLAG_REQUEST_TIMEOUT_MS or a disabled flag all yield `enabled: false`.
 * The hook never throws. Only a real answer is cached (rv-web198d N2): a failed
 * read is no answer, so the next read asks again instead of keeping "off" for
 * the whole page session on an account that has the flag.
 */
import { useEffect, useState } from 'react'
import { getEvaluateFlags } from './api'
import { SHARED_FOLDERS_FLAG } from './flags'

/**
 * How long a flag read may take before it counts as failed (rv-web198d P3). A
 * folder invite waits on this read, so it must end.
 */
export const FLAG_REQUEST_TIMEOUT_MS = 5_000
let flagRequestTimeoutMs = FLAG_REQUEST_TIMEOUT_MS

let flagsPromise: Promise<Record<string, boolean>> | null = null

function readFlags(): Promise<Record<string, boolean>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('feature flags timed out')), flagRequestTimeoutMs)
    let request: ReturnType<typeof getEvaluateFlags>
    try {
      request = getEvaluateFlags()
    } catch (error) {
      clearTimeout(timer)
      reject(error)
      return
    }
    request.then(
      (response) => {
        clearTimeout(timer)
        if (response && typeof response.flags === 'object' && response.flags) resolve(response.flags)
        else reject(new Error('malformed feature flags'))
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** One request per page session; every caller shares the same promise. */
export function loadFeatureFlagsOnce(): Promise<Record<string, boolean>> {
  if (!flagsPromise) {
    const pending: Promise<Record<string, boolean>> = readFlags().catch(() => {
      // This caller fails closed; the next one asks again.
      if (flagsPromise === pending) flagsPromise = null
      return {}
    })
    flagsPromise = pending
  }
  return flagsPromise
}

/** Test hook: forget the cached evaluate result. */
export function resetFeatureFlagCacheForTests(): void {
  flagsPromise = null
}

/** Test hook: the bound on one flag read, so a test need not wait seconds. */
export function setFlagRequestTimeoutForTests(ms: number): void {
  flagRequestTimeoutMs = ms
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
