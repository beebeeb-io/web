import { useCallback, useRef, useState } from 'react'
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  storeVaultKeyEscrow,
  serverOptsToCreateOptions,
  credentialToRegistrationJSON,
  type PasskeyInfo,
} from '../lib/api'
import {
  prfExtensionInputs,
  extractPrfOutput,
  getVaultWrapKey,
  encryptVaultBlob,
} from '../lib/passkey-vault'
import { toBase64 } from '../lib/crypto'

interface UseAddPasskeyFlowOptions {
  isUnlocked: boolean
  getMasterKey: () => Uint8Array
  onAdded: (info: PasskeyInfo) => void
  onError: (message: string) => void
}

interface UseAddPasskeyFlowResult {
  /** Pass to <StepUpAuth open={stepUpOpen} .../>. */
  stepUpOpen: boolean
  /** True while the WebAuthn ceremony + finish call are running (after step-up closes). */
  adding: boolean
  /** Call from the "Add passkey" button. Opens the step-up modal; the actual
   *  registration ceremony runs only once step-up confirms. `name` is the
   *  optional device label sent to register-finish. */
  requestAddPasskey: (name?: string) => void
  /** Pass to <StepUpAuth onClose={closeStepUp} .../>. */
  closeStepUp: () => void
  /** Pass to <StepUpAuth onConfirmed={handleStepUpConfirmed} .../>. */
  handleStepUpConfirmed: (confirmToken: string) => void
}

/**
 * Shared "step-up, then add a passkey" flow (task 1493).
 *
 * The server now requires a fresh X-Confirm-Token (password or passkey
 * re-auth — see `StepUpAuth`) before `register-start` will issue a
 * registration challenge at all: a bare session can no longer add a
 * persistent sign-in passkey. This hook owns the full sequence —
 *   1. open the step-up modal (`requestAddPasskey`),
 *   2. once confirmed, call `register-start` WITH that token,
 *   3. run the WebAuthn CREATE ceremony,
 *   4. call `register-finish` with the resulting `reg_id`,
 *   5. wrap the vault key for passkey-unlock, if the vault is unlocked,
 *   6. report success/failure back to the caller.
 *
 * Used identically by passkey-setup.tsx, security.tsx and
 * settings/security.tsx — do not fork this logic a fourth time; add a
 * fourth call site here instead.
 */
export function useAddPasskeyFlow({
  isUnlocked,
  getMasterKey,
  onAdded,
  onError,
}: UseAddPasskeyFlowOptions): UseAddPasskeyFlowResult {
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const pendingNameRef = useRef<string | undefined>(undefined)

  const requestAddPasskey = useCallback((name?: string) => {
    pendingNameRef.current = name
    setStepUpOpen(true)
  }, [])

  const closeStepUp = useCallback(() => setStepUpOpen(false), [])

  const handleStepUpConfirmed = useCallback(
    (confirmToken: string) => {
      setStepUpOpen(false)
      setAdding(true)
      void (async () => {
        try {
          const startRes = await startPasskeyRegistration(confirmToken)
          const createOptions = serverOptsToCreateOptions(startRes.publicKey)

          const prfExt = prfExtensionInputs()
          const credential = (await navigator.credentials.create({
            publicKey: {
              ...createOptions,
              extensions: {
                ...createOptions.extensions,
                ...prfExt,
              },
            },
          })) as PublicKeyCredential | null

          if (!credential) {
            onError('Passkey creation was cancelled')
            return
          }

          const credentialData = credentialToRegistrationJSON(credential)
          const info = await finishPasskeyRegistration(credentialData, startRes.reg_id, pendingNameRef.current)

          // Wrap master key for passkey vault unlock. Non-critical: passkey
          // sign-in still works without it, the user just needs the
          // password to unlock the vault on this device.
          if (isUnlocked) {
            try {
              const credentialId = credential.id
              const extensionResults = credential.getClientExtensionResults()
              const prfOutput = extractPrfOutput(extensionResults)
              const wrapKey = await getVaultWrapKey(credentialId, prfOutput, true)

              if (wrapKey) {
                const masterKey = getMasterKey()
                const encryptedBlob = await encryptVaultBlob(wrapKey, masterKey)
                await storeVaultKeyEscrow(credentialId, toBase64(encryptedBlob))
              }
            } catch (escrowErr) {
              if (import.meta.env.DEV) {
                console.warn('[use-add-passkey-flow] Vault key escrow failed:', escrowErr)
              }
            }
          }

          onAdded(info)
        } catch (err) {
          onError(err instanceof Error ? err.message : 'Failed to add passkey')
        } finally {
          setAdding(false)
        }
      })()
    },
    [getMasterKey, isUnlocked, onAdded, onError],
  )

  return { stepUpOpen, adding, requestAddPasskey, closeStepUp, handleStepUpConfirmed }
}
