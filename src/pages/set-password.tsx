/**
 * /set-password/:token — one-time set-password page (task 1704, SLICE 1).
 *
 * The emailed link is the entry proof for an email-based password reset:
 *   1. The user lands here from a `{app}/set-password/<token>` email link
 *      (token in the PATH — preview-safe, never a query param).
 *   2. They choose a new password client-side. The OPAQUE re-registration
 *      runs against /auth/set-password-opaque-register (bridge) and
 *      /auth/set-password-finish (finalize). ZERO key material on the wire:
 *      no recovery_check, no x25519_public_key, and the password itself is
 *      never transmitted.
 *   3. The server replaces the OPAQUE record, keeps the set-once key
 *      bindings untouched (an email-only reset NEVER rotates them), deletes
 *      ALL sessions, and mints a fresh session for this device.
 *
 * Task 1803 (server 1730, Guus ruling A): a reset NEVER bypasses 2FA. The
 * finalize call declares `X-Beebeeb-Capabilities: reset-2fa`; for an account
 * with 2FA the server then answers `{requires_2fa, partial_token}` with NO
 * session, and this page shows the sign-in 2FA code step and finishes through
 * /auth/2fa/verify. A 409 `password_set_sign_in_required` (the credential was
 * rotated but this page could not finish the 2FA step) says so plainly and
 * links to /login.
 *
 * HONEST COPY (the governing amendment, decisions/2026-10-02-…-policy.md):
 * setting a new password restores ACCOUNT access; the VAULT stays locked
 * until the user re-enters their recovery phrase or vault key — which then
 * re-wraps the key under the new password via /recover-with-phrase (the
 * re-wrap ceremony is SLICE 3; this page deliberately does not touch
 * key-context or the vault).
 *
 * After success the app lands on the drive with a fresh session; the vault
 * is still wrapped under the old password, so unlockVault reports
 * wrong_password. Task 1704 SLICE 2 completes the loop: this page stamps a
 * post-reset marker (src/lib/post-reset-lock.ts — sessionStorage, no vault
 * touch), and ProtectedRoute routes that state to the honest
 * "Vault locked (no key)" surface — re-entry via the recovery phrase plus
 * the self-service exits — instead of the dead-end password form.
 * That is the designed outcome, not a bug.
 */

import { type FormEvent, useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { ResetSignInRequired, ResetTwoFactorStep } from '../components/reset-two-factor-step'
import {
  setPasswordOpaqueRegister,
  setPasswordFinalize,
  ApiError,
  clearLegacyBearer,
} from '../lib/api'
import { isPasswordSetSignInRequired } from '../lib/reset-2fa'
import { opaqueRegistrationStart, opaqueRegistrationFinish, toBase64 } from '../lib/crypto'
import { markPasswordResetCompleted } from '../lib/post-reset-lock'
import { useAuth } from '../lib/auth-context'

type Step = 'form' | 'two-factor' | 'sign-in-required' | 'success'

/** Pure password validation shared with the harness tests (no React). */
export function validateSetPasswordInput(pw: string, confirm: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw !== confirm) return 'Passwords do not match.'
  return null
}

/** Map honest server statuses to honest copy (pure, testable). */
export function describeSetPasswordError(err: unknown): string {
  // Task 1803 — the password WAS set (409 after the rotation); never tell the
  // person the link is invalid. The page shows the sign-in screen for this, the
  // string is for any caller that only has text.
  if (isPasswordSetSignInRequired(err)) return 'Your new password is set. Sign in to continue.'
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return 'Too many attempts. For security, wait an hour and try again.'
    }
    if (err.status === 400 || err.status === 401 || err.status === 404) {
      return 'This link is invalid, expired, or already used. Request a new one from the forgot-password page.'
    }
  }
  return err instanceof Error ? err.message : 'Setting the password failed. Please try again.'
}

// Re-exported so the harness tests can construct the exact error type the
// page branches on without reaching into @beebeeb/shared themselves.
export { ApiError } from '../lib/api'

export function SetPassword() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [step, setStep] = useState<Step>('form')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Task 1803 — the 2FA challenge handed back by the finalize call, and why the
  // code step closed (sign-in-required screen detail).
  const [partialToken, setPartialToken] = useState<string | null>(null)
  const [closedDetail, setClosedDetail] = useState<string | undefined>(undefined)

  // Everything after the server opened a session for this device — shared by
  // the direct path (no 2FA) and the 2FA path (after /auth/2fa/verify).
  const finishWithSession = useCallback(async () => {
    // The fresh session also arrived as the bb_session cookie; drop the
    // redundant legacy bearer slot like every other auth-completing flow.
    clearLegacyBearer()

    // Task 1704 SLICE 2 — stamp the post-reset marker for THIS tab: the
    // credential was just replaced, so the device's wrapped vault (if
    // any) can no longer open under anything the user knows here. The
    // wrapped vault itself is NEVER cleared — the old password may still
    // be remembered, and destroying the only local wrap would be a
    // data-loss bug. ProtectedRoute reads this marker to route to the
    // honest locked-state surface (VaultLockedNoKey) instead of the
    // dead-end password form. No key-context / vault touch (slice scope).
    markPasswordResetCompleted()

    // The vault is still wrapped under the OLD password — do NOT touch
    // key-context or setMasterKey here. Re-wrapping is the
    // /recover-with-phrase ceremony (SLICE 3), reached from the honest
    // locked-state surface this marker routes to.
    setStep('success')
    await refreshUser()
  }, [refreshUser])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError('')

      if (!token) {
        setError('This link is incomplete.')
        return
      }
      const validationError = validateSetPasswordInput(newPassword, confirmPassword)
      if (validationError) {
        setError(validationError)
        return
      }

      setSubmitting(true)
      try {
        // 1. OPAQUE registration start (client-side, password never leaves
        //    the device except inside the OPAQUE envelope).
        const regStart = await opaqueRegistrationStart(newPassword)

        // 2. Bridge leg — server validates the one-time token (unused,
        //    unexpired) and returns the OPAQUE server message bound to the
        //    account email.
        const { server_message } = await setPasswordOpaqueRegister(token, toBase64(regStart.message))

        // 3. OPAQUE registration finish (client-side) — produces the upload.
        const serverMsg = Uint8Array.from(atob(server_message), (c) => c.charCodeAt(0))
        const regUpload = await opaqueRegistrationFinish(regStart.state, newPassword, serverMsg)

        // 4. Finalize — consumes the token atomically, replaces the record,
        //    deletes ALL sessions. No 2FA: mints the fresh session for THIS
        //    device. 2FA enabled (task 1803): NO session — a partial token for
        //    the code step. Deliberately NO recovery_check / x25519_public_key
        //    here: an email-only reset never rotates the set-once vault-key
        //    bindings.
        const result = await setPasswordFinalize(token, toBase64(regUpload))

        if (result.requires_2fa) {
          setPartialToken(result.partial_token)
          setStep('two-factor')
          return
        }
        await finishWithSession()
      } catch (err) {
        if (isPasswordSetSignInRequired(err)) {
          setClosedDetail(undefined)
          setStep('sign-in-required')
          return
        }
        setError(describeSetPasswordError(err))
      } finally {
        setSubmitting(false)
      }
    },
    [token, newPassword, confirmPassword, finishWithSession],
  )

  if (!token) {
    return (
      <AuthShell title="This link is incomplete" hideTrust>
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line mb-4">
          <Icon name="shield" size={14} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            The link is missing its one-time token. Request a fresh link from the
            forgot-password page.
          </p>
        </div>
        <Link to="/forgot-password">
          <BBButton variant="amber" size="lg" className="w-full justify-center">
            Request a new link
          </BBButton>
        </Link>
        <div className="text-center mt-4">
          <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (step === 'two-factor' && partialToken) {
    return (
      <ResetTwoFactorStep
        partialToken={partialToken}
        onVerified={finishWithSession}
        onClosed={(reason) => {
          setPartialToken(null)
          setClosedDetail(reason)
          setStep('sign-in-required')
        }}
      />
    )
  }

  if (step === 'sign-in-required') {
    return <ResetSignInRequired detail={closedDetail} />
  }

  if (step === 'success') {
    return (
      <AuthShell
        title="Password set"
        subtitle="Sign in with your new password from now on."
        hideTrust
      >
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-amber-bg border border-amber/20 rounded-md">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            Your vault stays locked until you re-enter your recovery phrase or
            vault key. Existing files remain encrypted — unlock the vault with
            your phrase to re-secure it under the new password.
          </p>
        </div>
        <BBButton
          variant="amber"
          size="lg"
          className="w-full justify-center"
          onClick={() => navigate('/', { replace: true })}
        >
          Continue
        </BBButton>
        <div className="text-center mt-4">
          <Link to="/recover-with-phrase" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            Unlock your vault with your recovery phrase
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a new password for your account."
      hideTrust
    >
      <div className="flex items-start gap-2.5 p-3 mb-4 bg-amber-bg border border-amber/20 rounded-md">
        <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
        <p className="text-xs text-ink-2 leading-relaxed">
          Set a new password. Your vault stays locked until you re-enter your
          recovery phrase or vault key.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <BBInput
            label="New password"
            type="password"
            autoFocus
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              setError('')
            }}
          />
          <BBInput
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setError('')
            }}
          />
        </div>

        {error && <p className="text-xs text-red mt-3">{error}</p>}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-5"
          disabled={submitting || !newPassword || !confirmPassword}
        >
          {submitting ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
              Setting…
            </>
          ) : (
            'Set new password'
          )}
        </BBButton>
      </form>

      <div className="text-center mt-4">
        <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}