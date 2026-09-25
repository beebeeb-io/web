// ─── Device provision — pure decision logic ─────────
// Factored out of components/device-provision.tsx (a React component — no
// DOM/React-rendering harness under `bun test`, so its own logic can't be
// exercised directly) so the two decisions that matter for task 1529's
// security fix are plain, exported, directly-testable functions instead of
// logic buried inside JSX event handlers.

export const WORD_COUNT = 12

/** How login.tsx proved the user's identity before reaching this screen. */
export type ProvisionAuthMethod = 'opaque' | 'passkey'

/**
 * Should the recovered master key be wrapped with `password` and persisted
 * to the local IndexedDB vault (true), or kept in memory for this session
 * only (false, via setMasterKeyDirect)?
 *
 * Task 1529 continuation (web #73, crypto-security-reviewer P1): the
 * original check was a bare `if (password)` — inferring the auth method
 * from whether the `password` React state happens to be non-empty. That's
 * wrong whenever `password` is STALE rather than proven: a user types a
 * WRONG password, `handleSubmit`'s OPAQUE handshake fails (the `password`
 * state is never cleared on that error path), the user switches to
 * "Sign in with passkey instead" and succeeds — `password` still holds the
 * unproven, wrong string. The bare check would wrap + persist the vault
 * under that wrong password, locking the account out of its own vault the
 * next time it types the REAL password.
 *
 * `authMethod` is set explicitly by login.tsx at each of the three sites
 * that legitimately prove a password via a successful OPAQUE handshake
 * (`handleSubmit`, `handle2faVerify`, `handlePasskeyFallback`) or via a
 * pure passkey sign-in (`handlePasskeyLogin`) — never inferred — so a
 * stale `password` left over from a failed attempt can no longer steer
 * this decision.
 */
export function shouldWrapWithPassword(authMethod: ProvisionAuthMethod, password: string): boolean {
  return authMethod === 'opaque' && !!password
}

export interface DistributeWordsResult {
  words: string[]
  nextFocusIndex: number
}

/**
 * Distribute pasted/typed words into the recovery-phrase boxes starting at
 * `index`.
 *
 * Task 1529 continuation (web #73, Codex P2): pasting the FULL phrase
 * (all `wordCount` words) into any box other than the first used to
 * truncate — `clean.slice(0, wordCount - index)` clipped to the remaining
 * boxes and left the earlier ones empty, permanently disabling Restore
 * (the on-screen copy says "paste all 12 into any box", so this was a
 * contradiction, not just an edge case). A full-length paste now always
 * fills every box from index 0, regardless of which box received it. A
 * partial paste (fewer than `wordCount` words — typing, or a shorter
 * clipboard selection) keeps the original fill-from-`index` behavior.
 */
export function distributeWords(
  current: string[],
  index: number,
  rawWords: string[],
  wordCount: number,
): DistributeWordsResult {
  const clean = rawWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  if (clean.length === 0) return { words: current, nextFocusIndex: index }

  const isFullPhrase = clean.length >= wordCount
  const startIndex = isFullPhrase ? 0 : index
  const wordsToApply = isFullPhrase ? clean.slice(0, wordCount) : clean

  const next = [...current]
  wordsToApply.slice(0, wordCount - startIndex).forEach((word, offset) => {
    next[startIndex + offset] = word
  })

  const nextFocusIndex = Math.min(startIndex + wordsToApply.length, wordCount - 1)
  return { words: next, nextFocusIndex }
}
