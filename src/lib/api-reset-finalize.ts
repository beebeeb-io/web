// The capability-gated 2FA-reset finalize request and its result types.
import { clearLegacyBearer, clearSessionConfirmed, request } from '@beebeeb/shared'
import { isPasswordSetSignInRequired } from './reset-2fa'

// ─── Reset ends at 2FA (server task 1730, client task 1803) ───────────────
// Both credential-reset finalizers (set-password-finish, recover-with-phrase-
// finalize) declare this capability. It is a promise that the caller handles
// `{ requires_2fa, partial_token }` by sending the person through
// /auth/2fa/verify. It is never a security input: a request without it gets the
// SAFE legacy behaviour (409 password_set_sign_in_required), not a weaker one.

/** Request header carrying the declared client capabilities. */
export const CAPABILITIES_HEADER = 'X-Beebeeb-Capabilities'
/** The capability token: "I finish a password reset through the 2FA challenge". */
export const RESET_2FA_CAPABILITY = 'reset-2fa'
const RESET_2FA_HEADERS: Record<string, string> = { [CAPABILITIES_HEADER]: RESET_2FA_CAPABILITY }

/** What a credential-reset finalizer answers (task 1730). */
export type ResetFinalizeResult =
  | {
      /** The account has 2FA: no session yet, finish via `verify2fa(partial_token, code)`. */
      requires_2fa: true
      partial_token: string
      user_id: string
      /** Present on set-password-finish; recover-with-phrase-finalize omits it. */
      email?: string
      session_token?: undefined
    }
  | {
      requires_2fa?: false
      session_token: string
      user_id: string
      email?: string
    }

/**
 * A credential reset deletes EVERY earlier session server-side (task 1730), so
 * whatever session evidence this page-load holds is obsolete the moment the
 * finalizer answers with a 2FA challenge (or the typed 409): the legacy bearer
 * and the "confirmed session" flag. Left in place, the first wrong code at
 * /auth/2fa/verify is an EXPECTED 401 that the shared `request()` client would
 * read as session expiry (flag still set, a signed-in locked-vault user got
 * here via getMe) and bounce to /login before the code step could show its
 * retry message (task 1803 round 2, Codex P2 on web#139). Clearing the evidence
 * makes that 401 an ordinary anonymous one; every other request keeps the
 * unchanged expiry handling. `clearLegacyBearer` (not `clearToken`) so the
 * stored-email callback is not fired — the reset's own email is stored after.
 */
function endObsoleteSession(): void {
  clearLegacyBearer()
  clearSessionConfirmed()
}

/** Run a reset finalizer's request; on the typed 409 the old sessions are gone too. */
export async function resetFinalizeRequest(path: string, body: Record<string, unknown>): Promise<ResetFinalizeResult> {
  try {
    const data = await request<ResetFinalizeResult>(path, {
      method: 'POST',
      headers: RESET_2FA_HEADERS,
      body: JSON.stringify(body),
    })
    if (data.requires_2fa) endObsoleteSession()
    return data
  } catch (err) {
    if (isPasswordSetSignInRequired(err)) endObsoleteSession()
    throw err
  }
}
