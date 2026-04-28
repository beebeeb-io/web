import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
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

/** Callback registered by KeyProvider to lock keys on logout. */
let onLogoutCallback: (() => void) | null = null

export function registerLogoutCallback(cb: () => void): void {
  onLogoutCallback = cb
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  signup: (email: string, password: string) => Promise<SignupResult>
  login: (email: string, password: string) => Promise<LoginResult>
  verify2fa: (partialToken: string, code: string) => Promise<LoginResult>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    getMe()
      .then(setUser)
      .catch(() => {
        clearToken()
      })
      .finally(() => setLoading(false))
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

  const logout = useCallback(async () => {
    onLogoutCallback?.()
    await apiLogout()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, signup, login, verify2fa, logout }),
    [user, loading, signup, login, verify2fa, logout],
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
