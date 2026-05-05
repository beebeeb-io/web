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
} from './crypto'
import { registerLogoutCallback } from './auth-context'
import { wrapAndStore, unwrap, hasVault, clearVault } from './vault'

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
  /** Unwrap the master key from IndexedDB using password. Returns true if successful. */
  unlockVault: (password: string) => Promise<boolean>
  /** Derive master key from password + salt (legacy path). */
  unlock: (password: string, salt: Uint8Array) => Promise<void>
  /** Derive a per-file key from the master key (async — runs in worker). */
  getFileKey: (fileId: string) => Promise<Uint8Array>
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

  const cacheKey = useCallback(async (key: Uint8Array) => {
    try {
      const sessionKey = crypto.getRandomValues(new Uint8Array(32))
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ck = await crypto.subtle.importKey('raw', sessionKey.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt'])
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, key.buffer as ArrayBuffer)
      sessionStorage.setItem('bb_sk', btoa(String.fromCharCode(...sessionKey)))
      sessionStorage.setItem('bb_iv', btoa(String.fromCharCode(...iv)))
      sessionStorage.setItem('bb_mk', btoa(String.fromCharCode(...new Uint8Array(ct))))
    } catch { /* best effort */ }
  }, [])

  const restoreCachedKey = useCallback(async (): Promise<Uint8Array | null> => {
    try {
      const skB64 = sessionStorage.getItem('bb_sk')
      const ivB64 = sessionStorage.getItem('bb_iv')
      const mkB64 = sessionStorage.getItem('bb_mk')
      if (!skB64 || !ivB64 || !mkB64) return null
      const sk = Uint8Array.from(atob(skB64), c => c.charCodeAt(0))
      const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
      const ct = Uint8Array.from(atob(mkB64), c => c.charCodeAt(0))
      const ck = await crypto.subtle.importKey('raw', sk.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt'])
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, ct.buffer as ArrayBuffer)
      return new Uint8Array(pt)
    } catch {
      sessionStorage.removeItem('bb_sk')
      sessionStorage.removeItem('bb_iv')
      sessionStorage.removeItem('bb_mk')
      return null
    }
  }, [])

  const clearCachedKey = useCallback(() => {
    sessionStorage.removeItem('bb_sk')
    sessionStorage.removeItem('bb_iv')
    sessionStorage.removeItem('bb_mk')
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
        const exists = await hasVault()
        if (cancelled) return
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

  const unlock = useCallback(async (password: string, salt: Uint8Array) => {
    const { masterKey } = await deriveKeys(password, salt)
    masterKeyRef.current = masterKey
    setIsUnlocked(true)
    cacheKey(masterKey)
  }, [cacheKey])

  const setMasterKey = useCallback(async (key: Uint8Array, password: string) => {
    masterKeyRef.current = key
    await wrapAndStore(key, password)
    setVaultExists(true)
    setIsUnlocked(true)
    cacheKey(key)
  }, [cacheKey])

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    const key = await unwrap(password)
    if (!key) return false
    masterKeyRef.current = key
    setIsUnlocked(true)
    cacheKey(key)
    return true
  }, [cacheKey])

  const getFileKey = useCallback(async (fileId: string): Promise<Uint8Array> => {
    if (!masterKeyRef.current) {
      throw new Error('Vault is locked — unlock first')
    }
    return deriveFileKey(masterKeyRef.current, fileId)
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
    clearCachedKey()
    setIsUnlocked(false)
  }, [clearCachedKey])

  const fullLogout = useCallback(async () => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
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
      unlockVault,
      unlock,
      getFileKey,
      getMasterKey,
      lock,
      fullLogout,
    }),
    [cryptoReady, cryptoLoading, cryptoError, isUnlocked, vaultExists, vaultChecked, setMasterKey, unlockVault, unlock, getFileKey, getMasterKey, lock, fullLogout],
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
