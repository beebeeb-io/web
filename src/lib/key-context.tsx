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
import { registerLogoutCallback } from './auth-context'
import { wrapAndStore, unwrap, hasVault, clearVault, wrapAndStoreWithPasskey, unwrapWithPasskey } from './vault'
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
import { setRecoveryCheckIfAbsent } from './api'
import type { DriveFile } from './api'
import { useAuth } from './auth-context'
import { isRequestUpload, createRequestKeyResolver, type RequestKeyResolver } from './file-request-crypto'
import { backfillRecoveryCheckIfAbsent } from './recovery-validation'

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
  /** Unwrap the master key from IndexedDB using password. Returns true if successful. */
  unlockVault: (password: string, userId: string) => Promise<boolean>
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
  /** Derive a per-file key from the master key (async — runs in worker). */
  getFileKey: (fileId: string) => Promise<Uint8Array>
  /** Resolve the decryption key for a DriveFile. Files received through a file
   *  request carry a sealed content key (file_request_id + sender_ephemeral_pubkey
   *  + wrapped_content_key) and must be opened via the request-key path; all other
   *  files use the normal derive_file_key(master, id) path. Prefer this over
   *  getFileKey wherever the full file object is available (naming, preview,
   *  download). */
  getFileKeyForFile: (file: DriveFile) => Promise<Uint8Array>
  /** Get the raw master key (for X25519 key exchange in sharing). */
  getMasterKey: () => Uint8Array
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
  const [isUnlocked, setIsUnlocked] = useState(false)
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

  // Returns the cached key AND the account id it was stamped for — the
  // caller (the boot effect below) decides whether that id is trustworthy
  // for whoever the CURRENT auth session turns out to be; restoreCachedKey
  // itself has no way to know that yet (see the boot effect's own comment).
  const restoreCachedKey = useCallback(async (): Promise<{ key: Uint8Array; userId: string | null } | null> => {
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
        try { await cacheVaultKey(persisted.key, persisted.userId ?? '') } catch { /* ok */ }
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
  // Order matters: masterKeyRef.current is set BEFORE setIsUnlocked(true) and
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
          setIsUnlocked(true)
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
    setIsUnlocked(true)
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
    setIsUnlocked(true)
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
    setIsUnlocked(true)
    void cacheKeySessionOnly(key, userId)
    backfillRecoveryCheck(key)
  }, [backfillRecoveryCheck])

  const setMasterKeyFromPasskey = useCallback(async (key: Uint8Array, wrapKey: Uint8Array, userId: string) => {
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    await wrapAndStoreWithPasskey(key, wrapKey, userId)
    setVaultExists(true)
    setIsUnlocked(true)
    cacheKey(key, userId)
    backfillRecoveryCheck(key)
  }, [cacheKey, backfillRecoveryCheck])

  const unlockVaultWithPasskey = useCallback(async (wrapKey: Uint8Array, userId: string): Promise<boolean> => {
    const key = await unwrapWithPasskey(wrapKey, userId)
    if (!key) return false
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    setIsUnlocked(true)
    cacheKey(key, userId)
    backfillRecoveryCheck(key)
    return true
  }, [cacheKey, backfillRecoveryCheck])

  const unlockVault = useCallback(async (password: string, userId: string): Promise<boolean> => {
    const key = await unwrap(password, userId)
    if (!key) return false
    masterKeyRef.current = key
    residentKeyUserIdRef.current = userId
    setIsUnlocked(true)
    cacheKey(key, userId)
    backfillRecoveryCheck(key)
    return true
  }, [cacheKey, backfillRecoveryCheck])

  const getFileKey = useCallback(async (fileId: string): Promise<Uint8Array> => {
    if (!masterKeyRef.current) {
      throw new Error('Vault is locked — unlock first')
    }
    return deriveFileKey(masterKeyRef.current, fileId)
  }, [])

  // Lazily-created resolver for files received through a file request. Caches the
  // request list + unwrapped R_priv per request for the drive session.
  const requestResolverRef = useRef<RequestKeyResolver | null>(null)

  const getFileKeyForFile = useCallback(async (file: DriveFile): Promise<Uint8Array> => {
    if (!masterKeyRef.current) {
      throw new Error('Vault is locked — unlock first')
    }
    if (isRequestUpload(file)) {
      if (!requestResolverRef.current) requestResolverRef.current = createRequestKeyResolver()
      return requestResolverRef.current.resolveFileKey(file, masterKeyRef.current)
    }
    return deriveFileKey(masterKeyRef.current, file.id)
  }, [])

  const getMasterKey = useCallback((): Uint8Array => {
    if (!masterKeyRef.current) {
      throw new Error('Vault is locked — unlock first')
    }
    return masterKeyRef.current
  }, [])

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
    setIsUnlocked(false)
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
    setIsUnlocked(false)
  }, [clearCachedKey])

  // Full clear on explicit logout — wipe in-memory key AND IndexedDB vault.
  // The user chose to log out, so the device should not retain wrapped keys.
  useEffect(() => {
    registerLogoutCallback(fullLogout)
    return () => registerLogoutCallback(() => {})
  }, [fullLogout])

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
      getFileKey,
      getFileKeyForFile,
      getMasterKey,
      lock,
      fullLogout,
    }),
    [cryptoReady, cryptoLoading, cryptoError, isUnlocked, vaultExists, vaultChecked, setMasterKey, setMasterKeyDirect, setMasterKeyFromPasskey, unlockVault, unlockVaultWithPasskey, unlock, isUnlockedFor, getFileKey, getFileKeyForFile, getMasterKey, lock, fullLogout],
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
