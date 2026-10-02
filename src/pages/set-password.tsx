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
 * HONEST COPY (the governing amendment, decisions/2026-10-02-…-policy.md):
 * setting a new password restores ACCOUNT access; the VAULT stays locked
 * until the user re-enters their recovery phrase or vault key — which then
 * re-wraps the key under the new password via /recover-with-phrase (the
 * re-wrap ceremony is SLICE 3; this page deliberately does not touch
 * key-context or the vault).
 *
 * After success the app lands on the drive with a fresh session; the vault
 * is still wrapped under the old password, so unlockVault reports
 * wrong_password and the UI shows the honest "Vault locked" state (1693).
 * That is the designed outcome, not a bug.
 */

import { type FormEvent, useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import {
  setPasswordOpaqueRegister,
  setPasswordFinalize,
  ApiError,
  clearLegacyBearer,
} from '../lib/api'
import { opaqueRegistrationStart, opaqueRegistrationFinish, toBase64 } from '../lib/crypto'
import { useAuth } from '../lib/auth-context'

type Step = 'form' | 'success'

/** Pure password validation shared with the harness tests (no React). */
export function validateSetPasswordInput(pw: string, confirm: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw !== confirm) return 'Passwords do not match.'
  return null
}

/** Map honest server statuses to honest copy (pure, testable). */
export function describeSetPasswordError(err: unknown): string {
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
        //    deletes ALL sessions, mints the fresh session for THIS device.
        //    Deliberately NO recovery_check / x25519_public_key here: an
        //    email-only reset never rotates the set-once vault-key bindings.
        await setPasswordFinalize(token, toBase64(regUpload))

        // The fresh session also arrived as the bb_session cookie; drop the
        // redundant legacy bearer slot like every other auth-completing flow.
        clearLegacyBearer()

        // The vault is still wrapped under the OLD password — do NOT touch
        // key-context or setMasterKey here. The honest locked state (1693)
        // takes over on the drive; re-wrapping is the /recover-with-phrase
        // ceremony (SLICE 3).
        setStep('success')
        await refreshUser()
      } catch (err) {
        setError(describeSetPasswordError(err))
      } finally {
        setSubmitting(false)
      }
    },
    [token, newPassword, confirmPassword, refreshUser],
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