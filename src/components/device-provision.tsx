import { type FormEvent, type KeyboardEvent, useCallback, useRef, useState } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { recoverFromPhrase, computeRecoveryCheck, toBase64 } from '../lib/crypto'
import { recoveredKeyMatchesAccount } from '../lib/recovery-validation'
import { useKeys } from '../lib/key-context'
import { verifyRecoveryCheck } from '../lib/api'

// Task 1528 (Guus ruling, 2026-09-25): "username + password OR username +
// passkey THEN the mnemonic (prefer to have just 12 inputs like on the mac
// app), remove scan QR for now". This screen no longer offers a Passkey tab
// (login.tsx already ran the PRF/escrow auto-unlock before ever reaching
// here — a second passkey prompt here was redundant by construction) or a
// Scan QR tab (unverified; QR generation on the settings side and the
// underlying src/lib/qr-crypto.ts module are left in place, just with no
// entry point into this screen for now). The only path is the 12-word
// recovery phrase, modeled on repos/desktop/src/Onboarding.tsx's UnlockStep.
const WORD_COUNT = 12

interface DeviceProvisionProps {
  /**
   * The password the user authenticated with, or '' when this device was
   * reached via a passkey sign-in (login.tsx's handlePasskeyLogin never
   * populates the `password` state field). Determines how the recovered
   * master key is persisted below — see the 1529 comment in handleRestore.
   */
  password: string
  email?: string
  onProvisioned: () => void
}

export function DeviceProvision({ password, onProvisioned }: DeviceProvisionProps) {
  const { setMasterKey, setMasterKeyDirect } = useKeys()

  const [words, setWords] = useState<string[]>(() => Array.from({ length: WORD_COUNT }, () => ''))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const wordRefs = useRef<Array<HTMLInputElement | null>>([])

  const filledCount = words.filter((w) => w.trim()).length
  const canRestore = filledCount === WORD_COUNT

  // Fill starting at `index`: a paste (or typing/autofill that lands
  // multiple space-separated words in one box) splits across the remaining
  // boxes and moves focus to the box after the last one filled.
  const applyWords = useCallback((index: number, rawWords: string[]) => {
    const clean = rawWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
    if (clean.length === 0) return
    setError('')
    setWords((current) => {
      const next = [...current]
      clean.slice(0, WORD_COUNT - index).forEach((word, offset) => {
        next[index + offset] = word
      })
      return next
    })
    const nextIndex = Math.min(index + clean.length, WORD_COUNT - 1)
    requestAnimationFrame(() => wordRefs.current[nextIndex]?.focus())
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

    try {
      const trimmed = words.map((w) => w.trim().toLowerCase()).join(' ')
      const masterKey = await recoverFromPhrase(trimmed)

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
      if (password) {
        await setMasterKey(masterKey, password)
      } else {
        setMasterKeyDirect(masterKey)
      }
      onProvisioned()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Invalid recovery phrase. Check your words and try again.',
      )
    } finally {
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
