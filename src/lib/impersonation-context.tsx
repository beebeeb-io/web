import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminImpersonate, getToken, setToken } from './api'

const ADMIN_TOKEN_KEY = 'bb_admin_token'

interface ImpersonationState {
  /** The email of the user currently being impersonated, or null. */
  impersonatingEmail: string | null
  /** Start impersonating a user. Saves the admin token and swaps in the new one. */
  startImpersonation: (userId: string) => Promise<void>
  /** Stop impersonating. Restores the admin token. */
  stopImpersonation: () => void
}

const ImpersonationContext = createContext<ImpersonationState | null>(null)

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  // Restore state from sessionStorage on mount — if admin token is saved, we're impersonating
  const [impersonatingEmail, setImpersonatingEmail] = useState<string | null>(() => {
    const savedEmail = sessionStorage.getItem('bb_impersonating_email')
    const savedAdminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY)
    if (savedEmail && savedAdminToken) return savedEmail
    return null
  })

  const startImpersonation = useCallback(async (userId: string) => {
    const currentToken = getToken()
    if (!currentToken) return

    const data = await adminImpersonate(userId)

    // Save the admin token so we can restore it later
    sessionStorage.setItem(ADMIN_TOKEN_KEY, currentToken)
    sessionStorage.setItem('bb_impersonating_email', data.email)

    // Swap to the impersonated user's token
    setToken(data.session_token)
    setImpersonatingEmail(data.email)

    // Navigate to drive
    navigate('/', { replace: true })

    // Force a full page reload so all contexts (auth, keys, etc.) re-initialize
    // with the new token. This is the safest approach since many contexts
    // cache user data on mount.
    window.location.href = '/'
  }, [navigate])

  const stopImpersonation = useCallback(() => {
    const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY)
    if (!adminToken) return

    // Restore admin token
    setToken(adminToken)

    // Clean up
    sessionStorage.removeItem(ADMIN_TOKEN_KEY)
    sessionStorage.removeItem('bb_impersonating_email')
    setImpersonatingEmail(null)

    // Navigate back to admin users and reload so contexts reinitialize
    window.location.href = '/admin/users'
  }, [])

  const value = useMemo<ImpersonationState>(
    () => ({ impersonatingEmail, startImpersonation, stopImpersonation }),
    [impersonatingEmail, startImpersonation, stopImpersonation],
  )

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation(): ImpersonationState {
  const ctx = useContext(ImpersonationContext)
  if (!ctx) {
    throw new Error('useImpersonation must be used within an ImpersonationProvider')
  }
  return ctx
}
