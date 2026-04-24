// ─── Key context ────────────────────────────────────
// Holds the master key in memory. Never persists to storage.

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

interface KeyState {
  /** True once WASM is loaded and ready. */
  cryptoReady: boolean
  /** True while WASM is loading. */
  cryptoLoading: boolean
  /** Error message if WASM failed to load. */
  cryptoError: string | null
  /** Whether the vault is unlocked (master key present). */
  isUnlocked: boolean
  /** Derive master key from password + salt, store in memory. */
  unlock: (password: string, salt: Uint8Array) => Promise<void>
  /** Set the master key directly (e.g. from recovery phrase or signup). */
  setMasterKey: (key: Uint8Array) => void
  /** Derive a per-file key from the master key (async — runs in worker). */
  getFileKey: (fileId: string) => Promise<Uint8Array>
  /** Zero and clear the master key. */
  lock: () => void
}

const KeyContext = createContext<KeyState | null>(null)

export function KeyProvider({ children }: { children: ReactNode }) {
  const [cryptoReady, setCryptoReady] = useState(false)
  const [cryptoLoading, setCryptoLoading] = useState(true)
  const [cryptoError, setCryptoError] = useState<string | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)

  // Store master key in a ref to avoid it showing up in React devtools state
  const masterKeyRef = useRef<Uint8Array | null>(null)

  // Initialize WASM on mount
  useState(() => {
    initCrypto()
      .then(() => {
        setCryptoReady(true)
        setCryptoLoading(false)
      })
      .catch((err) => {
        setCryptoError(
          err instanceof Error ? err.message : 'Failed to load encryption module',
        )
        setCryptoLoading(false)
      })
  })

  const unlock = useCallback(async (password: string, salt: Uint8Array) => {
    const { masterKey } = await deriveKeys(password, salt)
    masterKeyRef.current = masterKey
    setIsUnlocked(true)
  }, [])

  const setMasterKey = useCallback((key: Uint8Array) => {
    masterKeyRef.current = key
    setIsUnlocked(true)
  }, [])

  const getFileKey = useCallback(async (fileId: string): Promise<Uint8Array> => {
    if (!masterKeyRef.current) {
      throw new Error('Vault is locked — unlock first')
    }
    return deriveFileKey(masterKeyRef.current, fileId)
  }, [])

  const lock = useCallback(() => {
    if (masterKeyRef.current) {
      zeroize(masterKeyRef.current)
      masterKeyRef.current = null
    }
    setIsUnlocked(false)
  }, [])

  // Auto-lock on logout
  useEffect(() => {
    registerLogoutCallback(lock)
    return () => registerLogoutCallback(() => {})
  }, [lock])

  const value = useMemo<KeyState>(
    () => ({
      cryptoReady,
      cryptoLoading,
      cryptoError,
      isUnlocked,
      unlock,
      setMasterKey,
      getFileKey,
      lock,
    }),
    [cryptoReady, cryptoLoading, cryptoError, isUnlocked, unlock, setMasterKey, getFileKey, lock],
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
