import { useEffect, useRef, type MutableRefObject } from 'react'

// Cloudflare Turnstile widget (task 0764B). Renders the public-sitekey challenge
// on the signup card; the token it produces is sent as `turnstile_token` to the
// server (signup / opaque register-start), which verifies it server-side.
//
// Dev/test: when VITE_TURNSTILE_SITEKEY is unset the widget renders NOTHING and
// signup proceeds with no token — the server gate (BB_TURNSTILE_ENABLED) is also
// off there, so local/dev flows keep working untouched.
const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
      theme?: 'light' | 'dark' | 'auto'
    },
  ) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

function loadScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(s)
  })
}

/** Whether the widget is active (sitekey configured). Callers use this to require
 *  a token before submit only when Turnstile is actually on. */
export const turnstileEnabled = Boolean(SITEKEY)

export function Turnstile({
  onToken,
  resetRef,
}: {
  onToken: (token: string) => void
  /** Set to a function that resets the widget (call on a 403 captcha_required). */
  resetRef?: MutableRefObject<(() => void) | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!SITEKEY || !containerRef.current) return
    let cancelled = false
    void loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITEKEY,
          theme: 'auto',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
        if (resetRef) {
          resetRef.current = () => {
            onToken('')
            if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current)
          }
        }
      })
      .catch(() => {
        /* script blocked/offline — leave token empty; server fails closed if enforced */
      })
    return () => {
      cancelled = true
      if (window.turnstile && widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current)
        } catch {
          /* already gone */
        }
      }
    }
  }, [onToken, resetRef])

  if (!SITEKEY) return null
  // The single allowed third-party visual on the signup card — below the primary
  // action, no extra copy (brand rule).
  return <div ref={containerRef} data-testid="turnstile-widget" className="mt-3.5 flex justify-center" />
}
