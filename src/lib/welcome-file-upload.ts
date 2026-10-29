/**
 * The encrypted upload of "Welcome to Beebeeb.md" (task 1037 split — see
 * `welcome-file.ts` for when it runs). Same pipeline as any drive upload:
 * `encryptedUpload` with the master key; the per-file key is derived in core
 * from the server-assigned file id.
 */

import { encryptedUpload } from './encrypted-upload'
import { deriveFileKey } from './crypto'
import { getPreference, setPreference } from './api'
import { WELCOME_FILE_NAME, WELCOME_FILE_PREF, ensureDeferredWelcomeFile, welcomeFileContent } from './welcome-file'

export async function uploadWelcomeFile(masterKey: Uint8Array): Promise<void> {
  const file = new File([new TextEncoder().encode(welcomeFileContent())], WELCOME_FILE_NAME, {
    type: 'text/markdown',
  })
  const fileId = crypto.randomUUID()
  const fileKey = await deriveFileKey(masterKey, fileId)
  await encryptedUpload(
    file,
    fileId,
    fileKey,
    masterKey,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (serverFileId) => deriveFileKey(masterKey, serverFileId),
  )
}

/** Record that onboarding skipped the welcome file (needs_plan). */
export async function markWelcomeFilePending(): Promise<void> {
  await setPreference(WELCOME_FILE_PREF, 'pending')
}

/** Upload the deferred welcome file once, if it is still pending. */
export function flushDeferredWelcomeFile(userId: string, masterKey: Uint8Array): Promise<boolean> {
  return ensureDeferredWelcomeFile(userId, {
    getPref: () => getPreference<string>(WELCOME_FILE_PREF),
    setPref: (v) => setPreference(WELCOME_FILE_PREF, v),
    upload: () => uploadWelcomeFile(masterKey),
  })
}
