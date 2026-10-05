/**
 * Task 1810 round 2 (security review P2-2) — what /set-password does once the
 * server has opened a session for this device (directly, or after the 2FA code).
 *
 * Order matters and is the whole point of this module:
 *   1. lock(): zero any key still resident in this tab and clear the tab and
 *      persisted key caches. The reset may be completed in a tab that held a
 *      PREVIOUS account's key; nothing from before is carried into the new session.
 *   2. refreshUser(): load the session's user BEFORE the phrase screen exists.
 *      DeviceProvision tags the recovered key with `useAuth().user.user_id`; if
 *      the screen could render while `user` still held a previous account, the
 *      key would be sealed under that account's id.
 *   3. only then does the page show the phrase screen ('success').
 *
 * If the session cannot be read back, the page must not show the phrase screen
 * at all: it reports 'failed' and the caller sends the person to sign in.
 */
export interface ResetSessionDeps {
  clearLegacyBearer: () => void
  lock: () => void
  markPasswordResetCompleted: () => void
  refreshUser: () => Promise<void>
}

export async function completeResetSession(deps: ResetSessionDeps): Promise<'ready' | 'failed'> {
  // The fresh session also arrived as the bb_session cookie; drop the
  // redundant legacy bearer slot like every other auth-completing flow.
  deps.clearLegacyBearer()
  deps.lock()
  deps.markPasswordResetCompleted()
  try {
    await deps.refreshUser()
  } catch {
    return 'failed'
  }
  return 'ready'
}
