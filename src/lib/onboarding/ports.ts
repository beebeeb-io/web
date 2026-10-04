/**
 * Side-effect ports for the onboarding renderer (task 1745).
 *
 * The renderer is pure plumbing between the document and these ports, so a
 * fixture page, a unit test and the real signup all drive the same components.
 * Three kinds of side effect exist:
 *
 *   - `OnboardingActions`: server calls. The HTTP implementation below talks to
 *     the endpoints the spec names. The email-code endpoints exist only on the
 *     unmerged 1525 branch (`POST /auth/signup/email-start`, `email-verify`);
 *     their request shapes are copied from there and are an assumption until
 *     task 1738 lands (see the task file, "Contract questions").
 *   - `CeremonyPorts`: the core WASM ceremony (password policy, breach gate,
 *     phrase, OPAQUE). Never re-implemented in TypeScript.
 *   - `fetchBreachBody`: the one HTTP call core leaves to the host, to our own
 *     API (k-anonymity prefix only), never a third party.
 */

import { ApiError, request } from '@beebeeb/shared'
import { API_URL } from '../api'
import {
  createBreachCheck,
  createSignupCeremony,
  fromBase64,
  toBase64,
  type BreachCheckProxy,
  type CeremonyConfig,
  type CeremonyProxy,
  type PasswordEvaluation,
  evaluatePasswordCore,
} from '../crypto'
import { sameOriginApiPath } from './parse'

/** Machine-readable failure from a port; the UI branches on `code`, never on text. */
export class ActionError extends Error {
  readonly code: string
  readonly retryAfterSeconds: number | null
  constructor(code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ActionError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Attribution captured from the landing URL (legacy signup keys in localStorage). */
export interface ReferralAttribution {
  source?: string
  sharerId?: string
  code?: string
}

export interface RegisterFinishInput {
  email: string
  referral?: ReferralAttribution
  ticket: string
  termsVersion: string
  pilotKey: string
  x25519Public: Uint8Array
  recoveryCheck: Uint8Array
}

export interface OnboardingActions {
  /** Answers identically for every address (anti-enumeration, spec 5.9). Resolves on 202. */
  emailStart(email: string, pilotKey: string): Promise<void>
  /** Resolves with the single-use signup ticket. Rejects `wrong_code` / `code_expired` / `rate_limited`. */
  emailVerify(email: string, code: string): Promise<{ ticket: string }>
  /** OPAQUE round 1. Resolves with the server message bytes. */
  registerStart(input: { email: string; ticket: string; pilotKey: string; clientMessage: Uint8Array }): Promise<Uint8Array>
  /** OPAQUE round 2. Rejects `signup_ticket_invalid` when the ticket expired (-> back to the code step). */
  registerFinish(input: RegisterFinishInput & { clientMessage: Uint8Array }): Promise<{ userId: string }>
  /** Account stage: confirm the email with the code mailed to the account. */
  verifyEmail(code: string): Promise<void>
  /** Account stage: `offers.trial.start_endpoint` (a validated same-origin path). */
  startTrial(endpoint: string): Promise<void>
  /** Fetch the document again (after any step that changes it). */
  refresh(): Promise<void>
}

export interface CeremonyPorts {
  create(config: CeremonyConfig): Promise<CeremonyProxy>
  breach(password: string): Promise<BreachCheckProxy>
  /** Advisory live evaluation (meter and hint) from core. Never the gate: `setPassword` is. */
  evaluate(password: string, minLength: number): Promise<PasswordEvaluation>
}

export interface AccountCreatedInfo {
  userId: string
  email: string
  /** The 32-byte master key from core. The handler owns it and must wipe it. */
  masterKey: Uint8Array
  /** Needed once to wrap the key for the device vault; the handler must drop it. */
  password: string
}

export interface OnboardingPorts {
  actions: OnboardingActions
  ceremony: CeremonyPorts
  fetchBreachBody: (endpoint: string, prefix: string) => Promise<string | null>
  /** Landing-URL attribution to send with register-finish (web: the legacy localStorage keys). */
  referral?: () => ReferralAttribution
  /** Persist the vault key and move on (web: `setMasterKey`, welcome file, navigate). */
  onAccountCreated: (info: AccountCreatedInfo) => Promise<void>
  /**
   * Sign the current session out. Supplied only where a session can exist (the
   * account stage). The contract (rule 7) lets `update_required` block
   * everything EXCEPT the update and Sign out, so that screen draws the button
   * when, and only when, this port is present.
   */
  signOut?: () => Promise<void>
}

export const coreCeremonyPorts: CeremonyPorts = {
  create: createSignupCeremony,
  breach: createBreachCheck,
  evaluate: evaluatePasswordCore,
}

const MAX_BREACH_BODY_BYTES = 256 * 1024
const BREACH_TIMEOUT_MS = 6000

/**
 * The k-anonymity call. `endpoint` is the document's template (already
 * validated, re-checked here: defense in depth, rule 8). Returns the response
 * text of a 2xx answer, or null on ANY failure, which core treats as an outage
 * and resolves with the document's `fail_open`. Reads at most 256 KiB.
 */
export async function fetchBreachBody(endpoint: string, prefix: string): Promise<string | null> {
  const path = sameOriginApiPath(endpoint)
  if (!path || !/^[0-9A-F]{5}$/.test(prefix)) return null
  const url = `${API_URL}${path.replace('{prefix}', prefix)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BREACH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { credentials: 'include', signal: controller.signal })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BREACH_BODY_BYTES) {
        await reader.cancel()
        return null // over the cap: an outage, not a clean answer
      }
      chunks.push(value)
    }
    const all = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.byteLength
    }
    return new TextDecoder().decode(all)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function toActionError(err: unknown, fallbackCode: string): ActionError {
  if (err instanceof ActionError) return err
  if (err instanceof ApiError) {
    const retry = typeof err.details?.retry_after === 'number' ? err.details.retry_after : null
    if (err.status === 429) return new ActionError('rate_limited', err.message, retry)
    return new ActionError(err.code ?? fallbackCode, err.message, retry)
  }
  return new ActionError('network', err instanceof Error ? err.message : 'request failed')
}

/**
 * HTTP implementation against the current server. `refresh` is supplied by the
 * route (it owns the document state).
 *
 * ASSUMED (task 1738 not merged): `signup_ticket` and `terms_version` travel in
 * the register-start / register-finish bodies, and `email-verify` answers
 * `{ signup_ticket }`, exactly as on server branch `feat/1525-signup-email-code`.
 */
export function httpActions(refresh: () => Promise<void>): OnboardingActions {
  const pilotHeaders = (pilotKey: string): Record<string, string> =>
    pilotKey ? { 'X-Beebeeb-Pilot-Key': pilotKey } : {}

  return {
    async emailStart(email, pilotKey) {
      try {
        await request('/api/v1/auth/signup/email-start', {
          method: 'POST',
          body: JSON.stringify({ email }),
          headers: pilotHeaders(pilotKey),
        })
      } catch (err) {
        throw toActionError(err, 'email_start_failed')
      }
    },
    async emailVerify(email, code) {
      try {
        const res = await request<{ signup_ticket: string }>('/api/v1/auth/signup/email-verify', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        })
        return { ticket: res.signup_ticket }
      } catch (err) {
        throw toActionError(err, 'wrong_code')
      }
    },
    async registerStart({ email, ticket, pilotKey, clientMessage }) {
      try {
        const res = await request<{ server_message: string }>('/api/v1/opaque/register-start', {
          method: 'POST',
          body: JSON.stringify({ email, client_message: toBase64(clientMessage), signup_ticket: ticket }),
          headers: pilotHeaders(pilotKey),
        })
        return fromBase64(res.server_message)
      } catch (err) {
        throw toActionError(err, 'register_start_failed')
      }
    },
    async registerFinish({ email, ticket, termsVersion, pilotKey, clientMessage, x25519Public, recoveryCheck, referral }) {
      try {
        const res = await request<{ user_id: string }>('/api/v1/opaque/register-finish', {
          method: 'POST',
          body: JSON.stringify({
            email,
            client_message: toBase64(clientMessage),
            x25519_public_key: toBase64(x25519Public),
            recovery_check: toBase64(recoveryCheck),
            signup_ticket: ticket,
            terms_version: termsVersion,
            ...(referral?.source && { referral_source: referral.source }),
            ...(referral?.sharerId && { referral_sharer_id: referral.sharerId }),
            ...(referral?.code && { referral_code: referral.code }),
          }),
          headers: pilotHeaders(pilotKey),
        })
        return { userId: res.user_id }
      } catch (err) {
        throw toActionError(err, 'register_finish_failed')
      }
    },
    async verifyEmail(code) {
      try {
        await request('/api/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ code }) })
      } catch (err) {
        throw toActionError(err, 'wrong_code')
      }
    },
    async startTrial(endpoint) {
      const path = sameOriginApiPath(endpoint)
      if (!path) throw new ActionError('bad_endpoint', 'The trial endpoint was not a same-origin API path.')
      try {
        await request(path, { method: 'POST', body: JSON.stringify({}) })
      } catch (err) {
        throw toActionError(err, 'trial_start_failed')
      }
    },
    refresh,
  }
}
