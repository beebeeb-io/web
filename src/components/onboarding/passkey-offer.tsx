// Sign-up step 3: offer a passkey (Touch ID, Windows Hello, Face ID) right after the account exists.
import { useCallback, useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { AuthShell } from '../auth-shell'
import { StepUpAuth } from '../step-up-auth'
import { confirmAction } from '../../lib/api'
import { useAddPasskeyFlow } from '../../hooks/use-add-passkey-flow'

/** Sign-up step bar: the master key, the password, then the passkey and first files that follow account creation. */
export const SIGNUP_STEP_LABELS = ['Master key', 'Password', 'Passkey', 'First files']

/** WB-K05b wording; the same line for every failure, the technical reason stays out of the card. */
export const PASSKEY_NOT_ADDED = 'The passkey was not added.'

/**
 * True when this browser can make a platform passkey that also unlocks the vault: a built-in
 * authenticator (Touch ID, Windows Hello, Face ID) and the PRF extension. When the browser
 * cannot say (no capability API), the platform check alone decides and a failed ceremony
 * lands on the "not added" card with "Not now".
 */
export async function passkeyOfferSupported(): Promise<boolean> {
  try {
    const pkc = typeof window !== 'undefined' ? window.PublicKeyCredential : undefined
    if (!pkc) return false
    const caps = await (
      pkc as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }
    ).getClientCapabilities?.()
    if (caps) {
      if (caps.userVerifyingPlatformAuthenticator === false) return false
      if (caps['extension:prf'] === false) return false
      if (caps.userVerifyingPlatformAuthenticator === true) return true
    }
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export interface PasskeyOfferProps {
  /** The master key just made; wrapped under the passkey so it unlocks the vault. Not copied. */
  masterKey: Uint8Array
  /** Held only for this card: it answers the step-up without asking again. */
  password: string
  /** Called once: after the passkey is added, or on "Not now". */
  onDone: (added: boolean) => void
}

export function PasskeyOffer({ masterKey, password, onDone }: PasskeyOfferProps) {
  const [error, setError] = useState('')
  const [needStepUp, setNeedStepUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const getMasterKey = useCallback(() => masterKey, [masterKey])

  const { stepUpOpen, adding, requestAddPasskey, closeStepUp, handleStepUpConfirmed } = useAddPasskeyFlow({
    isUnlocked: true,
    getMasterKey,
    onAdded: () => onDone(true),
    onError: () => setError(PASSKEY_NOT_ADDED),
  })

  // The account was made a moment ago in this tab, so the password we hold answers the step-up.
  // Only when the server refuses it does the person get asked again.
  const add = useCallback(async () => {
    setError('')
    setNeedStepUp(false)
    setBusy(true)
    requestAddPasskey()
    try {
      const { confirmation_token } = await confirmAction(password)
      handleStepUpConfirmed(confirmation_token)
    } catch {
      setNeedStepUp(true)
    } finally {
      setBusy(false)
    }
  }, [password, requestAddPasskey, handleStepUpConfirmed])

  const working = busy || adding
  return (
    <AuthShell
      title="Add a passkey"
      subtitle="Unlock Beebeeb on this device with Touch ID, Windows Hello or Face ID instead of typing your password."
      step={3}
      totalSteps={4}
      stepLabels={SIGNUP_STEP_LABELS}
      hideTrust
    >
      <div data-testid="onboarding-screen" data-screen="step:passkey_offer">
        <StepUpAuth
          open={stepUpOpen && needStepUp}
          onConfirmed={(token) => {
            setNeedStepUp(false)
            handleStepUpConfirmed(token)
          }}
          onClose={() => {
            setNeedStepUp(false)
            closeStepUp()
          }}
          description="Confirm your password to add the passkey."
          submitLabel="Continue"
        />
        <div className="flex gap-3 p-3.5 rounded-md bg-paper-2 border border-line mb-4">
          <Icon name="key" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Your fingerprint or face stays on your device. Your password still works.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red mb-3" data-testid="passkey-offer-error">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <BBButton variant="ghost" onClick={() => onDone(false)} disabled={working} data-testid="passkey-offer-skip">
            Not now
          </BBButton>
          <BBButton variant="amber" className="flex-1" onClick={() => void add()} disabled={working} data-testid="passkey-offer-add">
            {working ? 'Waiting for your device...' : error ? 'Try again' : 'Add a passkey'}
          </BBButton>
        </div>
      </div>
    </AuthShell>
  )
}
