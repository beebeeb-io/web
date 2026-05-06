/**
 * Dropbox OAuth callback — /settings/import/dropbox/callback
 *
 * This page is the redirect_uri for the Dropbox OAuth PKCE flow.
 * It:
 *   1. Reads the `code` param from the URL
 *   2. Reads the `code_verifier` from sessionStorage
 *   3. Exchanges code + verifier for an access_token via Dropbox's token endpoint
 *      (PKCE: no client_secret needed — the verifier is the proof)
 *   4. Stores the token + account info in sessionStorage
 *   5. Navigates back to /settings/import
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

const DBX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const VERIFIER_KEY = 'bb_dbx_pkce_verifier'
const TOKEN_KEY = 'bb_dbx_token'
const ACCOUNT_KEY = 'bb_dbx_account'

export function DropboxCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      setStatus('error')
      setErrorMsg(error === 'access_denied' ? 'Access was denied.' : `Dropbox error: ${error}`)
      return
    }

    if (!code) {
      setStatus('error')
      setErrorMsg('No authorisation code in the callback URL.')
      return
    }

    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    if (!verifier) {
      setStatus('error')
      setErrorMsg('PKCE verifier missing — please try connecting again.')
      return
    }

    const appKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined
    if (!appKey) {
      setStatus('error')
      setErrorMsg('VITE_DROPBOX_APP_KEY is not configured.')
      return
    }

    const redirectUri = `${window.location.origin}/settings/import/dropbox/callback`

    async function exchange() {
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          client_id: appKey!,
          redirect_uri: redirectUri,
          code_verifier: verifier!,
        })

        const res = await fetch(DBX_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })

        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`Token exchange failed (${res.status}): ${detail}`)
        }

        const data = await res.json() as {
          access_token: string
          account_id?: string
          token_type: string
        }

        sessionStorage.setItem(TOKEN_KEY, data.access_token)

        // Fetch account display name so the UI can show "Connected as Alice"
        try {
          const accountRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: { Authorization: `Bearer ${data.access_token}` },
          })
          if (accountRes.ok) {
            const account = await accountRes.json() as {
              name?: { display_name?: string }
              email?: string
            }
            sessionStorage.setItem(
              ACCOUNT_KEY,
              account.name?.display_name ?? account.email ?? 'Dropbox account'
            )
          }
        } catch {
          // Account info is optional — continue anyway
        }

        sessionStorage.removeItem(VERIFIER_KEY)
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
            {/* Dropbox logo mark */}
            <svg width="16" height="14" viewBox="0 0 40 33" fill="none" className="shrink-0">
              <path d="M10 0L0 6.5l10 6.5 10-6.5L10 0Z" fill="#0061FF"/>
              <path d="M30 0L20 6.5l10 6.5 10-6.5L30 0Z" fill="#0061FF"/>
              <path d="M0 19.5L10 26l10-6.5L10 13l-10 6.5Z" fill="#0061FF"/>
              <path d="M20 19.5L30 26l10-6.5L30 13l-10 6.5Z" fill="#0061FF"/>
              <path d="M10 27.77L20 34l10-6.23V24l-10 6.23L10 24v3.77Z" fill="#0061FF"/>
            </svg>
            <span className="text-sm font-semibold text-ink">Connecting Dropbox…</span>
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
                <div className="text-[13.5px] font-medium text-ink">Dropbox connected!</div>
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
