// Password-ceremony evaluation: strength scoring and breach checks for signup/reset.
import {
  CeremonyOps,
  CeremonyResult,
} from '../../workers/crypto.worker'
import { withProxy } from './service'

// ─── Signup ceremony (core onboarding module, task 1745) ────────────────────
//
// The ceremony (password policy and breach gate, recovery phrase, OPAQUE start
// and finish) is a stateful core struct living in the worker, addressed by an
// opaque handle exactly like the search index. No policy or crypto is
// re-implemented here: this is a typed doorway. A failing call throws a
// `CeremonyError` whose `code` is core's stable `CeremonyError::code`
// (`password_too_short`, `password_breached`, `phrase_word_mismatch`, ...), so
// the UI branches on cause, never on message text.

export class CeremonyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CeremonyError'
    this.code = code
  }
}

/** `evaluate_password` / `WasmBreachCheck.evaluate` payload shapes (core `serde` structs). */
export interface PasswordEvaluation {
  length: number
  min_length: number
  missing_characters: number
  meets_minimum: boolean
  has_mixed_case: boolean
  has_number_or_symbol: boolean
  strength: 'too_short' | 'fair' | 'good' | 'strong'
  /** Meter level 1 to 4. */
  level: number
  hint:
    | 'none'
    | 'need_more_characters'
    | 'mix_case_and_add_number_or_symbol'
    | 'mix_case'
    | 'add_number_or_symbol'
}

export interface BreachVerdict {
  kind: 'clean' | 'breached' | 'check_failed_allowed' | 'check_failed_blocked' | 'not_required'
  count: number
  allows_proceeding: boolean
  check_failed: boolean
}

// Comlink's `Remote<>` type distributes a `Promise` over a union, so the
// `CeremonyResult` unions below are re-asserted at each call site.
function unwrapCeremony<T>(r: CeremonyResult<T>): T {
  if (r.ok) return r.value
  throw new CeremonyError(r.code, r.message)
}

/** Advisory password evaluation from core (meter + hint). Stateless. */
export async function evaluatePasswordCore(password: string, minLength: number): Promise<PasswordEvaluation> {
  return unwrapCeremony(
    await withProxy((p) => p.evaluatePassword(password, minLength) as Promise<CeremonyResult<PasswordEvaluation>>),
  )
}

export interface CeremonyConfig {
  /** `policy.password.min_length` (core clamps it up to its floor). */
  minLength: number
  /** The document lists a required `verify_email_code`. */
  emailVerificationRequired: boolean
  /** `policy.recovery_phrase.verify_word_count`. */
  verifyWordCount: number
  /** The document declares `policy.password.breach_check`. */
  breachCheckRequired: boolean
  /** `policy.password.breach_check.fail_open` (applied by core, not by the caller). */
  breachFailOpen: boolean
}

/** A breach check bound to one password. Dispose it when the password changes or the step is left. */
export class BreachCheckProxy {
  #handle: number
  #disposed = false
  /** The 5 upper-case hex characters of the SHA-1 digest: the only thing that may be sent. */
  readonly prefix: string

  constructor(handle: number, prefix: string) {
    this.#handle = handle
    this.prefix = prefix
  }

  /** @internal the registry key `CeremonyProxy.setPassword` hands to core. */
  get handle(): number {
    return this.#handle
  }

  /**
   * Record the endpoint's answer (`null` = the request failed) and get the verdict to display.
   * `requestedPrefix` MUST be the exact prefix the request URL (or cache entry) used: core
   * rejects any other with `breach_prefix_mismatch` rather than reading another prefix's body as clean.
   */
  async evaluate(requestedPrefix: string, body: string | null, failOpen: boolean): Promise<BreachVerdict> {
    return unwrapCeremony(
      await withProxy((p) => p.breachCheckEvaluate(this.#handle, requestedPrefix, body, failOpen) as Promise<CeremonyResult<BreachVerdict>>),
    )
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    try {
      await withProxy((p) => p.breachCheckDispose(this.#handle))
    } catch (err) {
      console.warn('[crypto] breach check dispose failed', err)
    }
  }
}

export async function createBreachCheck(password: string): Promise<BreachCheckProxy> {
  const { handle, prefix } = await withProxy((p) => p.breachCheckNew(password))
  return new BreachCheckProxy(handle, prefix)
}

/** Main-thread proxy over a worker-owned `WasmSignupCeremony`. One proxy = one signup attempt. */
export class CeremonyProxy {
  #handle: number
  #disposed = false

  constructor(handle: number) {
    this.#handle = handle
  }

  async #call<K extends keyof CeremonyOps>(op: K, ...args: CeremonyOps[K]['args']): Promise<CeremonyOps[K]['result']> {
    if (this.#disposed) throw new CeremonyError('ceremony_gone', 'ceremony was disposed')
    return unwrapCeremony(
      await withProxy(
        (p) => p.ceremonyCall(this.#handle, op, args) as Promise<CeremonyResult<CeremonyOps[K]['result']>>,
      ),
    )
  }

  async emailVerified(): Promise<void> { await this.#call('emailVerified') }
  /** The user edited a verified email: verification withdrawn, password and confirmed phrase kept. */
  async emailChanged(): Promise<void> { await this.#call('emailChanged') }
  /** `signup_ticket_invalid` at register-finish: back to the code step, secrets kept. */
  async emailTicketInvalidated(): Promise<void> { await this.#call('emailTicketInvalidated') }

  /** Pass the breach check made for THIS password, or null when the document declares none. */
  async setPassword(password: string, confirmation: string, breach: BreachCheckProxy | null): Promise<PasswordEvaluation> {
    return (await this.#call('setPassword', password, confirmation, breach ? breach.handle : null)) as PasswordEvaluation
  }

  async beginPhrase(): Promise<void> { await this.#call('beginPhrase') }
  /** Call only while rendering the phrase; drop the reference afterwards (core cannot wipe a JS copy). */
  async phrase(): Promise<string> { return this.#call('phrase') }
  async acknowledgePhrase(): Promise<void> { await this.#call('acknowledgePhrase') }
  async challengePositions(): Promise<number[]> { return this.#call('challengePositions') }
  async confirmPhrase(answers: string[]): Promise<void> { await this.#call('confirmPhrase', answers) }

  async startRegistration(): Promise<Uint8Array> { return this.#call('startRegistration') }
  async finishRegistration(serverMessage: Uint8Array) { return this.#call('finishRegistration', serverMessage) }
  async registrationFailed(): Promise<void> { await this.#call('registrationFailed') }
  /** The server accepted register-finish. The caller owns (and must wipe) the returned 32-byte master key. */
  async accountCreated(): Promise<Uint8Array> { return this.#call('accountCreated') }

  /** Wipe the password, phrase and key and start over. Call on back, cancel and error exits. */
  async abandon(): Promise<void> { await this.#call('abandon') }

  /** Wipe and free the worker-side instance. Idempotent; never throws. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    try {
      await withProxy((p) => p.ceremonyDispose(this.#handle))
    } catch (err) {
      console.warn('[crypto] ceremony dispose failed', err)
    }
  }
}

export async function createSignupCeremony(config: CeremonyConfig): Promise<CeremonyProxy> {
  const handle = await withProxy((p) =>
    p.ceremonyNew(
      config.minLength,
      config.emailVerificationRequired,
      config.verifyWordCount,
      config.breachCheckRequired,
      config.breachFailOpen,
    ),
  )
  return new CeremonyProxy(handle)
}
