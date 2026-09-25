// ─── Vault boot remediation ─────────────────────────
// Task 1529 continuation (web #73). Factored out of key-context.tsx's boot
// effect (not unit-testable directly — no DOM/React-rendering harness under
// `bun test`) so the exact remediation the boot sequence relies on is a
// plain, exported, directly-testable function.

import { clearEmptyPasswordVault } from './vault'
import { clearVaultKey } from './session-vault-cache'
import { clearSession } from './session-persist'

/**
 * Detect + clear a password vault wrapped under an empty-string secret
 * (the pre-fix passkey-login provisioning bug, task 1529), AND the cached
 * copies of that SAME key that the pre-fix `setMasterKey` call also wrote
 * via `cacheKey` — the tab session cache (session-vault-cache.ts) and the
 * persistent session cache (session-persist.ts's IndexedDB blob + `bb_spt`
 * localStorage token, TTL up to 30 days).
 *
 * Codex P1 (PR #73): clearing only the `'master'` vault entry left the
 * persisted-session copy in place, and the boot sequence's
 * `restoreCachedKey()` unlocks from it immediately afterward — the vault
 * entry is gone but the same key is still recoverable from disk for up to
 * the configured TTL. Both caches must be cleared in the SAME remediation
 * pass, before any `restoreCachedKey()` call in the same boot sequence.
 *
 * Best-effort: a failure clearing either cache does not prevent clearing
 * the other, and never throws — the caller (key-context.tsx's boot effect)
 * must never be blocked by this.
 *
 * Returns true if an empty-password vault was found and cleared (which
 * also means the cached copies were cleared); false if there was nothing
 * to clear (no vault, or a real-password vault — the false-positive case).
 */
export async function remediateEmptyPasswordVault(): Promise<boolean> {
  const cleared = await clearEmptyPasswordVault()
  if (cleared) {
    try { await clearVaultKey() } catch { /* best effort */ }
    try { await clearSession() } catch { /* best effort */ }
  }
  return cleared
}
