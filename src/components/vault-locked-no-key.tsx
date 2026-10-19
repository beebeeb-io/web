import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from './auth-shell'
import { BBButton, BBCheckbox, BBInput, Icon } from '@beebeeb/shared'
import { EraseRequestCard } from './erase-request-card'
import { RestoreFromErase } from './restore-from-erase'
import { sharedEraseStatus } from '../lib/erase-status-store'
import { StepUpAuth } from './step-up-auth'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { DeviceProvision } from './device-provision'
import { prepareInPlacePhraseUnlock } from '../lib/locked-phrase-unlock'
import {
  ApiError,
  cancelEraseRequest,
  cancelSubscription,
  createEraseRequest,
  deleteAccountPermanently,
  getEraseRequest,
} from '../lib/api'
import {
  FOLLOW_UP_MS,
  applyCancelled,
  applyRequest,
  attachEraseRefresh,
  cancelErase,
  cancelNote,
  createLatestGate,
  eraseCard,
  eraseRefreshPlan,
  keepCheckAgain,
  parseEraseStatus,
  parseTypedCount,
  requestErase,
  requestedNote,
  restoreSlotFor,
  type CheckAgainMode,
  type EraseExecuted,
  type EraseDeps,
  type EraseStatus,
} from '../lib/erase-request'
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
 *   2. Self-service exits, each behind an explicit inline confirmation gate:
 *        - Cancel subscription  — POST /billing/cancel, no step-up needed.
 *        - Erase all files      — task 1918: a SERVER-side request, never a delete
 *          from the browser. Typed item count + password step-up; the server
 *          emails the account address at once with a confirmation link and a
 *          cancel link. Nothing counts down until the owner confirms (round 3,
 *          Guus 2026-10-18: "Verify link + 72 h"); 72 h after the confirmation
 *          every file moves to the TRASH (normal retention). Unconfirmed for
 *          24 h, the request lapses. This screen shows "check your email",
 *          then the due time and a Cancel button, or that the link expired.
 *          Guus, 2026-10-17: "Files should NEVER go missing" / "the code and
 *          all apps should just not delete random stuff" — this supersedes the
 *          1704 open-question #7 default ("explicit confirmation, no time
 *          delay"); the screen no longer calls /files/permanent at all.
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

/** The erase request transport (task 1918): the server decides, the browser only asks. */
const ERASE_DEPS: EraseDeps = { create: createEraseRequest, cancel: cancelEraseRequest, status: getEraseRequest }

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

  // ── exit 2: erase all files (task 1918: a server-side request) ──
  const [eraseStatus, setEraseStatus] = useState<EraseStatus | null>(null)
  const [eraseLoadError, setEraseLoadError] = useState('')
  const [eraseTyped, setEraseTyped] = useState('')
  const [eraseBusy, setEraseBusy] = useState(false)
  const [eraseNote, setEraseNote] = useState('')
  const [eraseError, setEraseError] = useState('')
  // The last action's outcome is unknown (round 2): offer "Check again". Round 4b: what it waits
  // for — the request to show up (an unknown request) or to be gone (an unknown cancel).
  const [eraseCheckAgain, setEraseCheckAgain] = useState<CheckAgainMode>(null)
  // Round 4: after each action the outcome takes the focus (the card watches this).
  const [eraseFocusTick, setEraseFocusTick] = useState(0)
  // Round 4d: once the person acted on the restore block it stays with that erase until their
  // next action (a refusal's words survive a status that no longer carries the erase).
  const [restorePin, setRestorePin] = useState<EraseExecuted | null>(null)

  // ── exit 3: delete account ──
  const [accountGate, setAccountGate] = useState(false)
  const [accountConfirm, setAccountConfirm] = useState('')
  const [accountState, setAccountState] = useState<ExitState>('idle')
  const [accountError, setAccountError] = useState('')

  // The one step-up dialog: 'erase' files the erase request; 'account' opens
  // the account-deletion flow.
  type StepUpKind = 'erase' | 'account'
  const [stepUpKind, setStepUpKind] = useState<StepUpKind | null>(null)

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

  // Async results (a status read, a POST) can land after the screen is gone; they are dropped
  // then instead of being applied to an unmounted component.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // A failed read keeps the last status on screen AND says so (round 2, web#174 review): the
  // card shows the error with a retry next to whatever it was showing.
  //
  // Round 4 (web#174 review): reads are sequenced. Focus, visibility, the poll and the refresh
  // after each action can overlap; only the newest read may apply its answer, and an action
  // whose answer was just applied supersedes every read started before it. "Check again" stays
  // until the request shows up or the follow-up read (`FOLLOW_UP_MS` after an unknown outcome)
  // has run.
  //
  // Round 4b: this gate is THE sequencing authority of the screen: the restore block reads and
  // supersedes through it too. A follow-up read that a newer read or action superseded schedules
  // one more follow-up (it never ran); a click on "Check again" counts as the follow-up.
  const eraseGate = useRef(createLatestGate())
  const scheduleFollowUpRef = useRef<() => void>(() => {})
  const loadEraseStatus = useCallback(async (opts: { followUp?: boolean } = {}) => {
    const followUp = opts.followUp === true
    const seq = eraseGate.current.begin()
    try {
      const status = parseEraseStatus(await getEraseRequest())
      if (!status) throw new Error('unexpected answer')
      if (!alive.current) return
      if (!eraseGate.current.isLatest(seq)) {
        if (followUp) scheduleFollowUpRef.current()
        return
      }
      setEraseStatus(status)
      setEraseLoadError('')
      setEraseCheckAgain((mode) => keepCheckAgain(mode, status, followUp))
    } catch {
      if (!alive.current || !eraseGate.current.isLatest(seq)) return
      setEraseLoadError('We could not check what this account holds. Try again.')
      if (followUp) setEraseCheckAgain(null)
    }
  }, [])

  // One follow-up read after an unknown outcome (round 4).
  const followUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleFollowUp = useCallback(() => {
    if (followUpTimer.current) clearTimeout(followUpTimer.current)
    followUpTimer.current = setTimeout(() => {
      followUpTimer.current = null
      void loadEraseStatus({ followUp: true })
    }, FOLLOW_UP_MS)
  }, [loadEraseStatus])
  scheduleFollowUpRef.current = scheduleFollowUp
  useEffect(() => () => {
    if (followUpTimer.current) clearTimeout(followUpTimer.current)
  }, [])

  useEffect(() => {
    void loadEraseStatus()
  }, [loadEraseStatus])

  // Keep the card in step with the server while the screen stays open (round 2): on focus and
  // when the tab becomes visible, just after the due time, and every minute while a request is
  // pending or moving (a cancel by the email link or another session shows up too).
  const shownCard = eraseStatus ? eraseCard(eraseStatus) : null
  const refreshKey = shownCard?.kind === 'pending' || shownCard?.kind === 'moving'
    ? `${shownCard.kind}:${shownCard.request.due_at}`
    : (shownCard?.kind ?? 'none')
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    return attachEraseRefresh({
      win: window,
      doc: document,
      refresh: () => void loadEraseStatus(),
      plan: eraseRefreshPlan(shownCard, Date.now()),
    })
    // The plan only changes with the card's kind and due time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, loadEraseStatus])

  const runEraseRequest = useCallback(async (token: string) => {
    const count = parseTypedCount(eraseTyped)
    if (count === null) return
    setRestorePin(null)
    setEraseBusy(true)
    setEraseError('')
    setEraseNote('')
    const outcome = await requestErase(ERASE_DEPS, count, token)
    if (!alive.current) return
    setEraseBusy(false)
    // Round 4c: the app's cached status predates this action.
    sharedEraseStatus.invalidate()
    setEraseFocusTick((n) => n + 1)
    if (outcome.kind === 'requested') {
      setEraseTyped('')
      // What the server returned is shown at once; the refresh only confirms it. Reads started
      // before this answer are stale now (round 4).
      eraseGate.current.supersede()
      setEraseStatus((s) => applyRequest(s, outcome.request))
      // Round 4b: only a request this POST created sent an email just now.
      setEraseNote(requestedNote(outcome))
      void loadEraseStatus()
    } else if (outcome.kind === 'count_changed') {
      setEraseTyped('')
      setEraseStatus((s) => (s ? { ...s, live_items: outcome.liveItems } : s))
      setEraseNote(`The number changed: the account now holds ${outcome.liveItems}. Nothing was scheduled. Type the new number to continue.`)
    } else if (outcome.kind === 'unknown' || outcome.kind === 'in_progress') {
      setEraseNote(outcome.message)
      setEraseCheckAgain('request')
      void loadEraseStatus()
      scheduleFollowUp()
    } else {
      setEraseError(outcome.message)
    }
  }, [eraseTyped, loadEraseStatus, scheduleFollowUp])

  const handleEraseCancel = useCallback(async () => {
    setRestorePin(null)
    setEraseBusy(true)
    setEraseError('')
    setEraseNote('')
    const shownId = eraseStatus?.request?.id ?? null
    const outcome = await cancelErase(ERASE_DEPS, shownId)
    if (!alive.current) return
    setEraseBusy(false)
    // Round 4c: the app's cached status predates this action.
    sharedEraseStatus.invalidate()
    setEraseFocusTick((n) => n + 1)
    // Whatever the outcome says is newer than any read still in flight (round 4).
    eraseGate.current.supersede()
    if (outcome.kind === 'cancelled') {
      setEraseStatus(applyCancelled)
      setEraseNote(cancelNote(outcome) ?? '')
    } else if (outcome.kind === 'nothing_pending' || outcome.kind === 'already_executed' || outcome.kind === 'replaced') {
      // Round 4: a 404 says what the server holds NOW (it may have run, or a newer request may be
      // pending: round 4b), from a fresh read.
      setEraseStatus(outcome.status)
      setEraseNote(cancelNote(outcome) ?? '')
    } else if (outcome.kind === 'already_started') {
      setEraseNote(cancelNote(outcome) ?? '')
    } else if (outcome.kind === 'still_pending') {
      setEraseStatus((s) => applyRequest(s, outcome.request))
      setEraseError(outcome.message)
    } else {
      setEraseNote(outcome.message)
      setEraseCheckAgain('cancel')
      scheduleFollowUp()
    }
    void loadEraseStatus()
  }, [eraseStatus, loadEraseStatus, scheduleFollowUp])

  // Round 4: "Restore everything from the erase". Round 4b: the block reads through THIS
  // screen's gate (one sequencing authority), so what it hands back started after every action;
  // when nothing of the erase is left in the trash the screen reads the status again, so the card
  // stops saying the files are in the trash.
  //
  // Round 4c: a block-read status is applied exactly like a screen read (it clears a load error
  // and takes part in "Check again"). It is not a follow-up read: a screen follow-up that a block
  // poll superseded reschedules itself (`loadEraseStatus`), so "Check again" still gets its own
  // follow-up.
  const applyRestoreStatus = useCallback((status: EraseStatus) => {
    setEraseStatus(status)
    setEraseLoadError('')
    setEraseCheckAgain((mode) => keepCheckAgain(mode, status, false))
  }, [])
  const reloadAfterRestore = useCallback(() => {
    void loadEraseStatus()
  }, [loadEraseStatus])
  const lastExecuted = eraseStatus?.last_executed ?? null
  const slotExecuted = restoreSlotFor(restorePin, lastExecuted)
  const restoreSlot = slotExecuted
    ? (
      <RestoreFromErase
        key={slotExecuted.id}
        executed={slotExecuted}
        gate={eraseGate.current}
        onStatus={applyRestoreStatus}
        onDone={reloadAfterRestore}
        onAction={() => setRestorePin(slotExecuted)}
      />
    )
    : null

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
    setStepUpKind(null)
    if (kind === 'erase') void runEraseRequest(token)
    if (kind === 'account') void runAccountDeletion(token)
  }, [stepUpKind, runEraseRequest, runAccountDeletion])

  const handleStepUpClosed = useCallback(() => {
    setStepUpKind(null)
  }, [])

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
          erase the files, or delete the account. Each asks for its
          confirmation first.
        </p>
        <p className="text-[12px] text-ink-4 leading-relaxed mb-4">
          We can't show a readable list of your files here — names are
          encrypted — so per-file deletion isn't offered in this state. Use
          Erase all files to move everything to the trash, or unlock with your
          phrase to delete files individually.
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

        {/* Exit 2 — erase all files: a server-side request (task 1918) */}
        <EraseRequestCard
          card={shownCard}
          loadError={eraseLoadError}
          email={user?.email ?? null}
          cooldownHours={eraseStatus?.cooldown_hours ?? 72}
          retentionDays={eraseStatus?.trash_retention_days ?? 30}
          typed={eraseTyped}
          onTypedChange={setEraseTyped}
          onRequest={() => setStepUpKind('erase')}
          onCancel={() => void handleEraseCancel()}
          onRetryLoad={() => void loadEraseStatus()}
          busy={eraseBusy}
          note={eraseNote}
          error={eraseError}
          checkAgain={eraseCheckAgain !== null}
          onCheckAgain={() => void loadEraseStatus({ followUp: true })}
          restore={restoreSlot}
          focusTick={eraseFocusTick}
        />

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
            : `Enter your password to request the erase. We then email you a link to confirm it: nothing moves unless you do, and then not for ${eraseStatus?.cooldown_hours ?? 72} hours.`
        }
        submitLabel={
          stepUpKind === 'account' ? 'Delete account' : 'Request erase'
        }
        onConfirmed={handleStepUpConfirmed}
        onClose={handleStepUpClosed}
      />
    </AuthShell>
  )
}