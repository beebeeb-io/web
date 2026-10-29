import { useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from './auth-shell'
import { TwoFactorPrompt } from './two-factor-prompt'
import { BBButton, Icon } from '@beebeeb/shared'
import type { LoginResult } from '@beebeeb/shared'
import { verify2fa } from '../lib/api'
import { classifyTwoFactorFailure } from '../lib/two-factor-login'
import { describeResetTwoFactorClosed, SIGN_IN_REQUIRED_MESSAGE } from '../lib/reset-2fa'

/**
 * The 2FA code step at the end of a password reset or a recovery-phrase
 * recovery (task 1803). Reuses the sign-in `TwoFactorPrompt` and the same
 * failure classification as /login, but the "challenge is spent" outcome is
 * different: the password is already set, so it hands back to the caller to
 * show the sign-in-required screen instead of asking for a password again.
 */
export function ResetTwoFactorStep({
  partialToken,
  onVerified,
  onClosed,
}: {
  partialToken: string
  /** The server accepted the code and opened the session (cookie set). */
  onVerified: (result: LoginResult) => Promise<void> | void
  /** The challenge is spent (timed out / attempt cap): no session, password already set. */
  onClosed: (reason: string) => void
}) {
  // When the partial token was issued and how many codes were sent against it.
  // The server answers every rejection with the same 401, so these are the only
  // way to tell "timed out" / "too many" from "wrong code" (see two-factor-login.ts).
  const issuedAt = useRef(Date.now())
  const attempts = useRef(0)

  const handleVerify = useCallback(
    async (code: string) => {
      attempts.current += 1
      let result: LoginResult
      try {
        result = await verify2fa(partialToken, code)
      } catch (err) {
        const failure = classifyTwoFactorFailure(err, {
          issuedAt: issuedAt.current,
          attempts: attempts.current,
        })
        if (failure.kind === 'restart') {
          onClosed(describeResetTwoFactorClosed(failure))
          return
        }
        // TwoFactorPrompt renders what we throw and clears the field.
        throw new Error(failure.message)
      }
      await onVerified(result)
    },
    [partialToken, onVerified, onClosed],
  )

  return (
    <AuthShell
      title="Two-factor authentication"
      subtitle="Your new password is set. Enter your code to finish signing in."
      hideTrust
    >
      <TwoFactorPrompt onVerify={handleVerify} />
    </AuthShell>
  )
}

/**
 * The new password is set but no session was opened (an older cached page that
 * could not finish the 2FA step, or the code step was closed). Sign-in with the
 * new password and the authentication code is the way forward.
 */
export function ResetSignInRequired({ detail }: { detail?: string }) {
  return (
    <AuthShell title="Password set" subtitle={SIGN_IN_REQUIRED_MESSAGE} hideTrust>
      <div className="flex items-start gap-2.5 p-3 mb-5 bg-paper-2 border border-line rounded-md" data-testid="reset-sign-in-required">
        <Icon name="shield" size={14} className="text-ink-3 shrink-0 mt-0.5" />
        <p className="text-[12.5px] text-ink-2 leading-relaxed">
          {detail ? `${detail} ` : ''}Sign in with your new password and your authentication code.
        </p>
      </div>
      <Link to="/login">
        <BBButton variant="amber" size="lg" className="w-full justify-center">
          Sign in
        </BBButton>
      </Link>
    </AuthShell>
  )
}
