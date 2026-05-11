/**
 * CLI web-auth page — route: /cli-auth?nonce=<uuid>&port=<port>
 *                      or: /cli-auth?code=XXXX-XXXX
 *
 * Lets an authenticated browser session authorize the Beebeeb CLI without
 * typing a password into a terminal. UX mirrors `gh auth login --web`.
 *
 * Legacy flow (nonce + port):
 *   1. `bb login --browser` starts a local HTTP server on a random port.
 *   2. It opens https://app.beebeeb.io/cli-auth?nonce=<uuid>&port=<port>.
 *   3. This page checks the params, shows the auth prompt to the signed-in
 *      user, and on "Authorize" POSTs the session token + master key (b64)
 *      to http://localhost:<port>/callback.
 *   4. The CLI receives the callback, stores the credentials, and shuts the
 *      local server down.
 *
 * New WebSocket device-auth flow (code):
 *   1. CLI opens a WebSocket to the server and receives a short user_code.
 *   2. It opens https://app.beebeeb.io/cli-auth?code=XXXX-XXXX.
 *   3. This page fetches the CLI's ECDH public key from the server.
 *   4. On "Authorize", the browser performs an ECDH key exchange, encrypts
 *      the session token + master key, and POSTs the ciphertext to the server.
 *   5. The server forwards the encrypted payload to the CLI over the WebSocket.
 *
 * Security notes:
 * - Legacy: nonce validated as UUID, port in unprivileged range (1024-65535).
 * - New: AES-256-GCM encryption with ephemeral P-256 ECDH — server never sees
 *   plaintext credentials. Code is short-lived and single-use.
 * - Modern browsers allow fetch() to http://localhost from HTTPS pages
 *   as an exception to mixed-content rules (same as GitHub CLI, Vercel CLI, etc.).
 */

import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { getToken } from '../lib/api'
import { toBase64 } from '../lib/crypto'

// ─── Param validation ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

function parsePort(raw: string | null): number | null {
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 1024 || n > 65535) return null
  return n
}

function parseNonce(raw: string | null): string | null {
  if (!raw) return null
  if (!UUID_RE.test(raw)) return null
  return raw
}

function parseCode(raw: string | null): string | null {
  if (!raw) return null
  if (!CODE_RE.test(raw.toUpperCase())) return null
  return raw.toUpperCase()
}

// ─── Flow discriminator ───────────────────────────────────────────────────────

type Flow =
  | { kind: 'legacy'; nonce: string; port: number }
  | { kind: 'code'; code: string }
  | { kind: 'invalid' }

// ─── States ───────────────────────────────────────────────────────────────────

type PageState =
  | { kind: 'loading' }          // fetching CLI pubkey (code flow only)
  | { kind: 'prompt' }
  | { kind: 'authorizing' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

// ─── ECDH helpers ─────────────────────────────────────────────────────────────

async function ecdhEncryptPayload(
  cliEcdhPublicB64: string,
  payload: string,
): Promise<{
  nonce_b64: string
  encrypted_payload_b64: string
  browser_ecdh_public_b64: string
}> {
  // Generate ephemeral P-256 key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  )

  // Import CLI's DER-encoded SPKI public key
  const cliPubKeyDer = Uint8Array.from(atob(cliEcdhPublicB64), c => c.charCodeAt(0))
  const cliPubKey = await crypto.subtle.importKey(
    'spki',
    cliPubKeyDer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey'],
  )

  // Derive shared AES-256-GCM key via ECDH
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: cliPubKey },
    keyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  // Encrypt the payload
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    new TextEncoder().encode(payload),
  )

  // Export browser's ephemeral public key
  const browserPubDer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const browserPubB64 = btoa(String.fromCharCode(...new Uint8Array(browserPubDer)))

  return {
    nonce_b64: btoa(String.fromCharCode(...nonce)),
    encrypted_payload_b64: btoa(String.fromCharCode(...new Uint8Array(enc))),
    browser_ecdh_public_b64: browserPubB64,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CliAuth() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isUnlocked, getMasterKey } = useKeys()

  // Determine which flow we're in
  const code = parseCode(params.get('code'))
  const nonce = parseNonce(params.get('nonce'))
  const port = parsePort(params.get('port'))

  const flow: Flow = code
    ? { kind: 'code', code }
    : nonce && port
      ? { kind: 'legacy', nonce, port }
      : { kind: 'invalid' }

  // CLI ECDH public key fetched from server (code flow)
  const [cliEcdhPublicB64, setCliEcdhPublicB64] = useState<string | null>(null)

  // Initial state: loading for code flow (need to fetch pubkey), prompt otherwise
  const [state, setState] = useState<PageState>(
    flow.kind === 'code'
      ? { kind: 'loading' }
      : flow.kind === 'invalid'
        ? { kind: 'error', message: 'This authorization link is missing required parameters or has an invalid format. Please run bb login --browser again to get a fresh link.' }
        : { kind: 'prompt' },
  )

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      navigate(`/login?next=${returnTo}`, { replace: true })
    }
  }, [user, navigate])

  // Fetch CLI ECDH public key for code flow
  useEffect(() => {
    if (flow.kind !== 'code') return

    const controller = new AbortController()
    fetch(`/api/v1/auth/cli-pubkey?code=${encodeURIComponent(flow.code)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) {
          setState({ kind: 'error', message: 'This code has expired or is invalid. Please run bb login again to get a fresh code.' })
          return
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          setState({ kind: 'error', message: `Server returned ${res.status}${body ? ': ' + body : ''}. Please try again.` })
          return
        }
        const data = await res.json() as { ecdh_public_key_b64: string }
        setCliEcdhPublicB64(data.ecdh_public_key_b64)
        setState({ kind: 'prompt' })
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setState({ kind: 'error', message: 'Could not reach the authorization server. Check your connection and try again.' })
      })

    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally runs once — code param is stable

  async function handleAuthorize() {
    if (!user || !isUnlocked) return
    setState({ kind: 'authorizing' })

    try {
      const sessionToken = getToken()
      if (!sessionToken) throw new Error('No active session — please sign in again.')

      const masterKey = getMasterKey()
      const masterKeyB64 = toBase64(masterKey)

      if (flow.kind === 'legacy') {
        // ── Legacy flow: POST directly to CLI's local HTTP server ──────────────
        const res = await fetch(`http://localhost:${flow.port}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce: flow.nonce,
            session_token: sessionToken,
            master_key_b64: masterKeyB64,
            email: user.email,
          }),
          signal: AbortSignal.timeout(5000),
        })

        if (!res.ok) {
          const body = await res.text().catch(() => 'No response body')
          throw new Error(`CLI returned ${res.status}: ${body}`)
        }

        setState({ kind: 'success' })
      } else if (flow.kind === 'code') {
        // ── New WebSocket device-auth flow: ECDH encrypt + POST to server ──────
        if (!cliEcdhPublicB64) throw new Error('CLI public key not loaded — please refresh and try again.')

        const payload = JSON.stringify({
          session_token: sessionToken,
          master_key_b64: masterKeyB64,
          email: user.email,
        })

        const encrypted = await ecdhEncryptPayload(cliEcdhPublicB64, payload)

        const res = await fetch('/api/v1/auth/cli-authorize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            user_code: flow.code,
            nonce_b64: encrypted.nonce_b64,
            encrypted_payload_b64: encrypted.encrypted_payload_b64,
            browser_ecdh_public_b64: encrypted.browser_ecdh_public_b64,
          }),
        })

        if (res.status === 404) {
          throw new Error('This code has expired or has already been used. Please run bb login again.')
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Authorization failed (${res.status})${body ? ': ' + body : ''}. Try again.`)
        }

        setState({ kind: 'success' })
      }
    } catch (err) {
      const isLegacyNetworkError =
        flow.kind === 'legacy' &&
        err instanceof Error &&
        (err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError') ||
          err.message.includes('Load failed'))

      const msg = isLegacyNetworkError
        ? `Could not reach the CLI on port ${(flow as { kind: 'legacy'; port: number }).port}. Make sure \`bb login --browser\` is still running and try again.`
        : err instanceof Error
          ? err.message
          : 'Authorization failed. Try running `bb login` again.'

      setState({ kind: 'error', message: msg })
    }
  }

  // Loading while auth state settles
  if (!user) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-2">
      <div className="w-full max-w-[420px] mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <BBLogo size={14} />
        </div>

        <div className="rounded-xl border border-line bg-paper shadow-3 overflow-hidden">

          {/* ── Loading (fetching CLI pubkey) ── */}
          {state.kind === 'loading' && (
            <div className="flex flex-col items-center gap-3 px-6 py-12">
              <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-ink-3">Verifying authorization code…</span>
            </div>
          )}

          {/* ── Auth prompt ── */}
          {state.kind === 'prompt' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="shield" size={14} className="text-amber-deep" />
                <span className="text-sm font-semibold text-ink">
                  {flow.kind === 'code' ? 'Authorizing CLI device' : 'Authorize Beebeeb CLI'}
                </span>
              </div>
              <div className="p-6">
                {/* Code display (new flow only) */}
                {flow.kind === 'code' && (
                  <div className="mb-5 flex flex-col items-center gap-1.5 p-4 rounded-lg bg-paper-2 border border-line">
                    <span className="text-[11px] text-ink-4 uppercase tracking-widest font-medium">Authorization code</span>
                    <span className="font-mono text-[28px] font-bold text-ink tracking-[0.12em] select-all">
                      {flow.code}
                    </span>
                    <span className="text-[11px] text-ink-4">Confirm this matches what your terminal shows</span>
                  </div>
                )}

                {/* User identity */}
                <div className="flex items-center gap-3 mb-5 p-3 rounded-lg bg-paper-2 border border-line">
                  <div className="w-9 h-9 rounded-full bg-amber-bg text-amber-deep flex items-center justify-center text-[13px] font-bold shrink-0">
                    {user.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">{user.email}</div>
                    <div className="text-[11px] text-ink-3">
                      {isUnlocked ? 'Signed in · Vault unlocked' : 'Signed in · Vault locked'}
                    </div>
                  </div>
                  {isUnlocked && <Icon name="check" size={13} className="text-green shrink-0" />}
                </div>

                {/* What's being authorized */}
                <div className="mb-5">
                  <p className="text-sm text-ink-2 leading-relaxed mb-3">
                    The <span className="font-medium text-ink">Beebeeb CLI</span> running on this machine is requesting access to your account.
                  </p>
                  <div className="text-[12px] text-ink-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name="check" size={11} className="text-green shrink-0" />
                      Read and upload your encrypted files
                    </div>
                    <div className="flex items-center gap-2">
                      <Icon name="check" size={11} className="text-green shrink-0" />
                      Access your master encryption key locally
                    </div>
                    <div className="flex items-center gap-2">
                      <Icon name="check" size={11} className="text-green shrink-0" />
                      Stay signed in until you run <code className="font-mono text-[11px]">bb logout</code>
                    </div>
                  </div>
                </div>

                {/* Legacy flow: port/nonce strip */}
                {flow.kind === 'legacy' && (
                  <div className="mb-5 p-3 rounded-lg border border-line-2 bg-paper-2 text-[11.5px] text-ink-3">
                    <div className="flex items-center gap-1.5 font-mono">
                      <Icon name="link" size={10} className="text-ink-4 shrink-0" />
                      <span className="text-ink-4">Callback: </span>
                      <span className="text-ink-2">http://localhost:<span className="text-amber-deep font-semibold">{flow.port}</span>/callback</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-ink-4 font-mono truncate">
                      Nonce: {flow.nonce}
                    </div>
                  </div>
                )}

                {/* Vault lock warning */}
                {!isUnlocked && (
                  <div className="mb-4 px-3 py-2.5 bg-amber-bg border border-amber/30 rounded-lg text-[12px] text-ink-2">
                    <Icon name="lock" size={11} className="text-amber-deep inline mr-1.5" />
                    Your vault is locked. Unlock it to send the encryption key to the CLI.
                  </div>
                )}

                <BBButton
                  variant="amber"
                  size="lg"
                  className="w-full justify-center gap-2"
                  onClick={handleAuthorize}
                  disabled={!isUnlocked || flow.kind === 'invalid'}
                >
                  <Icon name="check" size={14} />
                  Authorize CLI access
                </BBButton>

                <p className="mt-3 text-center text-[11px] text-ink-4">
                  {flow.kind === 'code'
                    ? 'Your credentials are end-to-end encrypted before leaving this page.'
                    : 'This sends your session token and master key to the CLI process running on your machine.'}
                </p>
              </div>
            </>
          )}

          {/* ── Authorizing ── */}
          {state.kind === 'authorizing' && (
            <div className="flex flex-col items-center gap-3 px-6 py-12">
              <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-ink-3">
                {flow.kind === 'code' ? 'Encrypting and sending credentials…' : 'Sending credentials to CLI…'}
              </span>
            </div>
          )}

          {/* ── Success ── */}
          {state.kind === 'success' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="check" size={14} className="text-green" />
                <span className="text-sm font-semibold text-ink">CLI authorized</span>
              </div>
              <div className="p-6 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green/10 flex items-center justify-center">
                  <Icon name="check" size={24} className="text-green" />
                </div>
                <h2 className="text-[15px] font-semibold text-ink mb-2">You're all set</h2>
                <p className="text-sm text-ink-3 leading-relaxed">
                  The CLI has been authorized as <span className="font-medium text-ink">{user.email}</span>.
                  You can close this tab and return to your terminal.
                </p>
                <p className="mt-4 font-mono text-[11px] text-ink-4">
                  You can revoke CLI access at any time via Settings → Security → Active sessions.
                </p>
              </div>
            </>
          )}

          {/* ── Error ── */}
          {state.kind === 'error' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="x" size={14} className="text-red" />
                <span className="text-sm font-semibold text-ink">Authorization failed</span>
              </div>
              <div className="p-6">
                <p className="text-sm text-ink-2 leading-relaxed mb-4">{state.message}</p>
                {flow.kind !== 'invalid' && (
                  <BBButton
                    variant="default"
                    size="md"
                    className="w-full justify-center"
                    onClick={() => setState({ kind: flow.kind === 'code' ? 'loading' : 'prompt' })}
                  >
                    Try again
                  </BBButton>
                )}
              </div>
            </>
          )}

          {/* Footer */}
          <div className="px-6 py-3 bg-paper-2 border-t border-line">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Icon name="shield" size={11} className="text-amber-deep" />
              {flow.kind === 'code'
                ? 'Credentials encrypted end-to-end — the server sees only ciphertext'
                : 'Credentials stay on this machine — beebeeb.io never sees them'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
