import { useState } from 'react'
import { DeviceProvision } from './device-provision'
import { VaultLockedNoKey } from './vault-locked-no-key'
import { isPostResetLockedDevice } from '../lib/post-reset-lock'
import { STALE_VAULT_NOTICE } from '../lib/sign-in-unlock'
import type { ProvisionAuthMethod } from '../lib/device-provision-logic'

/**
 * The "this device has no usable vault key" step that follows a server-proven
 * password: the 12-word recovery phrase, which re-seals the key under that
 * password. Used by the sign-in page (src/pages/login.tsx) and by the end of the
 * /set-password reset (src/pages/set-password.tsx).
 *
 * Task 1810 (P0): this used to render the "Vault locked" surface whenever the
 * post-reset marker was set, and that surface's phrase button opened
 * /recover-with-phrase — the PASSWORD RECOVERY ceremony (email + phrase + a
 * second new password) — so "unlock with recovery phrase" looped back to a
 * password reset. The phrase screen is now ALWAYS the first thing shown: the
 * password is already proven, so the phrase is the only thing missing. For a
 * person who has lost the phrase, "I've lost my recovery phrase" opens the
 * self-service exits (1704 slice 2: cancel billing, delete all data, delete
 * account) and its phrase button returns here.
 *
 * Exported through login.tsx too (test/1713-post-reset-provisioning-routing).
 */
export function LoginProvisionBranch({ password, authMethod, email, onProvisioned, staleVault, notice }: {
  password: string
  authMethod: ProvisionAuthMethod
  email?: string
  onProvisioned: () => void
  /** The sign-in just discarded a vault sealed under the previous password. */
  staleVault?: boolean
  /** Overrides the explanatory line above the phrase boxes. */
  notice?: string
}) {
  const [showExits, setShowExits] = useState(false)
  // The exits are for a person whose vault key is out of reach: this tab's
  // reset marker says so, and so does a sign-in that just removed a vault sealed
  // under the previous password (a reset/change made in another tab or on another
  // device leaves no marker here — Codex P1 on web#141).
  const offerExits = isPostResetLockedDevice() || !!staleVault

  if (offerExits && showExits) {
    return <VaultLockedNoKey onUnlockWithPhrase={() => setShowExits(false)} />
  }
  return (
    <DeviceProvision
      password={password}
      authMethod={authMethod}
      email={email}
      onProvisioned={onProvisioned}
      notice={notice ?? (staleVault ? STALE_VAULT_NOTICE : undefined)}
      onLostPhrase={offerExits ? () => setShowExits(true) : undefined}
    />
  )
}
