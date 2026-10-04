/**
 * CLI / desktop device-approval page — route: /cli-auth
 *
 * Lets an authenticated browser session approve the Beebeeb CLI or the desktop
 * app without typing a password into a terminal. UX mirrors `gh auth login --web`
 * with the RFC 8628 section 5.4 mitigations that task 1734 (security review
 * 2026-10-04, finding 9) added:
 *
 *   1. The device shows a short code. THE PERSON TYPES IT HERE. The page never
 *      reads a code from the URL (a link carrying `?code=` is ignored, and the
 *      page says so): before this, an attacker who started their own device flow
 *      could send a link and one click handed their key the victim's master key.
 *   2. The page asks the server what is waiting under that code and shows what
 *      the server MEASURED (address, country when known, time) next to what the
 *      device claims about itself (labelled as such), plus an honest warning.
 *   3. Approving first re-proves the password or passkey (`StepUpAuth`). Nothing
 *      is minted, encrypted or sent until that succeeds; a wrong confirmation
 *      releases nothing.
 *   4. The browser asks the server to mint the device its OWN session
 *      (POST /api/v1/auth/cli-session, with the step-up token — its own row,
 *      shown as "CLI (bb)" under Settings → Security), performs an ECDH key
 *      exchange, encrypts that new token + the master key, and POSTs the
 *      ciphertext to the relay. The browser's own session token is never handed
 *      to the device, so `bb logout` or revoking the device never signs this
 *      browser out.
 *   5. The server forwards the encrypted payload to the device over its
 *      WebSocket and notifies the account owner.
 *
 * Security notes:
 * - AES-256-GCM encryption with ephemeral P-256 ECDH; the AES key is derived
 *   from the ECDH shared secret via HKDF-SHA256(info="beebeeb-cli-auth-v1").
 *   The device side performs the identical derivation (beebeeb-core). The
 *   server never sees the master key. The code is short-lived and single-use.
 * - The residual risk of any device-code flow remains: someone who tells you
 *   BOTH to open the page AND which code to type can still talk you into it.
 *   That is what the warning, the measured address and the password prompt are
 *   for.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { ApiError, revokeAccountSession } from '../lib/api'
import { toBase64 } from '../lib/crypto'
import { StepUpAuth } from '../components/step-up-auth'
import {
  describeAge,
  describeClient,
  describePlace,
  formatCodeInput,
  linkCarriesCode,
  normalizeTypedCode,
  type CliRequestFacts,
} from '../lib/cli-auth-code'
import { authorizeCliRelay, lookupCliRequest, mintCliSession } from '../lib/cli-auth-api'

// ─── States ───────────────────────────────────────────────────────────────────

type PageState =
  | { kind: 'enter' }            // waiting for the person to type the code
  | { kind: 'looking' }          // asking the server what is under that code
  | { kind: 'review'; code: string; cliEcdhPublicB64: string; request: CliRequestFacts | null }
  | { kind: 'authorizing' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

const EXPIRED_OR_USED =
  'This code has expired or has already been used. Run the sign-in on your device again to get a fresh one.'

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
    ['deriveBits'],
  )

  // Import CLI's raw uncompressed P-256 public key (65 bytes: 0x04 || x || y)
  const cliPubKeyRaw = Uint8Array.from(atob(cliEcdhPublicB64), c => c.charCodeAt(0))
  const cliPubKey = await crypto.subtle.importKey(
    'raw',
    cliPubKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // Derive the raw ECDH shared secret (X-coordinate, 32 bytes).
  // Matches the CLI's `shared_secret.raw_secret_bytes()`.
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: cliPubKey },
    keyPair.privateKey,
    256,
  )

  // HKDF-SHA256(salt=empty, info="beebeeb-cli-auth-v1") → 32-byte AES-256 key.
  // MUST match the CLI side exactly (repos/cli/src/commands/login.rs):
  //   Hkdf::<Sha256>::new(None, shared_bytes)
  //   hk.expand(b"beebeeb-cli-auth-v1", &mut [0u8; 32])
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBits,
    'HKDF',
    false,
    ['deriveBits'],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: new TextEncoder().encode('beebeeb-cli-auth-v1'),
    },
    hkdfKey,
    256,
  )
  const aesKey = await crypto.subtle.importKey(
    'raw',
    derivedBits,
    'AES-GCM',
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

  // Export browser's ephemeral public key as raw uncompressed point (matches CLI's from_sec1_bytes)
  const browserPubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const browserPubB64 = btoa(String.fromCharCode(...new Uint8Array(browserPubRaw)))

  return {
    nonce_b64: btoa(String.fromCharCode(...nonce)),
    encrypted_payload_b64: btoa(String.fromCharCode(...new Uint8Array(enc))),
    browser_ecdh_public_b64: browserPubB64,
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

function describeApprovalError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.code === 'cli_code_claimed') return EXPIRED_OR_USED
    return err.message
  }
  return err instanceof Error ? err.message : 'Authorization failed. Run the sign-in on your device again.'
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
      <dt className="text-[11px] uppercase tracking-widest font-medium text-ink-4 shrink-0">{label}</dt>
      <dd className="text-[13px] text-ink text-right min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12">
      <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-ink-3">{label}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CliAuth() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isUnlocked, getMasterKey } = useKeys()

  // Task 1734: a code in the link is never used. We only notice that there was
  // one, to warn the person. (The address bar is left alone: the post-login
  // bounce and the device-provision return both rely on the URL surviving.)
  const linkHadCode = linkCarriesCode(search)

  const [typed, setTyped] = useState('')
  const [lookupProblem, setLookupProblem] = useState<string | null>(null)
  const [approvalProblem, setApprovalProblem] = useState<string | null>(null)
  const [state, setState] = useState<PageState>({ kind: 'enter' })
  const [stepUpOpen, setStepUpOpen] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      navigate(`/login?next=${returnTo}`, { replace: true })
    }
  }, [user, navigate])

  const typedCode = normalizeTypedCode(typed)

  function startOver() {
    setStepUpOpen(false)
    setTyped('')
    setLookupProblem(null)
    setApprovalProblem(null)
    setState({ kind: 'enter' })
  }

  async function handleLookup() {
    const code = normalizeTypedCode(typed)
    if (!code || state.kind === 'looking') return
    setLookupProblem(null)
    setState({ kind: 'looking' })
    try {
      const found = await lookupCliRequest(code)
      setApprovalProblem(null)
      setState({ kind: 'review', code, cliEcdhPublicB64: found.ecdh_public_key_b64, request: found.request })
    } catch (err) {
      setState({ kind: 'enter' })
      if (err instanceof ApiError && err.status === 404) {
        setLookupProblem(
          'Nothing is waiting under that code. Codes expire after 5 minutes and work once. Check it against your device, or run the sign-in there again.',
        )
      } else {
        setLookupProblem(
          err instanceof Error ? err.message : 'Could not reach the authorization server. Check your connection and try again.',
        )
      }
    }
  }

  /** Runs ONLY after the step-up (password or passkey) has succeeded. */
  async function performApproval(confirmationToken: string) {
    setStepUpOpen(false)
    if (state.kind !== 'review' || !user || !isUnlocked) return
    const review = state
    setApprovalProblem(null)
    setState({ kind: 'authorizing' })

    try {
      // The device gets a session of its own, minted only against the fresh
      // step-up token; the browser's own token is never put in the payload.
      const cliSession = await mintCliSession(review.code, confirmationToken)

      try {
        const payload = JSON.stringify({
          session_token: cliSession.session_token,
          master_key_b64: toBase64(getMasterKey()),
          email: user.email,
        })
        const encrypted = await ecdhEncryptPayload(review.cliEcdhPublicB64, payload)
        await authorizeCliRelay({ user_code: review.code, ...encrypted })
      } catch (err) {
        // The device never received the new session — don't leave it live in
        // the account. Best effort: the error below is what the user sees.
        void revokeAccountSession(cliSession.session_id).catch(() => {})
        throw err
      }

      setState({ kind: 'success' })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'confirmation_required') {
        // Nothing was minted: the step-up expired or was refused. Let them retry from the same screen.
        setApprovalProblem('Your confirmation was not accepted or had expired, so nothing was sent. Try again.')
        setState(review)
        return
      }
      setState({ kind: 'error', message: describeApprovalError(err) })
    }
  }

  // Loading while auth state settles
  if (!user) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-2">
      <div className="w-full max-w-[440px] mx-4 my-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <BBLogo size={14} />
        </div>

        <div className="rounded-xl border border-line bg-paper shadow-3 overflow-hidden">

          {/* ── Enter the code ── */}
          {state.kind === 'enter' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="shield" size={14} className="text-amber-deep" />
                <span className="text-sm font-semibold text-ink">Connect a device</span>
              </div>
              <form
                className="p-6"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleLookup()
                }}
              >
                {linkHadCode && (
                  <div
                    className="mb-5 px-3.5 py-3 rounded-lg border border-amber/40 bg-amber-bg text-[12.5px] text-ink-2 leading-relaxed"
                    data-testid="cli-link-code-notice"
                  >
                    <span className="font-medium text-ink">This link contained a code. We ignored it.</span>{' '}
                    Anyone can send you a link with a code in it, so we only accept a code you type from your own
                    device. If you didn&apos;t just start a sign-in on a device of yours, close this page.
                  </div>
                )}

                <p className="text-sm text-ink-2 leading-relaxed mb-4">
                  Type the code your device is showing. Run <code className="font-mono text-[12px]">bb login</code> in
                  your terminal, or open the Beebeeb desktop app, and it will show you one.
                </p>

                <BBInput
                  label="Code from your device"
                  value={typed}
                  onChange={(e) => {
                    setTyped(formatCodeInput(e.target.value))
                    setLookupProblem(null)
                  }}
                  placeholder="ABCD-EFGH"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  error={lookupProblem ?? undefined}
                  className="mb-4 [&_input]:font-mono [&_input]:text-lg [&_input]:tracking-[0.12em]"
                />

                <BBButton
                  type="submit"
                  variant="amber"
                  size="lg"
                  className="w-full justify-center gap-2"
                  disabled={!typedCode}
                >
                  Continue
                </BBButton>

                <p className="mt-3 text-center text-[11px] text-ink-4">
                  Nothing is shared with the device until you approve it on the next screen.
                </p>
              </form>
            </>
          )}

          {/* ── Looking up the code ── */}
          {state.kind === 'looking' && <Spinner label="Looking up that code…" />}

          {/* ── Review: who is asking? ── */}
          {state.kind === 'review' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="shield" size={14} className="text-amber-deep" />
                <span className="text-sm font-semibold text-ink">Is this your device?</span>
              </div>
              <div className="p-6">
                {/* What Beebeeb measured about the asker */}
                {state.request ? (
                  <dl
                    className="mb-3 rounded-lg border border-line bg-paper-2 divide-y divide-line"
                    data-testid="cli-request-facts"
                  >
                    <Fact label="Asked">{describeAge(state.request.requested_at, new Date())}</Fact>
                    <Fact label="From address">
                      <span className="font-mono text-[12px]">{describePlace(state.request)}</span>
                    </Fact>
                  </dl>
                ) : (
                  <div className="mb-3 px-3.5 py-3 rounded-lg border border-line bg-paper-2 text-[12.5px] text-ink-2 leading-relaxed">
                    Beebeeb can&apos;t tell you where this request came from. Be extra careful.
                  </div>
                )}

                {/* What the device says about itself — unverified */}
                {state.request && (describeClient(state.request) || state.request.device_name) && (
                  <div className="mb-4 px-3.5 py-3 rounded-lg border border-line" data-testid="cli-request-reported">
                    <div className="text-[11px] uppercase tracking-widest font-medium text-ink-4 mb-1.5">
                      The device says
                    </div>
                    {describeClient(state.request) && (
                      <div className="text-[13px] text-ink">{describeClient(state.request)}</div>
                    )}
                    {state.request.device_name && (
                      <div className="text-[13px] text-ink">
                        Called <span className="font-medium">“{state.request.device_name}”</span>
                      </div>
                    )}
                    <p className="mt-1.5 text-[11px] text-ink-4 leading-relaxed">
                      Reported by the device itself, so it can be wrong or made up. The address and time above were
                      measured by Beebeeb.
                    </p>
                  </div>
                )}

                {/* The honest warning */}
                <div
                  className="mb-4 px-3.5 py-3 rounded-lg border border-amber/40 bg-amber-bg text-[12.5px] text-ink-2 leading-relaxed"
                  data-testid="cli-warning"
                >
                  <span className="font-medium text-ink">
                    Only approve this if you started it yourself, just now, on a device you control.
                  </span>{' '}
                  Approving gives that device your encryption key and a session that lasts 30 days. Whoever holds
                  them can read your files. If anyone asked you to open this page or to type a code, choose
                  &ldquo;This isn&apos;t me&rdquo;.
                </div>

                {/* User identity */}
                <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-paper-2 border border-line">
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

                {/* Vault lock warning */}
                {!isUnlocked && (
                  <div className="mb-4 px-3 py-2.5 bg-amber-bg border border-amber/30 rounded-lg text-[12px] text-ink-2">
                    <Icon name="lock" size={11} className="text-amber-deep inline mr-1.5" />
                    Your vault is locked. Unlock it to send the encryption key to the device.
                  </div>
                )}

                {approvalProblem && (
                  <p className="mb-3 text-[12px] text-red leading-relaxed" role="alert">
                    {approvalProblem}
                  </p>
                )}

                <div className="flex gap-2">
                  <BBButton size="md" className="flex-1 justify-center whitespace-nowrap" onClick={startOver}>
                    This isn&apos;t me
                  </BBButton>
                  <BBButton
                    variant="amber"
                    size="md"
                    className="flex-1 justify-center whitespace-nowrap"
                    onClick={() => setStepUpOpen(true)}
                    disabled={!isUnlocked}
                  >
                    Approve this device
                  </BBButton>
                </div>

                <p className="mt-3 text-center text-[11px] text-ink-4">
                  You&apos;ll be asked for your password or passkey first. Your key is end-to-end encrypted before it
                  leaves this page.
                </p>
              </div>
            </>
          )}

          {/* ── Authorizing ── */}
          {state.kind === 'authorizing' && <Spinner label="Encrypting and sending credentials…" />}

          {/* ── Success ── */}
          {state.kind === 'success' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="check" size={14} className="text-green" />
                <span className="text-sm font-semibold text-ink">Device approved</span>
              </div>
              <div className="p-6 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green/10 flex items-center justify-center">
                  <Icon name="check" size={24} className="text-green" />
                </div>
                <h2 className="text-[15px] font-semibold text-ink mb-2">You&apos;re all set</h2>
                <p className="text-sm text-ink-3 leading-relaxed">
                  The device has been signed in as <span className="font-medium text-ink">{user.email}</span>.
                  You can close this tab and return to it.
                </p>
                <p className="mt-4 font-mono text-[11px] text-ink-4">
                  It has its own session, shown as “CLI (bb)” under Settings → Security → Devices &amp; sessions.
                  This browser stays signed in.
                </p>
                <p className="mt-3 text-[12px] text-ink-3">
                  Didn&apos;t expect this?{' '}
                  <Link to="/settings/security" className="text-amber-deep underline">
                    Revoke it now
                  </Link>
                  .
                </p>
              </div>
            </>
          )}

          {/* ── Error ── */}
          {state.kind === 'error' && (
            <>
              <div className="px-6 py-4 border-b border-line flex items-center gap-2.5">
                <Icon name="x" size={14} className="text-red" />
                <span className="text-sm font-semibold text-ink">Nothing was approved</span>
              </div>
              <div className="p-6">
                <p className="text-sm text-ink-2 leading-relaxed mb-4">{state.message}</p>
                <BBButton variant="default" size="md" className="w-full justify-center" onClick={startOver}>
                  Start over
                </BBButton>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="px-6 py-3 bg-paper-2 border-t border-line">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Icon name="shield" size={11} className="text-amber-deep" />
              Your key is encrypted end-to-end — the server sees only ciphertext
            </div>
          </div>
        </div>
      </div>

      {/* The step-up. Nothing is minted, encrypted or sent until this confirms. */}
      <StepUpAuth
        open={stepUpOpen && state.kind === 'review'}
        onConfirmed={(token) => void performApproval(token)}
        onClose={() => setStepUpOpen(false)}
        description="Approving gives this device your encryption key and a 30-day session. Confirm it's you."
        submitLabel="Approve device"
        // The confirmation is minted FOR this device code only (task 1734, round 2):
        // it cannot approve another code, and no other action accepts it.
        grant={state.kind === 'review' ? { purpose: 'cli_device_approval', cliCode: state.code } : undefined}
      />
    </div>
  )
}
