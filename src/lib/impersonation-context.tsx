import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminImpersonate, clearToken, getMe, getToken, setToken } from './api'

const ADMIN_TOKEN_KEY = 'bb_admin_token'
const IMPERSONATING_EMAIL_KEY = 'bb_impersonating_email'
const IMPERSONATING_ADMIN_ID_KEY = 'bb_impersonating_admin_id'

interface ImpersonationState {
  /** The email of the user currently being impersonated, or null. */
  impersonatingEmail: string | null
  /** Start impersonating a user. Saves the admin token and swaps in the new one. */
  startImpersonation: (userId: string) => Promise<void>
  /** Stop impersonating. Restores the admin token, or signs out if there is no admin token (token-based flow). */
  stopImpersonation: () => void
}

const ImpersonationContext = createContext<ImpersonationState | null>(null)

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  // Restore from sessionStorage. The legacy flow stored an admin token to
  // swap back to; the token-based flow (task 0161) opens this app in a
  // brand-new tab so there is no admin token here — only the email marker
  // dropped by /auth/impersonate. Either marker is enough to show the banner.
  const [impersonatingEmail, setImpersonatingEmail] = useState<string | null>(() => {
    return sessionStorage.getItem(IMPERSONATING_EMAIL_KEY)
  })

  // If the email marker isn't set (e.g. the admin landed in this tab via a
  // direct link without going through /auth/impersonate, or sessionStorage
  // was cleared), fall back to /me which now reports `is_impersonation` and
  // the user's email server-side. Single-shot: only run when no email is set.
  useEffect(() => {
    if (impersonatingEmail) return
    let cancelled = false
    ;(async () => {
      try {
        const me = await getMe()
        if (cancelled) return
        if (me.is_impersonation && me.email) {
          sessionStorage.setItem(IMPERSONATING_EMAIL_KEY, me.email)
          if (me.admin_user_id) {
            sessionStorage.setItem(IMPERSONATING_ADMIN_ID_KEY, me.admin_user_id)
          }
          setImpersonatingEmail(me.email)
        }
      } catch {
        /* unauthenticated or offline — banner stays hidden */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [impersonatingEmail])

  const startImpersonation = useCallback(async (userId: string) => {
    const currentToken = getToken()
    if (!currentToken) return

    const data = await adminImpersonate(userId)

    // Save the admin token so we can restore it later
    sessionStorage.setItem(ADMIN_TOKEN_KEY, currentToken)
    sessionStorage.setItem(IMPERSONATING_EMAIL_KEY, data.email)

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

    // Always clear impersonation markers regardless of which flow we used.
    sessionStorage.removeItem(IMPERSONATING_EMAIL_KEY)
    sessionStorage.removeItem(IMPERSONATING_ADMIN_ID_KEY)
    setImpersonatingEmail(null)

    if (adminToken) {
      // Legacy in-tab swap: restore the admin token and bounce back to the
      // admin portal's user list.
      sessionStorage.removeItem(ADMIN_TOKEN_KEY)
      setToken(adminToken)
      window.location.href = '/admin/users'
      return
    }

    // Token-based flow (task 0161): there is no admin token in this tab —
    // the admin opened us in a new tab from admin.beebeeb.io. Sign out the
    // impersonated session and close the tab so the admin returns to their
    // already-open admin tab. If the browser refuses window.close() (only
    // tabs the script opened may close themselves), fall back to a redirect
    // so the user is at least no longer authenticated as the target.
    clearToken()
    const closed = (() => {
      try {
        window.close()
        return window.closed
      } catch {
        return false
      }
    })()
    if (!closed) {
      window.location.href = 'https://admin.beebeeb.io/'
    }
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
