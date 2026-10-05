import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from './auth-shell'
import { BBButton, BBCheckbox, BBInput, Icon } from '@beebeeb/shared'
import { StepUpAuth } from './step-up-auth'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { DeviceProvision } from './device-provision'
import { prepareInPlacePhraseUnlock } from '../lib/locked-phrase-unlock'
import {
  ApiError,
  bulkPermanentDelete,
  bulkTrashFiles,
  cancelSubscription,
  deleteAccountPermanently,
  listAllFiles,
} from '../lib/api'
import { executeDeleteAllData, type WipeResult } from '../lib/locked-state-exits'
import { clearPostResetLock } from '../lib/post-reset-lock'

/**
 * Task 1704 SLICE 2 — the honest locked state for a device whose vault key is
 * unreachable after the SLICE-1 email password reset (decision doc
 * D-2026-10-02, Amendment + §4c + §6).
 *
 * Sibling design language to 1693's VaultLockedImpersonated (which stays
 * reserved for admin support sessions): canonical "Vault locked" title,
 * metadata-only, ink on paper, no emojis, amber reserved for the encryption
 * re-entry CTA. The difference is the audience: this user CAN act on their own
 * account, so — per the ruling's harm-reduction goal ("no more invoicing
 * locked-out users with no exit") — the surface offers:
 *
 *   1. Primary re-entry: the 12-word recovery phrase via the canonical
 *      /recover-with-phrase route (which re-wraps the vault under the new
 *      password and makes this device normal again).
 *   2. Self-service exits, each behind an explicit inline confirmation gate
 *      (ruling open-question #7 default: explicit confirmation, no time delay
 *      in release 1):
 *        - Cancel subscription  — POST /billing/cancel, no step-up needed.
 *        - Delete all data      — trash + bulk permanent delete, one single-use
 *          step-up token per server batch, verified by re-listing the server.
 *        - Delete account       — existing account deletion step-up (the fresh
 *          password works for it); ends logged out.
 *
 * Per-file blind deletion is deliberately NOT offered: file names are
 * encrypted (ciphertext) and a row of unidentifiable deletions is not honest
 * self-service — the intro says so instead of hiding the gap.
 *
 * The zero-knowledge boundary is the whole point of the copy: the vault cannot
 * be unlocked on this device without the vault key, by anyone — by design.
 */

type ExitState = 'idle' | 'working' | 'done' | 'error'

interface VaultLockedNoKeyProps {
  /** Escape hatch: show the normal password form (the old password may still
   *  be remembered). Clears the post-reset marker, then calls this. */
  onTryPreviousPassword?: () => void
  /** Show the phrase screen in place (the sign-in / set-password steps, which
   *  already hold the proven password). Without it — a session with no password
   *  in hand — the button drops only this account's stale password-sealed entry
   *  and shows the phrase screen in place (session-only key, nothing persisted,
   *  no sign-out, a passkey vault is untouched). Task 1810: it must never open
   *  /recover-with-phrase, which is a password RESET. */
  onUnlockWithPhrase?: () => void
}

export function VaultLockedNoKey({ onTryPreviousPassword, onUnlockWithPhrase }: VaultLockedNoKeyProps) {
  const { logout, user } = useAuth()
  const { discardStalePasswordVault } = useKeys()
  const navigate = useNavigate()
  // Task 1810 round 2 (P2-3): with no password in hand the phrase screen is
  // shown IN PLACE. The button no longer signs out: logout() wipes the whole
  // local vault store (a passkey-sealed vault included), which a button labelled
  // as an unlock must never do silently.
  const [phraseInPlace, setPhraseInPlace] = useState(false)
  const handleUnlockWithPhrase = useCallback(async () => {
    if (onUnlockWithPhrase) {
      onUnlockWithPhrase()
      return
    }
    await prepareInPlacePhraseUnlock({
      userId: user?.user_id ?? null,
      discardStalePasswordVault,
    })
    setPhraseInPlace(true)
  }, [onUnlockWithPhrase, user, discardStalePasswordVault])

  // ── exit 1: cancel subscription ──
  const [cancelGate, setCancelGate] = useState(false)
  const [cancelState, setCancelState] = useState<ExitState>('idle')
  const [cancelError, setCancelError] = useState('')
  const [cancelEndsOn, setCancelEndsOn] = useState<string | null>(null)

  // ── exit 2: delete all data ──
  const [wipeGate, setWipeGate] = useState(false)
  const [wipeState, setWipeState] = useState<ExitState>('idle')
  const [wipeProgress, setWipeProgress] = useState('')
  const [wipeError, setWipeError] = useState('')
  const [wipeResult, setWipeResult] = useState<WipeResult | null>(null)

  // ── exit 3: delete account ──
  const [accountGate, setAccountGate] = useState(false)
  const [accountConfirm, setAccountConfirm] = useState('')
  const [accountState, setAccountState] = useState<ExitState>('idle')
  const [accountError, setAccountError] = useState('')

  // The one step-up dialog (destructive exits share it): 'wipe' opens the
  // erase flow; 'wipe-continue' is a FRESH single-use token for an erase
  // batch beyond the first; 'account' opens the account-deletion flow.
  type StepUpKind = 'wipe' | 'wipe-continue' | 'account'
  const [stepUpKind, setStepUpKind] = useState<StepUpKind | null>(null)
  const pendingTokenRef = useRef<{ resolve: (t: string) => void; reject: (e: unknown) => void } | null>(null)

  const handleCancelSubscription = useCallback(async () => {
    if (!cancelGate || cancelState === 'working') return
    setCancelState('working')
    setCancelError('')
    try {
      const res = await cancelSubscription()
      setCancelEndsOn(res.cancel_at ?? null)
      setCancelState('done')
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Cancelling failed. Try again.')
      setCancelState('error')
    }
  }, [cancelGate, cancelState])

  /** A fresh single-use step-up token for an erase batch beyond the first.
   *  Opens the dialog and resolves when the user confirms; rejects if they
   *  close it, so the orchestration stops honestly instead of hanging. */
  const nextWipeToken = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      pendingTokenRef.current = { resolve, reject }
      setStepUpKind('wipe-continue')
    })
  }, [])

  const runWipe = useCallback(async (token: string) => {
    setWipeState('working')
    setWipeError('')
    setWipeResult(null)
    setWipeProgress('Looking up what is on the server…')
    try {
      const result = await executeDeleteAllData({
        listFileIds: async (trashed) => {
          const files = await listAllFiles(undefined, { trashed })
          return files.map((f) => f.id)
        },
        trashFiles: bulkTrashFiles,
        permanentDelete: bulkPermanentDelete,
        initialToken: token,
        nextToken: nextWipeToken,
        onProgress: setWipeProgress,
      })
      setWipeResult(result)
      setWipeState('done')
    } catch (e) {
      setWipeError(
        e instanceof Error
          ? `Erasing failed: ${e.message}. Anything already erased stays erased — try again to finish.`
          : 'Erasing failed. Anything already erased stays erased — try again to finish.',
      )
      setWipeState('error')
    }
  }, [nextWipeToken])

  const runAccountDeletion = useCallback(async (token: string) => {
    setAccountState('working')
    setAccountError('')
    try {
      await deleteAccountPermanently('DELETE', token)
      // Same sign-out routine as the settings delete-account page: the
      // account is gone server-side; clear the client session/key state and
      // leave. Ends logged-out, exactly as the ruling requires.
      await logout()
      navigate('/login', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setAccountError('Re-authentication expired. Try again.')
      } else {
        setAccountError(e instanceof Error ? e.message : 'Deleting the account failed. Try again.')
      }
      setAccountState('error')
    }
  }, [logout, navigate])

  const handleStepUpConfirmed = useCallback((token: string) => {
    const kind = stepUpKind
    if (kind === 'wipe-continue') {
      // Resolve the waiting orchestration; it closes its own bookkeeping.
      pendingTokenRef.current?.resolve(token)
      pendingTokenRef.current = null
      setStepUpKind(null)
      return
    }
    setStepUpKind(null)
    if (kind === 'wipe') void runWipe(token)
    if (kind === 'account') void runAccountDeletion(token)
  }, [stepUpKind, runWipe, runAccountDeletion])

  const handleStepUpClosed = useCallback(() => {
    if (stepUpKind === 'wipe-continue' && pendingTokenRef.current) {
      pendingTokenRef.current.reject(new Error('Confirmation cancelled'))
      pendingTokenRef.current = null
    }
    setStepUpKind(null)
  }, [stepUpKind])

  const handleTryPreviousPassword = useCallback(() => {
    clearPostResetLock()
    onTryPreviousPassword?.()
  }, [onTryPreviousPassword])

  const canDeleteAccount = accountGate && accountConfirm === 'DELETE' && accountState !== 'working'

  if (phraseInPlace) {
    return (
      <DeviceProvision
        password=""
        authMethod="passkey"
        notice="Your new password is set. Enter your recovery phrase to open your vault for this session. To keep it on this device, sign in again with your new password afterwards."
        onProvisioned={() => navigate('/', { replace: true })}
      />
    )
  }

  return (
    <AuthShell
      title="Vault locked"
      subtitle="This device can't open your vault — the vault key isn't in this browser."
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed">
        <div className="flex items-start gap-2.5">
          <Icon name="lock" size={16} className="text-ink-4 shrink-0 mt-0.5" />
          <p>
            Your files are end-to-end encrypted, and the vault key exists only
            in your own browser. The password you just set protects your
            account, but it can't unwrap the vault on this device — the key
            here is sealed with your previous password.
          </p>
        </div>
        <p>
          We can't restore access to your vault without your recovery phrase —
          by design. No one can: not support, not the server. There is no
          backdoor.
        </p>
      </div>

      {/* Primary re-entry — the canonical route; amber = the encryption CTA. */}
      <div className="mt-5">
        <BBButton variant="amber" size="lg" className="w-full" onClick={() => void handleUnlockWithPhrase()}>
          Unlock with recovery phrase
        </BBButton>
        <p className="text-[12px] text-ink-3 leading-relaxed mt-2.5">
          Your 12-word recovery phrase is the vault key.{' '}
          {onUnlockWithPhrase
            ? 'Entering it unlocks this device and re-secures the vault under your new password.'
            : 'Entering it opens the vault for this session only; sign in again with your new password to keep it on this device.'}
        </p>
        <p className="text-[11px] text-ink-4 leading-relaxed mt-1.5">
          Only ever enter the phrase on <span className="font-mono">beebeeb.io</span> —
          never in an email, never on another site.
        </p>
      </div>

      {/* Escape hatch — honest: the old password may still be remembered. */}
      {onTryPreviousPassword && (
      <button
        type="button"
        onClick={handleTryPreviousPassword}
        className="w-full mt-3 text-xs text-ink-3 hover:text-ink-2 transition-colors cursor-pointer"
      >
        Remember your previous password? Try it here
      </button>
      )}

      {/* ── Self-service exits ──────────────────────────────────────────── */}
      <div className="mt-6 pt-5 border-t border-line">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
          If you've lost your recovery phrase
        </div>
        <p className="text-[12.5px] text-ink-3 leading-relaxed mb-2">
          Without the vault key, the files can never be opened again — by
          anyone. You can still close things out properly: stop the billing,
          erase the data, or delete the account. Every exit below is final and
          asks for its confirmation first.
        </p>
        <p className="text-[12px] text-ink-4 leading-relaxed mb-4">
          We can't show a readable list of your files here — names are
          encrypted — so per-file deletion isn't offered in this state. Use
          Delete all data to erase everything, or unlock with your phrase to
          delete files individually.
        </p>

        {/* Exit 1 — cancel subscription */}
        <div className="rounded-lg border border-line bg-paper-2 px-3.5 py-3 mb-2.5">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="pause" size={13} className="text-ink-3 shrink-0" />
            <span className="text-[13px] font-medium text-ink">Cancel subscription</span>
          </div>
          <p className="text-[12px] text-ink-3 leading-relaxed mb-2.5">
            Stops future invoices for this account. Your files and account are
            not touched.
          </p>
          {cancelState !== 'done' && (
            <>
              <BBCheckbox
                checked={cancelGate}
                onChange={setCancelGate}
                label="I understand billing stops for this account."
                className="mb-2.5"
              />
              <BBButton
                type="button"
                variant="default"
                size="sm"
                onClick={handleCancelSubscription}
                disabled={!cancelGate || cancelState === 'working'}
              >
                {cancelState === 'working' ? 'Cancelling…' : 'Cancel billing'}
              </BBButton>
            </>
          )}
          {cancelState === 'done' && (
            <p className="text-[12px] text-ink-2">
              Billing cancelled.
              {cancelEndsOn && (
                <>
                  {' '}Ends <span className="font-mono text-[11px]">{cancelEndsOn.slice(0, 10)}</span>.
                </>
              )}
            </p>
          )}
          {cancelState === 'error' && <p className="text-[12px] text-red">{cancelError}</p>}
        </div>

        {/* Exit 2 — delete all data */}
        <div className="rounded-lg border border-line bg-paper-2 px-3.5 py-3 mb-2.5">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="trash" size={13} className="text-ink-3 shrink-0" />
            <span className="text-[13px] font-medium text-ink">Delete all data</span>
          </div>
          <p className="text-[12px] text-ink-3 leading-relaxed mb-2.5">
            Permanently erases every file and folder from the server.
            Everything is erased — there is no selection here.
          </p>
          {wipeState !== 'done' && (
            <>
              <BBCheckbox
                checked={wipeGate}
                onChange={setWipeGate}
                label="I understand every file is erased permanently and cannot be recovered."
                className="mb-2.5"
              />
              <BBButton
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setStepUpKind('wipe')}
                disabled={!wipeGate || wipeState === 'working'}
              >
                {wipeState === 'working' ? 'Erasing…' : 'Erase all files'}
              </BBButton>
            </>
          )}
          {/* A done state with leftovers (verification failed) must keep the
              retry affordance — "finished" is only claimed when the server
              was re-listed empty. */}
          {wipeState === 'done' && wipeResult && !wipeResult.verifiedEmpty && (
            <BBButton
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setStepUpKind('wipe')}
              disabled={!wipeGate}
            >
              Try again
            </BBButton>
          )}
          {wipeState === 'working' && wipeProgress && (
            <p className="text-[12px] text-ink-3 mt-2">{wipeProgress}</p>
          )}
          {wipeState === 'done' && wipeResult && (
            <p className="text-[12px] text-ink-2 mt-2">
              {wipeResult.verifiedEmpty
                ? `Every file is erased — the server holds no data for your account (${wipeResult.erased} erased).`
                : `Finished, but ${wipeResult.remaining} item(s) are still on the server. Try again to finish.`}
            </p>
          )}
          {wipeState === 'error' && <p className="text-[12px] text-red mt-2">{wipeError}</p>}
        </div>

        {/* Exit 3 — delete account */}
        <div className="rounded-lg border border-line bg-paper-2 px-3.5 py-3">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="users" size={13} className="text-ink-3 shrink-0" />
            <span className="text-[13px] font-medium text-ink">Delete account</span>
          </div>
          <p className="text-[12px] text-ink-3 leading-relaxed mb-2.5">
            Cancels the subscription, deletes the account, and signs you out.
            Encrypted data is shredded within 30 days. You can't sign back in.
          </p>
          {accountState !== 'done' && (
            <>
              <div className="mb-2">
                <BBInput
                  value={accountConfirm}
                  onChange={(e) => setAccountConfirm(e.currentTarget.value)}
                  placeholder="DELETE"
                  className="font-mono font-semibold"
                />
                <p className="text-[11px] text-ink-4 mt-1">Type DELETE to confirm</p>
              </div>
              <BBCheckbox
                checked={accountGate}
                onChange={setAccountGate}
                label="I understand my files cannot be recovered after deletion."
                className="mb-2.5"
              />
              <BBButton
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setStepUpKind('account')}
                disabled={!canDeleteAccount}
              >
                {accountState === 'working' ? 'Deleting…' : 'Delete permanently'}
              </BBButton>
            </>
          )}
          {accountState === 'error' && <p className="text-[12px] text-red mt-2">{accountError}</p>}
        </div>
      </div>

      <StepUpAuth
        open={stepUpKind !== null}
        description={
          stepUpKind === 'account'
            ? 'Enter your password to delete your account. This cannot be undone.'
            : stepUpKind === 'wipe-continue'
              ? 'Enter your password to continue erasing — each batch needs a fresh confirmation.'
              : 'Enter your password to erase every file. This cannot be undone.'
        }
        submitLabel={
          stepUpKind === 'account'
            ? 'Delete account'
            : stepUpKind === 'wipe-continue'
              ? 'Continue erasing'
              : 'Erase all files'
        }
        onConfirmed={handleStepUpConfirmed}
        onClose={handleStepUpClosed}
      />
    </AuthShell>
  )
}