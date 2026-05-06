/**
 * Google Drive OAuth callback — /settings/import/google/callback
 *
 * This page is the redirect_uri for the Google Drive OAuth PKCE flow.
 * It:
 *   1. Reads the `code` param from the URL
 *   2. Reads the `code_verifier` from sessionStorage
 *   3. Exchanges code + verifier for tokens via our server proxy
 *      (Google requires a client_secret, so the exchange goes server-side)
 *   4. Stores the access_token + refresh_token + email in sessionStorage
 *   5. Navigates back to /settings/import
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { googleTokenExchange } from '../../../lib/api'

export const GD_VERIFIER_KEY   = 'bb_gd_pkce_verifier'
export const GD_TOKEN_KEY      = 'bb_gd_token'
export const GD_REFRESH_KEY    = 'bb_gd_refresh_token'
export const GD_EMAIL_KEY      = 'bb_gd_email'

export function GoogleCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const code  = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      setStatus('error')
      setErrorMsg(error === 'access_denied' ? 'Access was denied.' : `Google error: ${error}`)
      return
    }

    if (!code) {
      setStatus('error')
      setErrorMsg('No authorisation code in the callback URL.')
      return
    }

    const verifier = sessionStorage.getItem(GD_VERIFIER_KEY)
    if (!verifier) {
      setStatus('error')
      setErrorMsg('PKCE verifier missing — please try connecting again.')
      return
    }

    const redirectUri = `${window.location.origin}/settings/import/google/callback`

    async function exchange() {
      try {
        const data = await googleTokenExchange(code!, verifier!, redirectUri)

        sessionStorage.setItem(GD_TOKEN_KEY, data.access_token)
        sessionStorage.setItem(GD_REFRESH_KEY, data.refresh_token)
        if (data.email) sessionStorage.setItem(GD_EMAIL_KEY, data.email)
        sessionStorage.removeItem(GD_VERIFIER_KEY)

        setStatus('success')
        // Brief success flash before redirect
        setTimeout(() => navigate('/settings/import', { replace: true }), 800)
      } catch (err) {
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'Token exchange failed.')
      }
    }

    void exchange()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-2">
      <div className="w-full max-w-[380px] mx-4">
        <div className="text-center mb-8">
          <BBLogo size={14} />
        </div>

        <div className="rounded-xl border border-line bg-paper shadow-3 overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
            {/* Google Drive logo mark */}
            <svg width="18" height="16" viewBox="0 0 87.3 78" fill="none" className="shrink-0">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 001.88 7.9z" fill="#0066DA"/>
              <path d="M43.65 25L29.9 1.2a9.45 9.45 0 00-3.3 3.3L1.89 48.1A15.92 15.92 0 000 56h27.5z" fill="#00AC47"/>
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0087.3 50H59.8l5.85 12.35z" fill="#EA4335"/>
              <path d="M43.65 25L57.4 1.2C56.05.43 54.55 0 52.95 0H34.35c-1.6 0-3.1.43-4.45 1.2z" fill="#00832D"/>
              <path d="M59.8 50H27.5L13.75 73.8c1.35.77 2.85 1.2 4.45 1.2h50.5c1.6 0 3.1-.43 4.45-1.2z" fill="#2684FC"/>
              <path d="M73.4 26.15l-13.3-23.05a9.45 9.45 0 00-2.7-1.9L43.65 25 59.8 50h27.45a15.92 15.92 0 00-1.88-7.9z" fill="#FFBA00"/>
            </svg>
            <span className="text-sm font-semibold text-ink">Connecting Google Drive…</span>
          </div>

          <div className="p-8 flex flex-col items-center gap-3 text-center">
            {status === 'exchanging' && (
              <>
                <svg className="animate-spin h-7 w-7 text-amber" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <div className="text-[13.5px] font-medium text-ink">Completing authorisation…</div>
                <div className="text-[12px] text-ink-3">Exchanging code for access token</div>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-12 h-12 rounded-full bg-green/10 flex items-center justify-center">
                  <Icon name="check" size={22} className="text-green" />
                </div>
                <div className="text-[13.5px] font-medium text-ink">Google Drive connected!</div>
                <div className="text-[12px] text-ink-3">Taking you back…</div>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-12 h-12 rounded-full bg-red/10 flex items-center justify-center">
                  <Icon name="x" size={22} className="text-red" />
                </div>
                <div className="text-[13.5px] font-medium text-ink">Connection failed</div>
                <div className="text-[12px] text-ink-3 max-w-[280px]">{errorMsg}</div>
                <button
                  type="button"
                  onClick={() => navigate('/settings/import', { replace: true })}
                  className="mt-2 text-[12.5px] text-amber-deep hover:underline cursor-pointer"
                >
                  ← Back to Import
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
