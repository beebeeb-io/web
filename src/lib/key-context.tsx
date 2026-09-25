// ─── Key context ────────────────────────────────────
// Holds the master key in memory. Persisted to IndexedDB vault (wrapped with password).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  deriveKeys,
  deriveFileKey,
  initCrypto,
  zeroize,
  computeRecoveryCheck,
  toBase64,
} from './crypto'
import { registerLogoutCallback, registerLoginBroadcastCallback } from './auth-context'
import {
  wrapAndStore,
  unwrap,
  hasVault,
  clearVault,
  wrapAndStoreWithPasskey,
  unwrapWithPasskey,
  tagVaultEntry,
  tagPasskeyVaultEntry,
} from './vault'
import { remediateEmptyPasswordVault } from './vault-remediation'
import {
  initSessionVault,
  cacheVaultKey,
  getVaultKey,
  clearVaultKey,
} from './session-vault-cache'
import {
  restoreSession,
  clearSession,
} from './session-persist'
import { cacheKeyPersistent, cacheKeySessionOnly } from './key-cache'
import { setRecoveryCheckIfAbsent, verifyRecoveryCheck } from './api'
import type { DriveFile } from './api'
import { useAuth } from './auth-context'
import { isRequestUpload, createRequestKeyResolver, type RequestKeyResolver } from './file-request-crypto'
import { backfillRecoveryCheckIfAbsent, recoveredKeyMatchesAccount } from './recovery-validation'
import { setExpectedUserProvider, registerAccountMismatchHandler } from '@beebeeb/shared'

/**
 * Outcome of `unlockVault` (task 1531/1534 P0 continuation, web PR #85).
 * Widened from a plain boolean so callers can tell a genuine wrong password
 * apart from a right-password-wrong-account "tag mismatch" (an UNTAGGED
 * pre-fix vault entry that failed the server-side recovery_check proof) —
 * the latter must route to device provisioning, never sit on the generic
 * "Wrong password" dead end (see login.tsx / vault-unlock.tsx).
 */
export type VaultUnlockOutcome = 'unlocked' | 'wrong_password' | 'needs_provisioning'

/**
 * Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
 * P1): the exact boolean decision `getMasterKey`/`getFileKey`/
 * `getFileKeyForFile`'s guard is built on, factored out as a plain, pure
 * function — no ref, no React closure — so it is directly unit-testable
 * under `bun test` (this repo has no DOM/React-rendering harness; see
 * key-cache.ts / recovery-validation.ts / device-provision-logic.ts for the
 * established pattern this follows). `hasKey` is `masterKeyRef.current !==
 * null`; `residentUserId` is `residentKeyUserIdRef.current`; `targetUserId`
 * is the resolved comparison target (`expectedUserId` if the caller passed
 * one, else `user?.user_id ?? null`) — see those accessors' own doc
 * comments for why a caller may need to override the default.
 */
export function isKeyBoundToUser(
  hasKey: boolean,
  residentUserId: string | null,
  targetUserId: string | null,
): boolean {
  return hasKey && residentUserId === targetUserId
}

interface KeyState {
  /** True once WASM is loaded and ready. */
  cryptoReady: boolean
  /** True while WASM is loading. */
  cryptoLoading: boolean
  /** Error message if WASM failed to load. */
  cryptoError: string | null
  /** Whether the vault is unlocked (master key present). */
  isUnlocked: boolean
  /** Whether a wrapped key exists in IndexedDB. */
  vaultExists: boolean
  /** Whether the vault check has completed (prevents race conditions). */
  vaultChecked: boolean
  /** Set the master key and wrap it with password into IndexedDB vault.
   *  `userId` is the account this key was just PROVEN for (server user_id) —
   *  task 1531/1534 (P0): every key establishment is bound to an account so
   *  a stale/foreign key can never be mistaken for the wrong account's. */
  setMasterKey: (key: Uint8Array, password: string, userId: string) => Promise<void>
  /** Set the master key directly without password wrapping (passkey vault unlock). */
  setMasterKeyDirect: (key: Uint8Array, userId: string) => void
  /** Set the master key and wrap it with a passkey-derived key into IndexedDB. */
  setMasterKeyFromPasskey: (key: Uint8Array, wrapKey: Uint8Array, userId: string) => Promise<void>
  /** Unwrap the master key from IndexedDB using password. See
   *  {@link VaultUnlockOutcome} — 'needs_provisioning' means the password
   *  was right but the entry could not be proven to belong to `userId`. */
  unlockVault: (password: string, userId: string) => Promise<VaultUnlockOutcome>
  /** Unwrap the master key from IndexedDB using a passkey-derived wrap key. Returns true if successful. */
  unlockVaultWithPasskey: (wrapKey: Uint8Array, userId: string) => Promise<boolean>
  /** Derive master key from password + salt (legacy path). */
  unlock: (password: string, salt: Uint8Array, userId: string) => Promise<void>
  /** True if a key is resident in memory AND was established/verified for
   *  EXACTLY this account (task 1531/1534, P0). Prefer this over the raw
   *  `isUnlocked` boolean whenever a caller just authenticated as a SPECIFIC
   *  account and needs to know whether it is safe to skip re-unlocking —
   *  `isUnlocked` alone does not say WHOSE key is resident. */
  isUnlockedFor: (userId: string) => boolean
  /** The account id the resident key is bound to, or null if none is
   *  resident (task 1531/1534 P0 continuation, web PR #85). Prefer this
   *  over a separately-read `useAuth().user.user_id` snapshot when
   *  re-binding/re-wrapping the SAME already-resident key across a long
   *  async flow (e.g. change-password's re-wrap) — the auth snapshot can
   *  drift mid-flow; this ref reflects the key's own already-proven owner. */
  getResidentUserId: () => string | null
  /** Derive a per-file key from the master key (async — runs in worker).
   *  `expectedUserId` (task 1531/1534 P0 continuation) is optional — omit it
   *  to require the key bound to whoever is CURRENTLY signed in (the normal
   *  case); pass it when the caller already holds a just-proven,
   *  authoritative account id (see the accessor's own doc comment). Either
   *  way, throws if the resident key is not bound to the resolved target. */
  getFileKey: (fileId: string, expectedUserId?: string) => Promise<Uint8Array>
  /** Resolve the decryption key for a DriveFile. Files received through a file
   *  request carry a sealed content key (file_request_id + sender_ephemeral_pubkey
   *  + wrapped_content_key) and must be opened via the request-key path; all other
   *  files use the normal derive_file_key(master, id) path. Prefer this over
   *  getFileKey wherever the full file object is available (naming, preview,
   *  download). `expectedUserId` — see `getFileKey`. */
  getFileKeyForFile: (file: DriveFile, expectedUserId?: string) => Promise<Uint8Array>
  /** Get the raw master key (for X25519 key exchange in sharing).
   *  `expectedUserId` — see `getFileKey`; throws if the resident key is not
   *  bound to the resolved target (task 1531/1534 P0 continuation). */
  getMasterKey: (expectedUserId?: string) => Uint8Array
  /** Zero in-memory key. Vault stays in IndexedDB for re-unlock. */
  lock: () => void
  /** Full logout: zero in-memory key AND clear IndexedDB vault. */
  fullLogout: () => Promise<void>
}

const KeyContext = createContext<KeyState | null>(null)

export function KeyProvider({ children }: { children: ReactNode }) {
  const [cryptoReady, setCryptoReady] = useState(false)
  const [cryptoLoading, setCryptoLoading] = useState(true)
  const [cryptoError, setCryptoError] = useState<string | null>(null)
  // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
  // P1): renamed from `isUnlocked` — this is now only the INTERNAL "is a key
  // resident in memory at all" signal (a state, not a ref, so it triggers a
  // re-render whenever a key is set/cleared). It says nothing about WHICH
  // account that key is bound to. The PUBLIC `isUnlocked` exposed on this
  // context (below, derived at render time) additionally requires the
  // resident key's tag to match the CURRENTLY authenticated account — so
  // children (search-index-context, ProtectedRoute, …) that gate on
  // `isUnlocked` never see a truthy value for a key that is not (yet, or no
  // longer) provably theirs.
  const [keyPresent, setKeyPresent] = useState(false)
  const [vaultExists, setVaultExists] = useState(false)
  const [vaultChecked, setVaultChecked] = useState(false)

  // Task 1531/1534 (P0): which account's session the resident master key
  // (masterKeyRef below) has actually been established/proven for. Every
  // setter that legitimately establishes a key (password unlock, passkey
  // escrow, signup, recovery phrase, …) is REQUIRED to pass the account's
  // server `user_id`, obtained from the SAME auth response that proved
  // identity — never inferred from a possibly-stale `useAuth().user` render
  // snapshot. `null` = no key resident, or its owner is no longer trusted
  // (see the verification effect below `lock`).
  const residentKeyUserIdRef = useRef<string | null>(null)
  // `authLoading`: the watchdog effect below must not treat `user === null`
  // as "nobody is authenticated" while AuthProvider's OWN boot() is still
  // waiting on its getMe() round trip — that races the (local, fast)
  // vault-restore below and would `lock()` a key the instant it restores,
  // long before auth had a chance to resolve and CONFIRM the match.
  const { user, loading: authLoading } = useAuth()

  const masterKeyRef = useRef<Uint8Array | null>(null)

  // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
  // P1): the PUBLIC `isUnlocked` this context exposes — derived fresh on
  // EVERY render from `keyPresent` (triggers the re-render) AND a synchronous
  // comparison of the two refs above against the CURRENTLY known auth user.
  // Not a separately-tracked state: a stored boolean can only be as fresh as
  // the last place that remembered to update it, and the whole point here is
  // that NO consumer (search-index-context, ProtectedRoute, …) that gates on
  // `isUnlocked` should ever see `true` for a key that is not — yet, or any
  // more — provably bound to `user`. During the boot window where
  // `authLoading` is still true, `user` is `null`; a resident key from a
  // FASTER local vault-restore reads as `untagged (false)` here until auth
  // catches up and confirms the match, at which point this flips true on
  // its own (no extra plumbing needed — `user` changing is what re-renders
  // this component). The watchdog effect below still exists ALONGSIDE this:
  // it actually zeroes the memory on a confirmed mismatch, which this
  // derived flag alone does not do (defense in depth, not either/or).
  const isUnlocked = isKeyBoundToUser(keyPresent, residentKeyUserIdRef.current, user?.user_id ?? null)

  // Wrap the master key with the tab's non-extractable session key and persist
  // to IndexedDB. Failures are swallowed — caching is an enhancement; the live
  // masterKeyRef is the source of truth within the tab. Delegates to
  // key-cache.ts (unit-testable — see its doc comments) rather than calling
  // cacheVaultKey/persistSession directly. `userId` is stamped alongside the
  // cached blob (task 1531/1534) so a later restore on a DIFFERENT account's
  // session can tell it does not belong there.
  const cacheKey = useCallback(async (key: Uint8Array, userId: string) => {
    await cacheKeyPersistent(key, userId)
  }, [])

  // Returns the cached key AND the account id it was stamped for. Task
  // 1531/1534 (P0 continuation, web PR #85): session-vault-cache.ts /
  // session-persist.ts now DELETE an untagged (pre-1531/1534) entry on read
  // instead of handing it back — so `userId` here is always a real,
  // already-tagged account id, never null; there is no "trust it once, heal
  // it later" path left at this layer for a cached/persisted key.
  const restoreCachedKey = useCallback(async (): Promise<{ key: Uint8Array; userId: string } | null> => {
    // Try in-tab session cache first (fastest, same-tab only)
    try {
      const tabEntry = await getVaultKey()
      if (tabEntry) return tabEntry
    } catch { /* fall through */ }
    // Try persistent session (survives refresh, TTL-bounded)
    try {
      const persisted = await restoreSession()
      if (persisted) {
        // Re-cache in the tab session for faster subsequent access
        try { await cacheVaultKey(persisted.key, persisted.userId) } catch { /* ok */ }
        return persisted
      }
    } catch { /* fall through */ }
    return null
  }, [])

  const clearCachedKey = useCallback(() => {
    void clearVaultKey()
    void clearSession()
  }, [])

  // Initialize WASM on mount + check if vault exists + restore cached key.
  //
  // useEffect (not useState) — side effects must not run during render.
  // The previous useState(() => { async }) pattern ran twice in React StrictMode
  // (both renders call the initializer) and initiated WASM loading during
  // render phase, which is incorrect. useEffect runs once after first commit.
  //
  // Order matters: masterKeyRef.current is set BEFORE setKeyPresent(true) and
  // setVaultChecked(true) are batched into a single re-render (React 18).
  // By the time ProtectedRoute re-renders, the ref holds the key AND both
  // flags are true, eliminating the race window between them.
  useEffect(() => {
    let cancelled = false
    initCrypto()
      .then(async () => {
        if (cancelled) return
        setCryptoReady(true)
        setCryptoLoading(false)
        // Generate the tab's non-extractable session key. Idempotent if dev-auth
        // already initialised it earlier in the boot sequence.
        await initSessionVault()
        if (cancelled) return
        let exists = await hasVault()
        if (cancelled) return
        // Task 1529 remediation: a pre-fix device may carry a password
        // vault wrapped under an empty-string secret (passkey-login
        // provisioning bug). Detect + clear it — AND the cached copies of
        // that same key (Codex P1, web #73 continuation item 2: the
        // pre-fix setMasterKey call that created the vault also cached the
        // key via cacheKey, so clearing only the vault entry left
        // restoreCachedKey below able to unlock from the surviving
        // session-persist copy) — before anything reads isUnlocked/
        // vaultExists, and strictly before restoreCachedKey. Best-effort,
        // never blocks boot. Only the 'master' entry is touched; a
        // co-existing PRF-wrapped passkey vault survives, so re-check
        // hasVault() afterward rather than assuming false.
        //
        // The expensive PBKDF2 probe this runs is checked-flag-gated
        // (vault.ts) to at most once per vault entry, so this no longer
        // costs anything on repeat boots for a legitimate password vault
        // (item 7).
        if (exists) {
          try {
            const cleared = await remediateEmptyPasswordVault()
            if (cancelled) return
            if (cleared) exists = await hasVault()
          } catch { /* best effort remediation; never block boot */ }
          if (cancelled) return
        }
        setVaultExists(exists)
        // Restore the session-encrypted key BEFORE setting vaultChecked=true.
        // ProtectedRoute guards on vaultChecked; if we set it before the
        // restore completes, there's a window where vaultChecked=true but
        // isUnlocked=false → ProtectedRoute sends users to /login even though
        // their cached key is about to be found. Setting vaultChecked last
        // ensures ProtectedRoute only renders once both states are stable.
        const cached = await restoreCachedKey()
        if (cancelled) return
        if (cached) {
          // Task 1531/1534 (P0): stamp the account id this cached key claims
          // to belong to (possibly `null`, for an entry written before this
          // fix shipped — treated as untrusted below, never auto-matched).
          // Committed here immediately (matching the ORIGINAL timing this
          // effect was carefully sequenced for — see the comment above) so
          // there is no artificial flash to /login for the overwhelmingly
          // common case where this IS the right account; the verification
          // effect declared after `lock` below reconciles it against
          // whichever account auth resolves to, and clears it back out
          // (isUnlocked → false) the moment a mismatch is detected.
          masterKeyRef.current = cached.key
          residentKeyUserIdRef.current = cached.userId
          setKeyPresent(true)
        }
        setVaultChecked(true)
      })
      .catch((err) => {
        if (cancelled) return
        setCryptoError(
          err instanceof Error ? err.message : 'Failed to load encryption module',
        )
        setCryptoLoading(false)
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — runs once on mount only

  // Expose crypto readiness as a body data attribute so e2e tests / browser
  // automation can wait for the WASM worker before interacting with auth forms.
  useEffect(() => {
    document.body.dataset.cryptoReady = cryptoReady ? 'true' : 'false'
  }, [cryptoReady])

  // Backfill the account's server-stored `recovery_check` on a PROVEN-correct-key
  // unlock (task 0875). A handful of legacy accounts predate the signup-time
  // check; task 0874 made device-provision REJECT a recovery phrase whose
  // recovery_check doesn't match the stored one, so a NULL-stored account would
  // be wrongly locked out of recovery-phrase provisioning. The server sets it
  // ONLY if currently NULL (never overwrites), so this is safe + idempotent.
  //
  // CRITICAL: call this ONLY with a key already proven to be the account's —
  // i.e. local-vault keyCheck (unlockVault), passkey-escrow AEAD-decrypt
  // (unlockVaultWithPasskey / setMasterKeyFromPasskey / setMasterKeyDirect), a
  // freshly-generated signup key, a password-change re-wrap of the live key, or
  // the 0874-validated recovery-phrase path (all funnel through setMasterKey).
  // It MUST NOT be wired into the legacy `unlock(password, salt)` path, which
  // derives a key WITHOUT proving it correct — backfilling from there could
  // set a WRONG recovery_check into the empty slot.
  //
  // Best-effort + fire-and-forget: never awaited by the caller; the helper
  // swallows all failures — it must never block or break an unlock.
  const backfillRecoveryCheck = useCallback((key: Uint8Array) => {
    void backfillRecoveryCheckIfAbsent(key, {
      computeRecoveryCheckB64: async (k) => toBase64(await computeRecoveryCheck(k)),
      setRecoveryCheckIfAbsent,
    })
  }, [])

  const unlock = useCallback(async (password: string, salt: Uint8Array, userId: string) => {
    const { masterKey } = await deriveKeys(password, salt)
    masterKeyRef.current = masterKey
    residentKeyUserIdRef.current = userId
    setKeyPresent(true)
    cacheKey(masterKey, userId)
  }, [cacheKey])

  // Task 1529 continuation (web #73, P2): masterKeyRef is set ONLY after
  // wrapAndStore succeeds — if it threw first (e.g. the empty/whitespace
  // secret guard), the live in-memory key must not silently become "the
  // key that failed to persist" while the rest of the app already thinks
  // isUnlocked. On throw, zero the caller's key material (it's not going
  // anywhere) and rethrow so the caller's own catch/finally still runs.
  const setMasterKey = useCallback(async (key: Uint8Array, password: string, userId: string) => {
    try {
      await wrapAndStore(key, password, userId)
    } catch (err) {
      zeroize(key)
      throw err
    }
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    setVaultExists(true)
    setKeyPresent(true)
    cacheKey(key, userId)
    backfillRecoveryCheck(key)
  }, [cacheKey, backfillRecoveryCheck])

  // Set the master key directly without password wrapping.
  // Used by passkey vault unlock where the key comes from server escrow,
  // not from a password-derived local vault, AND by the passkey session-only
  // path (task 1529). The key is cached in the tab session vault so it
  // survives soft-navigations within the tab, but — unlike every other
  // setter here — via cacheKeySessionOnly, NOT cacheKey: no persistent
  // IndexedDB/localStorage copy is written (Guus's ruling, 2026-09-25:
  // "keep the keys in memory for this session only... NOTHING stored").
  const setMasterKeyDirect = useCallback((key: Uint8Array, userId: string) => {
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    setKeyPresent(true)
    void cacheKeySessionOnly(key, userId)
    backfillRecoveryCheck(key)
  }, [backfillRecoveryCheck])

  const setMasterKeyFromPasskey = useCallback(async (key: Uint8Array, wrapKey: Uint8Array, userId: string) => {
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    await wrapAndStoreWithPasskey(key, wrapKey, userId)
    setVaultExists(true)
    setKeyPresent(true)
    cacheKey(key, userId)
    backfillRecoveryCheck(key)
  }, [cacheKey, backfillRecoveryCheck])

  // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer):
  // the SERVER-SIDE proof an UNTAGGED local unwrap (password/keyCheck, or
  // passkey PRF/escrow AEAD) must pass before it is trusted. Delegates to
  // `recoveredKeyMatchesAccount` (recovery-validation.ts — already
  // unit-tested there, already used for the recovery-phrase provisioning
  // gate) rather than re-implementing the same check: `verifyRecoveryCheck`
  // resolves `true` on a genuine match, resolves `false` ONLY on a
  // server-confirmed 400 (mismatch OR no recovery_check stored — both must
  // refuse per the security review, since an unmatched key is unmatched
  // either way), and re-throws on anything else (network/server failure).
  // That re-throw is caught HERE and treated as "not verified" — an
  // unreachable verifier must never be read as "fine, proceed" (same
  // fail-closed rule `recoveredKeyMatchesAccount`'s own doc comment states).
  const verifyUntaggedKey = useCallback(async (key: Uint8Array): Promise<boolean> => {
    try {
      return await recoveredKeyMatchesAccount(key, {
        computeRecoveryCheckB64: async (k) => toBase64(await computeRecoveryCheck(k)),
        verifyRecoveryCheck,
      })
    } catch {
      return false
    }
  }, [])

  const unlockVaultWithPasskey = useCallback(async (wrapKey: Uint8Array, userId: string): Promise<boolean> => {
    const result = await unwrapWithPasskey(wrapKey, userId)
    if (!result) return false
    if (result.untagged) {
      const verified = await verifyUntaggedKey(result.key)
      if (!verified) {
        zeroize(result.key)
        return false
      }
      await tagPasskeyVaultEntry(userId)
    }
    masterKeyRef.current = result.key
    residentKeyUserIdRef.current = userId
    setKeyPresent(true)
    cacheKey(result.key, userId)
    backfillRecoveryCheck(result.key)
    return true
  }, [cacheKey, backfillRecoveryCheck, verifyUntaggedKey])

  const unlockVault = useCallback(async (password: string, userId: string): Promise<VaultUnlockOutcome> => {
    const result = await unwrap(password, userId)
    if (!result) return 'wrong_password'
    if (result.untagged) {
      // Password + keyCheck proved SOME account's key — but this entry
      // predates account binding, so that alone does not prove it is
      // `userId`'s (task 1531/1534 P0: two accounts sharing a password on
      // the same device would otherwise let the wrong one adopt it). Ask
      // the server.
      const verified = await verifyUntaggedKey(result.key)
      if (!verified) {
        zeroize(result.key)
        // NO backfill, NO autoUpgrade with this key, nothing cached, nothing
        // re-tagged — the caller must route to device provisioning (recovery
        // phrase) instead of the generic "wrong password" dead end.
        return 'needs_provisioning'
      }
      await tagVaultEntry(userId)
    }
    masterKeyRef.current = result.key
    residentKeyUserIdRef.current = userId
    setKeyPresent(true)
    cacheKey(result.key, userId)
    backfillRecoveryCheck(result.key)
    return 'unlocked'
  }, [cacheKey, backfillRecoveryCheck, verifyUntaggedKey])

  // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
  // P1): every key accessor below refuses an UNBOUND key. `expectedUserId`
  // is OPTIONAL and defaults to `user?.user_id` (the normal case — "give me
  // whichever key is bound to whoever is CURRENTLY signed in", which is what
  // the overwhelming majority of call sites, e.g. search-index-context.tsx's
  // boot effect, share-dialog, drive uploads, actually want). A caller that
  // just proved a SPECIFIC account's identity itself — e.g. login.tsx,
  // holding `loginResult.user_id` from the very OPAQUE/passkey response that
  // proved it, immediately after its own `unlockVault(password, that_id)`
  // call — may pass it explicitly instead. This mirrors `isUnlockedFor`'s
  // existing rationale one level down: `user` is a React state snapshot that
  // is not guaranteed to have re-rendered yet in the SAME microtask
  // continuation a caller resumes in right after an awaited `setUser` (e.g.
  // login.tsx's `void autoUpgradeToV1(password, getMasterKey())` fires
  // immediately after `unlockVault` resolves) — comparing against the
  // caller's own already-authoritative id sidesteps that race entirely
  // rather than gambling on React's scheduler having flushed by then.
  //
  // Before this fix, `isUnlocked` alone was the only gate most callers
  // checked (or none at all, deep inside a helper) — a caller could race
  // ahead of the watchdog effect and pull a key that has not yet been, or no
  // longer is, confirmed to belong to the signed-in account. Concretely:
  // search-index-context.tsx's boot effect used to call `getMasterKey()` the
  // instant `isUnlocked` first read true, which could be BEFORE `authLoading`
  // settles; these accessors now close that window regardless of what (if
  // anything) the caller checked first.
  const isBoundTo = useCallback((expectedUserId?: string): boolean => {
    const target = expectedUserId ?? (user?.user_id ?? null)
    return isKeyBoundToUser(masterKeyRef.current !== null, residentKeyUserIdRef.current, target)
  }, [user])

  const getFileKey = useCallback(async (fileId: string, expectedUserId?: string): Promise<Uint8Array> => {
    if (!isBoundTo(expectedUserId)) {
      throw new Error('Vault is locked — unlock first')
    }
    return deriveFileKey(masterKeyRef.current as Uint8Array, fileId)
  }, [isBoundTo])

  // Lazily-created resolver for files received through a file request. Caches the
  // request list + unwrapped R_priv per request for the drive session.
  const requestResolverRef = useRef<RequestKeyResolver | null>(null)

  const getFileKeyForFile = useCallback(async (file: DriveFile, expectedUserId?: string): Promise<Uint8Array> => {
    if (!isBoundTo(expectedUserId)) {
      throw new Error('Vault is locked — unlock first')
    }
    const key = masterKeyRef.current as Uint8Array
    if (isRequestUpload(file)) {
      if (!requestResolverRef.current) requestResolverRef.current = createRequestKeyResolver()
      return requestResolverRef.current.resolveFileKey(file, key)
    }
    return deriveFileKey(key, file.id)
  }, [isBoundTo])

  const getMasterKey = useCallback((expectedUserId?: string): Uint8Array => {
    if (!isBoundTo(expectedUserId)) {
      throw new Error('Vault is locked — unlock first')
    }
    // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
    // P2): a COPY, never the shared `masterKeyRef.current` array itself.
    // `lock()` (below) zeroes that array IN PLACE — a caller that captured
    // this return value and then `await`s something before actually using
    // the bytes (e.g. search-index-context.tsx's `pushBuckets`, an X25519
    // derivation mid-upload) would otherwise silently keep running against
    // an all-zero key the instant a concurrent `lock()` fires (a cross-tab
    // account-mismatch reload, a 409 account_mismatch, the watchdog effect),
    // rather than failing loudly the next time it actually needs the key.
    // A 32-byte copy per call is negligible; the ORIGINAL array is still the
    // one `lock()`/`fullLogout()` zero, so the security property (key
    // material doesn't outlive its lock) is unchanged — only WHICH array a
    // caller holds a reference to.
    return new Uint8Array(masterKeyRef.current as Uint8Array)
  }, [isBoundTo])

  // Task 1531/1534 (P0 continuation, web PR #85): the account id the
  // resident key is bound to, straight from the ref — never a `useAuth()`
  // snapshot. See the KeyState doc comment for why a caller re-wrapping the
  // SAME already-resident key across a long async flow (change-password)
  // must prefer this over `user.user_id`.
  const getResidentUserId = useCallback((): string | null => residentKeyUserIdRef.current, [])

  // Task 1531/1534 (P0). See residentKeyUserIdRef's own doc comment above —
  // this is how a caller that just proved a SPECIFIC account's identity
  // (e.g. login.tsx's handlePasskeyLogin, holding `startRes.user_id` from
  // the very same auth response) checks whether it is safe to treat an
  // already-resident key as that account's, WITHOUT trusting a `useAuth().
  // user` React-state snapshot that may not have re-rendered yet relative
  // to this same synchronous handler (the actual race that made the old
  // `if (isUnlocked)` shortcut exploitable: `isUnlocked` could already be
  // true from a DIFFERENT, PRIOR account's session in this same tab).
  const isUnlockedFor = useCallback((userId: string): boolean => {
    return masterKeyRef.current !== null && residentKeyUserIdRef.current === userId
  }, [])

  const lock = useCallback(() => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
    residentKeyUserIdRef.current = null
    requestResolverRef.current?.clear()
    requestResolverRef.current = null
    clearCachedKey()
    setKeyPresent(false)
  }, [clearCachedKey])

  // Task 1531/1534 (P0): cross-account master-key confusion. The cached/
  // persisted key stores (session-vault-cache, session-persist, the
  // password/passkey vault in IndexedDB) are single, per-ORIGIN slots — not
  // namespaced by account — and `masterKeyRef`/`isUnlocked` live for the
  // lifetime of this tab's React tree, independent of which account the
  // session cookie currently authenticates as. Nothing previously verified
  // that a key already resident in memory (from a boot-time cache restore,
  // or a PRIOR account's session in this same tab that was never explicitly
  // logged out of) actually belongs to whichever account is CURRENTLY
  // authenticated — so a passkey/password sign-in as a DIFFERENT account
  // could silently keep operating under the wrong account's key
  // (login.tsx's handlePasskeyLogin `if (isUnlocked)` shortcut was the most
  // direct instance — separately hardened via isUnlockedFor above — but
  // GuestRoute/ProtectedRoute's own `isUnlocked` reads were equally
  // exploitable via a same-tab account switch, e.g. a FAILED unlock attempt
  // for the new account that never clears the OLD account's still-resident
  // key, or GuestRoute's own redirect racing ahead of an in-progress
  // password unlock).
  //
  // This is a purely LOCAL comparison — residentKeyUserIdRef against
  // useAuth().user.user_id — never a network round trip. It deliberately
  // does NOT call the server's verify-recovery-check endpoint here: that
  // endpoint cannot distinguish "wrong account" from "this (possibly
  // legacy) account has no recovery_check on file yet" (both return the
  // same 400), which would make this effect wrongly lock out every legacy
  // account with no recovery_check on EVERY normal page refresh (the boot
  // race between this effect and the auth-boot's own getMe() means `user`
  // routinely transitions null→resolved while the boot-restored key is
  // already resident). residentKeyUserIdRef instead reflects the id every
  // legitimate setter (unlockVault/setMasterKey/setMasterKeyFromPasskey/…)
  // OR the boot-restore's own stored tag actually recorded at the moment
  // the key became resident — a local bookkeeping comparison, not a
  // cryptographic proof (the proof already happened, via password/escrow/
  // phrase, whenever residentKeyUserIdRef was set).
  useEffect(() => {
    // Wait for BOTH boot signals to settle before judging anything:
    //   - vaultChecked: the LOCAL crypto/vault-restore side (fast, no
    //     network) has finished its own restore attempt.
    //   - !authLoading: AuthProvider's getMe() round trip has resolved
    //     (to a real user OR to null — either is a settled answer).
    // The vault-restore commits isUnlocked=true (see the boot effect above)
    // well before a dev-auto-login getMe() call typically resolves — acting
    // on `user` here before authLoading flips false would read a `null`
    // that is merely "not back yet", not "genuinely unauthenticated", and
    // would lock() a key that is about to be confirmed correct a moment
    // later (this is not hypothetical: it reproduced on every dev-auto-
    // login e2e boot before this guard was added).
    if (!vaultChecked || authLoading) return
    const currentUserId = user?.user_id ?? null
    if (residentKeyUserIdRef.current === currentUserId) return // matches (both null counts as "nothing to protect")
    if (!masterKeyRef.current) {
      // Nothing resident to misattribute — whichever proof-based unlock
      // runs next binds residentKeyUserIdRef itself, correctly.
      return
    }
    // A key IS resident, bound to a DIFFERENT (or no) account than the one
    // now authenticated — cross-account confusion. Clear it; the normal
    // escrow/PRF/password/phrase unlock path takes over and loads the
    // REAL key for currentUserId.
    lock()
  }, [user, authLoading, vaultChecked, lock])

  const fullLogout = useCallback(async () => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
    residentKeyUserIdRef.current = null
    requestResolverRef.current?.clear()
    requestResolverRef.current = null
    clearCachedKey()
    await clearVault()
    setVaultExists(false)
    setKeyPresent(false)
  }, [clearCachedKey])

  // Full clear on explicit logout — wipe in-memory key AND IndexedDB vault.
  // The user chose to log out, so the device should not retain wrapped keys.
  useEffect(() => {
    registerLogoutCallback(fullLogout)
    return () => registerLogoutCallback(() => {})
  }, [fullLogout])

  // Task 1531 (web #85 round 2): defence-in-depth header. The shared
  // `request()` client reads this provider on every mutating call and — once
  // server task 1554 ships — the server 409s if it doesn't match the
  // session's real user. A FUNCTION, not a snapshot: `request()` calls it at
  // send-time, so it always reads the ref's CURRENT value, never a stale one
  // from whenever this effect happened to run.
  useEffect(() => {
    setExpectedUserProvider(() => residentKeyUserIdRef.current)
    return () => setExpectedUserProvider(null)
  }, [])

  // Task 1531 (web #85 round 2): the server's 409 `account_mismatch`
  // response (once task 1554 ships) means the resident key's bound id did
  // not match the session's actual user — never trust it further. Lock it
  // and force a fresh boot via login, mirroring how a cross-tab logout
  // already does a hard navigation for the same "guarantee no stale
  // in-memory state survives" reason.
  useEffect(() => {
    registerAccountMismatchHandler(() => {
      lock()
      if (typeof window !== 'undefined') window.location.href = '/login'
    })
    return () => registerAccountMismatchHandler(() => {})
  }, [lock])

  // Task 1531/1534 (P0 continuation, web PR #85, crypto-security-reviewer
  // P1): auth-context.tsx's BroadcastChannel used to carry ONLY 'logout' —
  // a login in another tab (as a DIFFERENT account than whatever key is
  // resident HERE) had no cross-tab signal at all, so this tab could keep
  // operating on the OLD account's key indefinitely, in the background,
  // even though the shared cookie jar now authenticates the new account.
  // On a 'login' broadcast for an account that does NOT match whatever is
  // resident here, lock it and reload — the fresh boot re-establishes
  // (or correctly refuses to establish) a key for whoever this tab's OWN
  // next getMe() resolves to. A login for the SAME account, or arriving
  // while nothing is resident, is a no-op (nothing to protect against).
  useEffect(() => {
    registerLoginBroadcastCallback((incomingUserId) => {
      if (residentKeyUserIdRef.current && residentKeyUserIdRef.current !== incomingUserId) {
        lock()
        if (typeof window !== 'undefined') window.location.reload()
      }
    })
    return () => registerLoginBroadcastCallback(() => {})
  }, [lock])

  const value = useMemo<KeyState>(
    () => ({
      cryptoReady,
      cryptoLoading,
      cryptoError,
      isUnlocked,
      vaultExists,
      vaultChecked,
      setMasterKey,
      setMasterKeyDirect,
      setMasterKeyFromPasskey,
      unlockVault,
      unlockVaultWithPasskey,
      unlock,
      isUnlockedFor,
      getResidentUserId,
      getFileKey,
      getFileKeyForFile,
      getMasterKey,
      lock,
      fullLogout,
    }),
    [cryptoReady, cryptoLoading, cryptoError, isUnlocked, vaultExists, vaultChecked, setMasterKey, setMasterKeyDirect, setMasterKeyFromPasskey, unlockVault, unlockVaultWithPasskey, unlock, isUnlockedFor, getResidentUserId, getFileKey, getFileKeyForFile, getMasterKey, lock, fullLogout],
  )

  return <KeyContext.Provider value={value}>{children}</KeyContext.Provider>
}

export function useKeys(): KeyState {
  const ctx = useContext(KeyContext)
  if (!ctx) {
    throw new Error('useKeys must be used within a KeyProvider')
  }
  return ctx
}
