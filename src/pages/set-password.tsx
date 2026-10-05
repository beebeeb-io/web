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
 * until the user re-enters their recovery phrase. Task 1810: that phrase step
 * is the next screen of THIS page (LoginProvisionBranch), not a detour through
 * /recover-with-phrase (a password reset). The new password is already proven
 * (the server just replaced the OPAQUE record and opened a session), so the
 * phrase re-seals the key on this device under it. The vault sealed under the
 * previous password is not touched here; it is deleted at the next sign-in that
 * cannot open it (src/lib/sign-in-unlock.ts), or overwritten by the phrase step.
 * The page stamps the post-reset marker (src/lib/post-reset-lock.ts) so a
 * person who lost the phrase can reach the self-service exits ("I've lost my
 * recovery phrase") and so a reload lands on the honest locked-state surface.
 */

import { type FormEvent, useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { ResetSignInRequired, ResetTwoFactorStep } from '../components/reset-two-factor-step'
import { LoginProvisionBranch } from '../components/login-provision-branch'
import {
  setPasswordOpaqueRegister,
  setPasswordFinalize,
  ApiError,
  clearLegacyBearer,
} from '../lib/api'
import { isPasswordSetSignInRequired } from '../lib/reset-2fa'
import { opaqueRegistrationStart, opaqueRegistrationFinish, toBase64 } from '../lib/crypto'
import { markPasswordResetCompleted } from '../lib/post-reset-lock'
import { completeResetSession } from '../lib/reset-session'
import { useKeys } from '../lib/key-context'
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
  const { lock } = useKeys()

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
    // Task 1704 SLICE 2 — the post-reset marker is stamped for THIS tab: the
    // credential was just replaced, so the device's wrapped vault (if any) can
    // no longer open under anything the user knows here. ProtectedRoute reads
    // it to route a reload to the honest locked-state surface. The wrapped
    // vault itself is not cleared here (the phrase step overwrites it; the
    // next sign-in that cannot open it deletes it).
    //
    // Task 1810 round 2 (P2-2): lock() any key still resident from before and
    // load the session's user BEFORE the phrase screen renders, so the
    // recovered key can never be tagged under a previous account's id. See
    // src/lib/reset-session.ts.
    const outcome = await completeResetSession({
      clearLegacyBearer,
      lock,
      markPasswordResetCompleted,
      refreshUser,
    })
    if (outcome === 'failed') {
      setClosedDetail('Your password was set, but this device could not open the session.')
      setStep('sign-in-required')
      return
    }
    setStep('success')
  }, [refreshUser, lock])

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
    // Task 1810: the password is set and the session is open. The key on this
    // device (if any) is sealed under the PREVIOUS password, so the next step is
    // the recovery phrase right here — the new password is already proven, so it
    // seals the vault. This used to be a "Continue" button into a "Vault locked"
    // screen whose phrase button opened the password-reset page again.
    return (
      <LoginProvisionBranch
        password={newPassword}
        authMethod="opaque"
        notice="Your new password is set. Enter your recovery phrase to unlock your vault on this device and seal it under the new password."
        onProvisioned={() => navigate('/', { replace: true })}
      />
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