import { useCallback, useEffect, useRef, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { getMe, listSessions, logout as apiLogout } from '../lib/api'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { useNavigate } from 'react-router-dom'

// How many ms before expiry to show the warning dialog.
const WARN_BEFORE_MS = 5 * 60 * 1000 // 5 minutes

// JS setTimeout delay is stored as a 32-bit signed int. Delays > 2^31-1 ms
// (~24.8 days) silently overflow and fire immediately. Cap timers at this limit;
// the 30-minute liveness ping will reschedule if the expiry is further out.
const MAX_TIMEOUT_MS = 2147483647

// How often to re-check the session expiry (when no expiry is known, we fall
// back to a liveness ping via getMe to catch silent 401s).
const LIVENESS_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

// Countdown tick interval.
const TICK_MS = 1000

/**
 * SessionTimeoutWarning — mounts inside ProtectedRoute, invisible until the
 * session is about to expire.
 *
 * Expiry detection strategy (in order):
 *  1. Call GET /api/v1/auth/sessions to find the current session's expires_at.
 *     Set a timer to show the dialog WARN_BEFORE_MS before that timestamp.
 *  2. If the endpoint is unavailable (404 / network error), fall back to a
 *     liveness ping: call GET /api/v1/auth/me every 30 minutes. A 401 response
 *     will be caught by the global registerSessionExpiredHandler which redirects
 *     to /login — no additional handling needed here.
 *
 * "Stay logged in" button — there is no server-side token refresh endpoint.
 * Clicking "Stay logged in" calls getMe() to confirm the session is still valid
 * and resets the local expiry timer by re-fetching the sessions list.
 */
export function SessionTimeoutWarning() {
  const [open, setOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const navigate = useNavigate()

  // Refs so timers can always read the latest values without stale closures.
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const livenessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiresAtRef = useRef<Date | null>(null)

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)

  // Clear all timers.
  const clearAll = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current)
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
    if (livenessTimerRef.current) clearInterval(livenessTimerRef.current)
    warnTimerRef.current = null
    expireTimerRef.current = null
    countdownTimerRef.current = null
    livenessTimerRef.current = null
  }, [])

  // Start countdown ticker and the hard-expiry timer from the stored expiresAt.
  const startCountdown = useCallback((expiresAt: Date) => {
    // Clear any previous countdown.
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current)

    const updateSeconds = () => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setSecondsLeft(remaining)
    }
    updateSeconds()

    countdownTimerRef.current = setInterval(updateSeconds, TICK_MS)

    const msUntilExpiry = expiresAt.getTime() - Date.now()
    if (msUntilExpiry > 0 && msUntilExpiry <= MAX_TIMEOUT_MS) {
      expireTimerRef.current = setTimeout(() => {
        // Session has expired — close the dialog and redirect to login.
        setOpen(false)
        navigate('/login', { replace: true })
      }, msUntilExpiry)
    }
  }, [navigate])

  // Schedule the warning dialog and expiry redirect from a known expiry time.
  const scheduleFromExpiry = useCallback((expiresAt: Date) => {
    clearAll()
    expiresAtRef.current = expiresAt

    const now = Date.now()
    const msUntilExpiry = expiresAt.getTime() - now

    if (msUntilExpiry <= 0) {
      // Already expired.
      navigate('/login', { replace: true })
      return
    }

    const msUntilWarn = msUntilExpiry - WARN_BEFORE_MS

    if (msUntilExpiry <= WARN_BEFORE_MS) {
      // Less than 5 minutes left — show warning immediately.
      setOpen(true)
      startCountdown(expiresAt)
    } else if (msUntilWarn <= MAX_TIMEOUT_MS) {
      // Warn time is within the safe setTimeout range — schedule it.
      warnTimerRef.current = setTimeout(() => {
        setOpen(true)
        startCountdown(expiresAt)
      }, msUntilWarn)
    }
    // else: expiry is > ~24.8 days out; the 30-min liveness ping will
    // reschedule before we need to show a warning.
  }, [clearAll, navigate, startCountdown])

  // Fetch the current session's expiry from the server and schedule timers.
  const fetchAndSchedule = useCallback(async () => {
    try {
      const { sessions } = await listSessions()
      const current = sessions.find((s) => s.is_current)
      if (current?.expires_at) {
        scheduleFromExpiry(new Date(current.expires_at))
      }
      // If no current session found, fall back to liveness pings (already set
      // up in useEffect below).
    } catch {
      // Endpoint unavailable or network error — fall back to liveness pings.
      // The registerSessionExpiredHandler in app.tsx handles 401s globally.
    }
  }, [scheduleFromExpiry])

  useEffect(() => {
    // Initial fetch.
    void fetchAndSchedule()

    // Liveness ping: even when expiry is known, re-confirm every 30 minutes
    // so we catch server-side session revocations.
    livenessTimerRef.current = setInterval(async () => {
      try {
        await getMe()
        // Session still valid — re-fetch expiry and reschedule.
        void fetchAndSchedule()
      } catch {
        // 401 handled globally by registerSessionExpiredHandler.
      }
    }, LIVENESS_INTERVAL_MS)

    return () => clearAll()
  }, [fetchAndSchedule, clearAll])

  // "Stay logged in" — confirm session is still valid and reset timers.
  const handleStayLoggedIn = useCallback(async () => {
    try {
      await getMe()
      setOpen(false)
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      if (expireTimerRef.current) clearTimeout(expireTimerRef.current)
      // Re-fetch the session expiry and reschedule.
      void fetchAndSchedule()
    } catch {
      // Session is gone — the global handler will redirect to /login.
      setOpen(false)
    }
  }, [fetchAndSchedule])

  const handleLogout = useCallback(async () => {
    setOpen(false)
    clearAll()
    try {
      await apiLogout()
    } finally {
      navigate('/login', { replace: true })
    }
  }, [clearAll, navigate])

  if (!open) return null

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const countdownDisplay =
    minutes > 0
      ? `${minutes} minute${minutes !== 1 ? 's' : ''}`
      : `${seconds} second${seconds !== 1 ? 's' : ''}`

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Dialog */}
      <div
        ref={focusTrapRef}
        role="alertdialog"
        aria-modal="true"
        aria-label="Session expiring"
        className="relative w-full max-w-[400px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name="clock" size={14} className="text-amber-deep" />
            <span className="text-sm font-semibold text-ink">Your session is expiring</span>
          </div>
        </div>

        {/* Body */}
        <div className="p-xl">
          <p className="text-sm text-ink-2 mb-lg leading-relaxed">
            {secondsLeft > 0
              ? <>You will be logged out in <span className="font-semibold text-ink">{countdownDisplay}</span>.</>
              : 'Your session has expired.'}
          </p>

          <BBButton
            variant="amber"
            size="md"
            className="w-full justify-center mb-sm"
            onClick={() => { void handleStayLoggedIn() }}
          >
            Stay logged in
          </BBButton>

          <div className="text-center">
            <button
              onClick={() => { void handleLogout() }}
              className="text-xs text-ink-3 hover:text-ink underline transition-colors"
            >
              Log out now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
