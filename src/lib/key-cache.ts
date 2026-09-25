// ─── Key cache strategies ───────────────────────────
// Two ways key-context.tsx caches an unlocked master key, factored out of
// the KeyProvider hook (which can't be unit-tested directly — this repo has
// no DOM/React-rendering harness under `bun test`) so the actual caching
// behavior is a plain, exported, directly-testable function instead of
// logic buried inside a useCallback closure.

import { cacheVaultKey } from './session-vault-cache'
import { persistSession } from './session-persist'

/**
 * Cache the master key for this tab (non-extractable session key, dies on
 * refresh) AND persist an encrypted copy across refreshes (IndexedDB
 * `beebeeb_session_persist` + a `bb_spt` localStorage token, TTL-bounded).
 * This is the default for every unlock/provisioning path where staying
 * unlocked across a page refresh is the intended behavior — password
 * login, passkey-PRF vault unlock/provisioning, and phrase recovery on the
 * password-authenticated path.
 */
export async function cacheKeyPersistent(key: Uint8Array): Promise<void> {
  try {
    await cacheVaultKey(key)
  } catch { /* best effort */ }
  try {
    await persistSession(key)
  } catch { /* best effort */ }
}

/**
 * Cache the master key for this tab ONLY — never touches the persistent
 * session store. A page refresh discards it (the tab's non-extractable
 * session key lives only in session-vault-cache.ts's module memory), and
 * the user re-authenticates via passkey PRF or the recovery phrase next
 * time.
 *
 * Task 1529 (Guus ruling, 2026-09-25): "after a passkey sign-in, keep the
 * keys in memory for this session only... NOTHING stored (no vault, no
 * session-persist blob/token)." Used by `setMasterKeyDirect` — the path
 * a passkey sign-in with no PRF/escrow support falls back to after phrase
 * recovery. Codex P1 (PR #73): the original `cacheKey` (now
 * `cacheKeyPersistent`) called `persistSession` unconditionally, so this
 * "session only" path was still writing a decryptable copy of the key to
 * disk — defeating the ruling it was meant to satisfy.
 */
export async function cacheKeySessionOnly(key: Uint8Array): Promise<void> {
  try {
    await cacheVaultKey(key)
  } catch { /* best effort */ }
  // Deliberately does NOT call persistSession — see the doc comment above.
}
