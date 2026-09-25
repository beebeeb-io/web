import { type FormEvent, type KeyboardEvent, useCallback, useRef, useState } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { recoverFromPhrase, computeRecoveryCheck, toBase64, zeroize } from '../lib/crypto'
import { recoveredKeyMatchesAccount } from '../lib/recovery-validation'
import { useKeys } from '../lib/key-context'
import { verifyRecoveryCheck } from '../lib/api'
import { WORD_COUNT, distributeWords, shouldWrapWithPassword, type ProvisionAuthMethod } from '../lib/device-provision-logic'

// Task 1528 (Guus ruling, 2026-09-25): "username + password OR username +
// passkey THEN the mnemonic (prefer to have just 12 inputs like on the mac
// app), remove scan QR for now". This screen no longer offers a Passkey tab
// (login.tsx already ran the PRF/escrow auto-unlock before ever reaching
// here — a second passkey prompt here was redundant by construction) or a
// Scan QR tab (unverified; QR generation on the settings side and the
// underlying src/lib/qr-crypto.ts module are left in place, just with no
// entry point into this screen for now). The only path is the 12-word
// recovery phrase, modeled on repos/desktop/src/Onboarding.tsx's UnlockStep.

interface DeviceProvisionProps {
  /**
   * The password proven via a successful OPAQUE handshake, or '' when this
   * device was reached via a passkey sign-in (login.tsx's
   * handlePasskeyLogin never populates the `password` state field). Only
   * meaningful when `authMethod === 'opaque'` — see `shouldWrapWithPassword`
   * in device-provision-logic.ts for why `authMethod` (not this field's
   * mere truthiness) decides how the recovered master key is persisted.
   */
  password: string
  /**
   * How login.tsx proved identity before reaching this screen. Passed
   * explicitly (task 1529 continuation, web #73) rather than inferred from
   * `password` — see `shouldWrapWithPassword`'s doc comment for the exact
   * stale-password failure this prevents.
   */
  authMethod: ProvisionAuthMethod
  email?: string
  onProvisioned: () => void
}

export function DeviceProvision({ password, authMethod, onProvisioned }: DeviceProvisionProps) {
  const { setMasterKey, setMasterKeyDirect } = useKeys()

  const [words, setWords] = useState<string[]>(() => Array.from({ length: WORD_COUNT }, () => ''))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const wordRefs = useRef<Array<HTMLInputElement | null>>([])

  const filledCount = words.filter((w) => w.trim()).length
  const canRestore = filledCount === WORD_COUNT

  // Fill starting at `index` — unless the paste is a full 12-word phrase,
  // which always fills every box from the start regardless of which box
  // received it (distributeWords, task 1529 continuation item 8).
  const applyWords = useCallback((index: number, rawWords: string[]) => {
    let changed = false
    let nextFocusIndex = index
    setWords((current) => {
      const result = distributeWords(current, index, rawWords, WORD_COUNT)
      changed = result.words !== current
      nextFocusIndex = result.nextFocusIndex
      return result.words
    })
    // distributeWords is a no-op (returns the SAME array reference) when
    // rawWords cleans to nothing — skip the error-clear + focus move then,
    // matching the original early-return behavior.
    if (!changed) return
    setError('')
    requestAnimationFrame(() => wordRefs.current[nextFocusIndex]?.focus())
  }, [])

  const updateWord = useCallback((index: number, value: string) => {
    if (/\s/.test(value)) {
      applyWords(index, value.split(/\s+/))
      return
    }
    setError('')
    setWords((current) => current.map((w, i) => (i === index ? value.toLowerCase() : w)))
  }, [applyWords])

  const onWordKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      wordRefs.current[Math.min(index + 1, WORD_COUNT - 1)]?.focus()
      return
    }
    if (e.key === 'Backspace' && !words[index] && index > 0) {
      wordRefs.current[index - 1]?.focus()
    }
  }, [words])

  async function handleRestore(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!canRestore) {
      setError(`Enter all 12 words. You entered ${filledCount}.`)
      return
    }

    setSubmitting(true)

    // Owns the derived key until it's either handed off to setMasterKey/
    // setMasterKeyDirect (which takes over ownership — set to null right
    // after) or the function exits any other way (wrong phrase, thrown
    // error) — the `finally` below zeroes it in every one of those cases.
    // Crypto hygiene rule: zero key material from memory after use.
    let masterKey: Uint8Array | null = null

    try {
      const trimmed = words.map((w) => w.trim().toLowerCase()).join(' ')
      masterKey = await recoverFromPhrase(trimmed)

      // recoverFromPhrase derives *a* master key from ANY checksum-valid BIP39
      // phrase — it does NOT prove the phrase belongs to this account. Without a
      // check, a wrong phrase would be wrapped + persisted into this device's
      // local IndexedDB vault (setMasterKey → vault.ts wrapAndStore), poisoning
      // the device into a can't-decrypt-anything state (task 0874). The user is
      // already authenticated here, so validate the derived key against the
      // account's server-stored recovery_check BEFORE persisting/unlocking.
      const matches = await recoveredKeyMatchesAccount(masterKey, {
        computeRecoveryCheckB64: async (k) => toBase64(await computeRecoveryCheck(k)),
        verifyRecoveryCheck,
      })
      if (!matches) {
        setError('Incorrect recovery phrase. Check your words and try again.')
        return
      }

      // Task 1529 (P0): a passkey sign-in reaches this screen with
      // password === '' (never collected on that path). Wrapping the
      // master key under an empty-string secret (setMasterKey → vault.ts
      // wrapAndStore) would let anyone with read access to this browser's
      // IndexedDB unwrap it — vault.ts now throws rather than allow that.
      // Guus's ruling (2026-09-25, "Session only"): on the passkey path,
      // keep the key in memory for this session only and persist nothing;
      // the device re-authenticates via passkey PRF (or this phrase screen
      // again) on the next visit. Only the password-authenticated path
      // wraps + persists a local vault.
      //
      // shouldWrapWithPassword decides from the explicit `authMethod` prop,
      // NOT from `password`'s mere truthiness — see its doc comment
      // (device-provision-logic.ts) for the stale-password lockout this
      // prevents (continuation item 3).
      if (shouldWrapWithPassword(authMethod, password)) {
        await setMasterKey(masterKey, password)
      } else {
        setMasterKeyDirect(masterKey)
      }
      masterKey = null // ownership transferred — do not zero below
      onProvisioned()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Invalid recovery phrase. Check your words and try again.',
      )
    } finally {
      if (masterKey) zeroize(masterKey)
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Set up this device"
      subtitle="This device doesn't have your encryption keys yet. Restore them to continue."
    >
      <form onSubmit={handleRestore}>
        <label className="block text-xs font-medium text-ink-2 mb-2">
          Recovery phrase
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {words.map((word, index) => (
            <label
              key={index}
              className="flex items-center gap-1.5 min-w-0 border border-line rounded-md bg-paper px-2 py-2 transition-all focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep"
            >
              <span className="text-[10px] text-ink-4 font-mono w-3.5 shrink-0 text-right select-none">
                {index + 1}
              </span>
              <input
                ref={(node) => { wordRefs.current[index] = node }}
                aria-label={`Recovery word ${index + 1}`}
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                // Continuation item 9 (optional): stop 1Password/LastPass
                // from offering to fill these boxes as a password field.
                data-1p-ignore
                data-lpignore="true"
                disabled={submitting}
                value={word}
                onChange={(ev) => updateWord(index, ev.currentTarget.value)}
                onKeyDown={(ev) => onWordKeyDown(ev, index)}
                onPaste={(ev) => {
                  ev.preventDefault()
                  applyWords(index, ev.clipboardData.getData('text').split(/\s+/))
                }}
                className="w-full min-w-0 bg-transparent text-[13px] font-mono text-ink placeholder:text-ink-4 outline-none"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-3 mt-2 mb-4">
          Enter the 12 words you saved when you created your account. Paste all 12 into any box to fill them in at once.
        </p>

        {error && (
          <p className="text-xs text-red mb-3">{error}</p>
        )}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full"
          disabled={submitting || !canRestore}
        >
          <Icon name="key" size={14} className="mr-2" />
          {submitting ? 'Restoring vault...' : 'Restore vault'}
        </BBButton>
      </form>
    </AuthShell>
  )
}
