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
  ApiError,
  type AuthUser,
  type LoginResult,
  type SignupResult,
  clearToken,
  getMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  verify2fa as apiVerify2fa,
} from './api'

/** Same-origin pub/sub channel used to sync logout across tabs. */
const AUTH_CHANNEL_NAME = 'beebeeb-auth'

type AuthBroadcastMessage = { type: 'logout' }

/** Callback registered by KeyProvider to clear keys + vault on logout. */
let onLogoutCallback: (() => void | Promise<void>) | null = null

export function registerLogoutCallback(cb: () => void | Promise<void>): void {
  onLogoutCallback = cb
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  signup: (email: string, password: string) => Promise<SignupResult>
  login: (email: string, password: string) => Promise<LoginResult>
  refreshUser: () => Promise<void>
  verify2fa: (partialToken: string, code: string) => Promise<LoginResult>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // BroadcastChannel for multi-tab logout sync. Guard against environments
  // without support (Safari < 15.4, SSR) — the feature degrades to no-op.
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    // task 0447 — session-cookie migration.
    //
    // Three startup shapes we must handle:
    //   (a) Brand-new visitor / logged out — no token in localStorage and
    //       no bb_session cookie. getMe() will 401 and we drop them on /login.
    //   (b) Returning user, already on cookies — localStorage is empty but
    //       the bb_session cookie is set. getMe() succeeds because the
    //       request carries the cookie.
    //   (c) Legacy user, still on localStorage — localStorage has a token
    //       but the cookie isn't set yet. Before calling getMe() we hand
    //       the token to POST /auth/upgrade-session, which sets the cookie
    //       and lets us drop localStorage. From then on, this device is
    //       indistinguishable from (b).
    const legacyToken = getToken()
    const boot = async () => {
      if (legacyToken) {
        try {
          const apiUrl = import.meta.env.VITE_API_URL || 'https://api.beebeeb.io'
          // Bearer auth for this one call; the response sets the cookie.
          const res = await fetch(`${apiUrl}/api/v1/auth/upgrade-session`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${legacyToken}`,
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: '{}',
          })
          if (res.ok) {
            // Cookie now set — drop localStorage so XSS can't read the
            // token from there any more.
            clearToken()
          } else if (res.status === 401) {
            // Token was already invalid. Wipe localStorage too — no point
            // keeping a dead value around.
            clearToken()
          }
          // Any other status: leave the localStorage token in place so the
          // user can still authenticate via Bearer until the next attempt.
        } catch {
          // Network error during upgrade — keep the localStorage token and
          // let the next normal request retry the upgrade implicitly via
          // its own bearer header.
        }
      }
      // Now check the session — works for both cookie and (legacy) bearer.
      try {
        const u = await getMe()
        setUser(u)
      } catch (err) {
        // Only clear session on genuine 401 expiry — not network errors or 5xx.
        // For transient failures, keep the token so the user can retry.
        if (err instanceof ApiError && err.status === 401) {
          clearToken()
        }
      } finally {
        setLoading(false)
      }
    }
    void boot()
  }, [])

  // Open the BroadcastChannel for multi-tab logout sync. When another tab
  // posts { type: 'logout' }, this tab runs the local logout cleanup and
  // redirects to /login. We deliberately do NOT call the public logout()
  // function from the message handler — that would re-broadcast and loop.
  // Instead we invoke the registered logout cleanup directly and clear
  // local state, mirroring what logout() does minus the broadcast.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME)
    channelRef.current = channel
    const onMessage = (event: MessageEvent<AuthBroadcastMessage>) => {
      if (event.data?.type !== 'logout') return
      // Local cleanup only — no re-broadcast. fullLogout (registered by
      // KeyProvider) zeroes the master key + clears the IndexedDB vault.
      void (async () => {
        try {
          await onLogoutCallback?.()
        } finally {
          // Best-effort server-side logout in case the API token is still
          // present in this tab. We swallow errors — the local clear is
          // what matters for privacy and the redirect happens regardless.
          try { await apiLogout() } catch { /* ignore */ }
          setUser(null)
          // Hard navigation forces a fresh app boot in the receiving tab,
          // guaranteeing no stale in-memory state survives the logout.
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
      })()
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
      channelRef.current = null
    }
  }, [])

  const signup = useCallback(async (email: string, password: string): Promise<SignupResult> => {
    const result = await apiSignup(email, password)
    const u = await getMe()
    setUser(u)
    return result
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await apiLogin(email, password)
    if (!result.requires_2fa) {
      // Full login — fetch user profile
      const u = await getMe()
      setUser(u)
    }
    return result
  }, [])

  const verify2fa = useCallback(async (partialToken: string, code: string): Promise<LoginResult> => {
    const result = await apiVerify2fa(partialToken, code)
    const u = await getMe()
    setUser(u)
    return result
  }, [])

  const refreshUser = useCallback(async () => {
    const u = await getMe()
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    // Notify other tabs first so they can clear their master key in parallel
    // with this tab's local cleanup. Receivers run the same local logout
    // path but do NOT re-broadcast (see the channel onMessage handler).
    try {
      channelRef.current?.postMessage({ type: 'logout' } satisfies AuthBroadcastMessage)
    } catch { /* channel may already be closed during teardown */ }
    await onLogoutCallback?.()
    await apiLogout()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, signup, login, refreshUser, verify2fa, logout }),
    [user, loading, signup, login, refreshUser, verify2fa, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
