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
  /** Set the master key and wrap it with password into IndexedDB vault. */
  setMasterKey: (key: Uint8Array, password: string) => Promise<void>
  /** Set the master key directly without password wrapping (passkey vault unlock). */
  setMasterKeyDirect: (key: Uint8Array) => void
  /** Set the master key and wrap it with a passkey-derived key into IndexedDB. */
  setMasterKeyFromPasskey: (key: Uint8Array, wrapKey: Uint8Array) => Promise<void>
  /** Unwrap the master key from IndexedDB using password. Returns true if successful. */
  unlockVault: (password: string) => Promise<boolean>
  /** Unwrap the master key from IndexedDB using a passkey-derived wrap key. Returns true if successful. */
  unlockVaultWithPasskey: (wrapKey: Uint8Array) => Promise<boolean>
  /** Derive master key from password + salt (legacy path). */
  unlock: (password: string, salt: Uint8Array) => Promise<void>
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

  const masterKeyRef = useRef<Uint8Array | null>(null)

  // Wrap the master key with the tab's non-extractable session key and persist
  // to IndexedDB. Failures are swallowed — caching is an enhancement; the live
  // masterKeyRef is the source of truth within the tab. Delegates to
  // key-cache.ts (unit-testable — see its doc comments) rather than calling
  // cacheVaultKey/persistSession directly.
  const cacheKey = useCallback(async (key: Uint8Array) => {
    await cacheKeyPersistent(key)
  }, [])

  const restoreCachedKey = useCallback(async (): Promise<Uint8Array | null> => {
    // Try in-tab session cache first (fastest, same-tab only)
    try {
      const tabKey = await getVaultKey()
      if (tabKey) return tabKey
    } catch { /* fall through */ }
    // Try persistent session (survives refresh, TTL-bounded)
    try {
      const persisted = await restoreSession()
      if (persisted) {
        // Re-cache in the tab session for faster subsequent access
        try { await cacheVaultKey(persisted) } catch { /* ok */ }
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
          masterKeyRef.current = cached
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

  const unlock = useCallback(async (password: string, salt: Uint8Array) => {
    const { masterKey } = await deriveKeys(password, salt)
    masterKeyRef.current = masterKey
    setIsUnlocked(true)
    cacheKey(masterKey)
  }, [cacheKey])

  // Task 1529 continuation (web #73, P2): masterKeyRef is set ONLY after
  // wrapAndStore succeeds — if it threw first (e.g. the empty/whitespace
  // secret guard), the live in-memory key must not silently become "the
  // key that failed to persist" while the rest of the app already thinks
  // isUnlocked. On throw, zero the caller's key material (it's not going
  // anywhere) and rethrow so the caller's own catch/finally still runs.
  const setMasterKey = useCallback(async (key: Uint8Array, password: string) => {
    try {
      await wrapAndStore(key, password)
    } catch (err) {
      zeroize(key)
      throw err
    }
    masterKeyRef.current = key
    setVaultExists(true)
    setIsUnlocked(true)
    cacheKey(key)
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
  const setMasterKeyDirect = useCallback((key: Uint8Array) => {
    masterKeyRef.current = key
    setIsUnlocked(true)
    void cacheKeySessionOnly(key)
    backfillRecoveryCheck(key)
  }, [backfillRecoveryCheck])

  const setMasterKeyFromPasskey = useCallback(async (key: Uint8Array, wrapKey: Uint8Array) => {
    masterKeyRef.current = key
    await wrapAndStoreWithPasskey(key, wrapKey)
    setVaultExists(true)
    setIsUnlocked(true)
    cacheKey(key)
    backfillRecoveryCheck(key)
  }, [cacheKey, backfillRecoveryCheck])

  const unlockVaultWithPasskey = useCallback(async (wrapKey: Uint8Array): Promise<boolean> => {
    const key = await unwrapWithPasskey(wrapKey)
    if (!key) return false
    masterKeyRef.current = key
    setIsUnlocked(true)
    cacheKey(key)
    backfillRecoveryCheck(key)
    return true
  }, [cacheKey, backfillRecoveryCheck])

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    const key = await unwrap(password)
    if (!key) return false
    masterKeyRef.current = key
    setIsUnlocked(true)
    cacheKey(key)
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

  const lock = useCallback(() => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
    requestResolverRef.current?.clear()
    requestResolverRef.current = null
    clearCachedKey()
    setIsUnlocked(false)
  }, [clearCachedKey])

  const fullLogout = useCallback(async () => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
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
      getFileKey,
      getFileKeyForFile,
      getMasterKey,
      lock,
      fullLogout,
    }),
    [cryptoReady, cryptoLoading, cryptoError, isUnlocked, vaultExists, vaultChecked, setMasterKey, setMasterKeyDirect, setMasterKeyFromPasskey, unlockVault, unlockVaultWithPasskey, unlock, getFileKey, getFileKeyForFile, getMasterKey, lock, fullLogout],
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
