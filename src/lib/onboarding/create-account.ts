/**
 * The create_account sequence (task 1745), pulled out of the React step so the
 * commit point is testable without a DOM.
 *
 * Two phases with a hard line between them:
 *
 *   1. BEFORE the account exists: register-start, the OPAQUE finish in core,
 *      register-finish. A failure here stored nothing, so the ceremony is put
 *      back (`registrationFailed`) and the person may try again or start over.
 *
 *   2. AFTER register-finish succeeded the account AND a session exist on the
 *      server, and core may already have handed over (and forgotten) the
 *      master key. A later failure (the device vault in IndexedDB, refreshing
 *      the user, a network drop) must NEVER call `registrationFailed` or offer
 *      "try again": a second registration collides with the account that now
 *      exists. It is reported as `account_exists_setup_failed` and the UI
 *      recovers forward (sign in with the password the person just chose).
 */

import type { CeremonyProxy } from '../crypto'
import { ActionError, type OnboardingPorts } from './ports'
import type { OnboardingDocument } from './types'

export interface CreateAccountSession {
  email: string
  pilotKey: string
  ticket: string
  /** Held only until the device vault is wrapped, then dropped. */
  password: string
}

export type CreateAccountOutcome =
  | { kind: 'created' }
  /** The email-code ticket expired before register-finish: back to the code step. */
  | { kind: 'ticket_invalid' }
  /** Nothing was stored. Retry or start over is safe. */
  | { kind: 'failed_before_account'; rateLimited: boolean }
  /** The account exists. Never retry registration; recover forward. */
  | { kind: 'account_exists_setup_failed' }

export interface CreateAccountDeps {
  ceremony: Pick<
    CeremonyProxy,
    'startRegistration' | 'finishRegistration' | 'accountCreated' | 'registrationFailed' | 'emailTicketInvalidated'
  >
  ports: Pick<OnboardingPorts, 'actions' | 'referral' | 'onAccountCreated'>
  session: CreateAccountSession
  doc: Pick<OnboardingDocument, 'policy'>
  onStatus?: (status: string) => void
}

export async function runCreateAccount(deps: CreateAccountDeps): Promise<CreateAccountOutcome> {
  const { ceremony, ports, session: s, doc } = deps
  const status = deps.onStatus ?? (() => {})

  // Phase 1: the account does not exist yet.
  let userId: string
  try {
    status('Setting up account encryption')
    const clientMessage = await ceremony.startRegistration()
    const serverMessage = await ports.actions.registerStart({
      email: s.email,
      ticket: s.ticket,
      pilotKey: s.pilotKey,
      clientMessage,
    })
    status('Generating encryption keys')
    const fin = await ceremony.finishRegistration(serverMessage)
    status('Registering with the server')
    const res = await ports.actions.registerFinish({
      email: s.email,
      ticket: s.ticket,
      termsVersion: doc.policy?.terms.version ?? '',
      pilotKey: s.pilotKey,
      clientMessage: fin.upload,
      x25519Public: fin.x25519_public,
      recoveryCheck: fin.recovery_check,
      referral: ports.referral?.(),
    })
    userId = res.userId
  } catch (err) {
    if (err instanceof ActionError && err.code === 'signup_ticket_invalid') {
      // Spec 5.9: back to the code step, keep the confirmed phrase and the
      // typed password (core keeps them across emailTicketInvalidated).
      try {
        await ceremony.emailTicketInvalidated()
      } catch {
        /* the ceremony will refuse create_account until the code is redone anyway */
      }
      s.ticket = ''
      return { kind: 'ticket_invalid' }
    }
    try {
      await ceremony.registrationFailed()
    } catch {
      /* not in a retryable state; the error line tells the person */
    }
    return { kind: 'failed_before_account', rateLimited: err instanceof ActionError && err.code === 'rate_limited' }
  }

  // Phase 2: the account and a session exist. Commit point passed.
  const password = s.password
  s.password = ''
  try {
    status('Securing your vault')
    const masterKey = await ceremony.accountCreated()
    await ports.onAccountCreated({ userId, email: s.email, masterKey, password })
    return { kind: 'created' }
  } catch {
    return { kind: 'account_exists_setup_failed' }
  }
}
