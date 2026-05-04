/**
 * Cloudflare Turnstile invisible widget.
 *
 * Renders nothing when VITE_TURNSTILE_SITE_KEY is not set (dev mode / CI).
 * When the sitekey is present, mounts an invisible Turnstile widget that
 * fires a challenge in the background and delivers a token via callback.
 *
 * Usage:
 *   const turnstileRef = useRef<TurnstileHandle>(null)
 *   // before API call:
 *   const token = turnstileRef.current?.getToken() ?? null
 *
 * The widget resets automatically after the token is consumed (one-use).
 * If Turnstile fails to load or produces no token, getToken() returns null
 * and callers must treat null as "no token" — the server skips verification
 * when its own CLOUDFLARE_TURNSTILE_SECRET env var is not set.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// ─── Global type augmentation for window.turnstile ────────────────────────────

declare global {
  interface Window {
    turnstile?: {
      /** Mount an invisible or managed widget. Returns a widgetId. */
      render: (selector: string | HTMLElement, opts: TurnstileOpts) => string
      /** Reset the widget (rotate to a new challenge). */
      reset: (widgetId: string) => void
      /** Remove the widget from the DOM. */
      remove: (widgetId: string) => void
    }
  }
}

interface TurnstileOpts {
  sitekey: string
  callback?: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'invisible' | 'compact'
}

// ─── Public handle exposed via ref ────────────────────────────────────────────

export interface TurnstileHandle {
  /** Returns the most recently received token, or null if not yet available. */
  getToken: () => string | null
  /** Rotate the challenge to get a fresh token (e.g. after a 403). */
  reset: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

export const Turnstile = forwardRef<TurnstileHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const tokenRef     = useRef<string | null>(null)
  const widgetIdRef  = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    getToken: () => tokenRef.current,
    reset: () => {
      tokenRef.current = null
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    },
  }))

  useEffect(() => {
    // No sitekey → dev mode / env not configured → no-op
    if (!SITEKEY || !containerRef.current) return

    // Turnstile script may still be loading — retry until available
    let attempts = 0
    const MAX_ATTEMPTS = 30  // 3 s max wait (30 × 100 ms)

    const tryRender = () => {
      if (window.turnstile) {
        widgetIdRef.current = window.turnstile.render(containerRef.current!, {
          sitekey: SITEKEY,
          size: 'invisible',
          theme: 'light',
          callback: (token: string) => {
            tokenRef.current = token
          },
          'expired-callback': () => {
            // Token expired — clear so the next getToken() call returns null
            tokenRef.current = null
          },
          'error-callback': () => {
            // Challenge failed — leave null; server will fail-open
            tokenRef.current = null
          },
        })
        return
      }
      if (++attempts < MAX_ATTEMPTS) {
        setTimeout(tryRender, 100)
      }
      // After MAX_ATTEMPTS we give up silently; getToken() will return null
    }

    tryRender()

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
      tokenRef.current = null
    }
  }, []) // sitekey is a module-level const — no dep needed

  // Invisible widget: renders a zero-size hidden container that Turnstile
  // uses as an anchor. No visible UI is shown to the user.
  if (!SITEKEY) return null
  return <div ref={containerRef} style={{ display: 'none' }} aria-hidden="true" />
})

Turnstile.displayName = 'Turnstile'
