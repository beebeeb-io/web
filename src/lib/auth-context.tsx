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
  clearToken,
  getMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
} from './api'

/** Callback registered by KeyProvider to lock keys on logout. */
let onLogoutCallback: (() => void) | null = null

export function registerLogoutCallback(cb: () => void): void {
  onLogoutCallback = cb
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  signup: (email: string, password: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
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

  const signup = useCallback(async (email: string, password: string) => {
    const { user: u } = await apiSignup(email, password)
    setUser(u)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await apiLogin(email, password)
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    onLogoutCallback?.()
    await apiLogout()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, signup, login, logout }),
    [user, loading, signup, login, logout],
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
