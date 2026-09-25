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

/** Same-origin pub/sub channel used to sync logout — and, since task 1531/
 *  1534's continuation (web PR #85), login — across tabs. */
const AUTH_CHANNEL_NAME = 'beebeeb-auth'

type AuthBroadcastMessage =
  | { type: 'logout' }
  /** Task 1531/1534 (P0 continuation, crypto-security-reviewer P1): fired
   *  after EVERY successful signup/login/2FA-verify so other tabs can tell
   *  whether the shared session cookie just switched to a DIFFERENT
   *  account than whatever master key they have resident — see
   *  key-context.tsx's registered handler for what it does with this. */
  | { type: 'login'; userId: string }

/** Callback registered by KeyProvider to clear keys + vault on logout. */
let onLogoutCallback: (() => void | Promise<void>) | null = null

export function registerLogoutCallback(cb: () => void | Promise<void>): void {
  onLogoutCallback = cb
}

/** Callback registered by KeyProvider, fired on a same-origin 'login'
 *  broadcast from another tab (task 1531/1534 P0 continuation). */
let onLoginBroadcastCallback: ((userId: string) => void) | null = null

export function registerLoginBroadcastCallback(cb: (userId: string) => void): void {
  onLoginBroadcastCallback = cb
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
        // Task 1404 — a soft-deleted account (task 1403's account_deleted
        // 403) needs NO special handling here: `request()` (shared) already
        // clears the token and fires the central `registerAccountDeletedHandler`
        // (app.tsx) with the full body BEFORE this catch even runs, which
        // stashes the exact "deleted on <date>… shredded on <date>…" copy and
        // redirects to /login. `user` stays null either way, which is also
        // what ProtectedRoute needs to bounce here on its own. See
        // packages/shared/src/api/request.ts + src/lib/account-deleted-notice.ts.
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
      if (event.data?.type === 'login') {
        // Task 1531/1534 (P0 continuation): a DIFFERENT tab just
        // authenticated as `userId` — let KeyProvider's registered handler
        // decide whether a key resident HERE needs to be dropped. Never a
        // hard navigation on its own; the handler reloads only on an actual
        // mismatch (see its own doc comment in key-context.tsx).
        onLoginBroadcastCallback?.(event.data.userId)
        return
      }
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

  // Task 1531/1534 (P0 continuation, web PR #85): best-effort — a channel
  // that failed to open (Safari < 15.4, SSR) just means no cross-tab signal,
  // never a reason to fail the auth call that succeeded.
  const broadcastLogin = useCallback((userId: string) => {
    try {
      channelRef.current?.postMessage({ type: 'login', userId } satisfies AuthBroadcastMessage)
    } catch { /* channel may already be closed during teardown */ }
  }, [])

  const signup = useCallback(async (email: string, password: string): Promise<SignupResult> => {
    const result = await apiSignup(email, password)
    const u = await getMe()
    setUser(u)
    broadcastLogin(u.user_id)
    return result
  }, [broadcastLogin])

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await apiLogin(email, password)
    if (!result.requires_2fa) {
      // Full login — fetch user profile
      const u = await getMe()
      setUser(u)
      broadcastLogin(u.user_id)
    }
    return result
  }, [broadcastLogin])

  const verify2fa = useCallback(async (partialToken: string, code: string): Promise<LoginResult> => {
    const result = await apiVerify2fa(partialToken, code)
    const u = await getMe()
    setUser(u)
    broadcastLogin(u.user_id)
    return result
  }, [broadcastLogin])

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
    // Best-effort server-side logout — the session may already be gone (e.g.
    // account deletion invalidates ALL of the user's sessions server-side
    // before this ever runs, task 1407) or the network may be down. Local
    // state must clear regardless: callers rely on `user` being null the
    // moment this resolves to decide whether it's safe to navigate to a
    // guest-only route. Mirrors the identical best-effort handling already
    // used by the BroadcastChannel receiver above.
    try {
      await apiLogout()
    } catch { /* ignore — local cleanup is what matters here */ }
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

/**
 * The correct "is this visitor logged in" signal — task 1471.
 *
 * Call sites used to read `!!getToken()` (the legacy `bb_session`
 * localStorage slot) for this. That slot only exists transiently: the boot
 * effect above hands it to `/auth/upgrade-session` and clears it (or wipes
 * it on a 401) almost immediately, and a normal login/signup/2FA-verify
 * flow never writes it at all (the server sets the httpOnly cookie
 * directly). So for a real, fully cookie-authenticated user `getToken()` is
 * effectively always `null` — any decision branching on it reads that user
 * as logged out.
 *
 * `useAuth().user` is the actual cookie-session truth (set from `getMe()`
 * in the boot effect / after login / after signup / after 2FA-verify).
 * Exported as a plain function of `user` — not only via the hook — so call
 * sites that just need the boolean (and unit tests) don't need a component
 * render. Callers that can render conditionally on `useAuth().loading`
 * should do so too: `user` is `null` while loading resolves, same as when
 * genuinely logged out, so a decision taken mid-load can still be wrong in
 * the other direction for a fraction of a second.
 */
export function isAuthenticated(user: AuthUser | null): boolean {
  return user !== null
}
