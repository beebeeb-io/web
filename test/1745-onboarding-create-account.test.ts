import { describe, expect, test } from 'bun:test'
import { runCreateAccount, type CreateAccountDeps } from '../src/lib/onboarding/create-account'
import { ActionError } from '../src/lib/onboarding/ports'

/**
 * Task 1745 round 2 (Codex P1 on web#134): register-finish is a commit point.
 * Once it succeeds the account and a session exist, so a later failure (vault
 * wrap, refresh, network) must NEVER call registrationFailed() or be reported
 * as a retryable failure.
 */

function setup(opts: {
  registerStartError?: unknown
  registerFinishError?: unknown
  accountCreatedError?: unknown
  onAccountCreatedError?: unknown
}) {
  const calls: string[] = []
  const session = { email: 'a@beebeeb.io', pilotKey: '', ticket: 't', password: 'Correct-Horse-Battery-9' }
  const deps: CreateAccountDeps = {
    ceremony: {
      async startRegistration() {
        calls.push('startRegistration')
        return new Uint8Array([1])
      },
      async finishRegistration() {
        calls.push('finishRegistration')
        return { upload: new Uint8Array([2]), x25519_public: new Uint8Array([3]), recovery_check: new Uint8Array([4]) } as never
      },
      async accountCreated() {
        calls.push('accountCreated')
        if (opts.accountCreatedError) throw opts.accountCreatedError
        return new Uint8Array(32)
      },
      async registrationFailed() {
        calls.push('registrationFailed')
      },
      async emailTicketInvalidated() {
        calls.push('emailTicketInvalidated')
      },
    },
    ports: {
      actions: {
        async registerStart() {
          calls.push('registerStart')
          if (opts.registerStartError) throw opts.registerStartError
          return new Uint8Array([5])
        },
        async registerFinish() {
          calls.push('registerFinish')
          if (opts.registerFinishError) throw opts.registerFinishError
          return { userId: 'u1' }
        },
      } as never,
      async onAccountCreated() {
        calls.push('onAccountCreated')
        if (opts.onAccountCreatedError) throw opts.onAccountCreatedError
      },
    },
    session,
    doc: { policy: null },
  }
  return { deps, calls, session }
}

describe('runCreateAccount: the commit point', () => {
  test('happy path: created, registrationFailed never called, password dropped from the session', async () => {
    const { deps, calls, session } = setup({})
    expect(await runCreateAccount(deps)).toEqual({ kind: 'created' })
    expect(calls).toEqual(['startRegistration', 'registerStart', 'finishRegistration', 'registerFinish', 'accountCreated', 'onAccountCreated'])
    expect(session.password).toBe('')
  })

  test('vault wrap fails AFTER register-finish: account_exists_setup_failed, registrationFailed called 0 times', async () => {
    const { deps, calls } = setup({ onAccountCreatedError: new Error('IndexedDB blocked') })
    const out = await runCreateAccount(deps)
    expect(out).toEqual({ kind: 'account_exists_setup_failed' })
    expect(calls).toContain('registerFinish')
    expect(calls.filter((c) => c === 'registrationFailed').length).toBe(0)
    expect(calls.filter((c) => c === 'registerFinish').length).toBe(1)
  })

  test('core accountCreated() fails AFTER register-finish: same, no rollback of the ceremony', async () => {
    const { deps, calls } = setup({ accountCreatedError: new Error('wrong state') })
    expect(await runCreateAccount(deps)).toEqual({ kind: 'account_exists_setup_failed' })
    expect(calls.filter((c) => c === 'registrationFailed').length).toBe(0)
    expect(calls).not.toContain('onAccountCreated')
  })

  test('the password never outlives a post-commit failure either', async () => {
    const { deps, session } = setup({ onAccountCreatedError: new Error('network') })
    await runCreateAccount(deps)
    expect(session.password).toBe('')
  })

  test('register-start fails BEFORE the account exists: retryable, ceremony rolled back once', async () => {
    const { deps, calls } = setup({ registerStartError: new ActionError('network', 'down') })
    expect(await runCreateAccount(deps)).toEqual({ kind: 'failed_before_account', rateLimited: false })
    expect(calls.filter((c) => c === 'registrationFailed').length).toBe(1)
    expect(calls).not.toContain('registerFinish')
  })

  test('register-finish itself fails: still before the account exists, retryable, password kept for the retry', async () => {
    const { deps, calls, session } = setup({ registerFinishError: new ActionError('rate_limited', 'slow down') })
    expect(await runCreateAccount(deps)).toEqual({ kind: 'failed_before_account', rateLimited: true })
    expect(calls.filter((c) => c === 'registrationFailed').length).toBe(1)
    expect(session.password).toBe('Correct-Horse-Battery-9')
  })

  test('an expired ticket at register-finish goes back to the code step, not to an error', async () => {
    const { deps, calls, session } = setup({ registerFinishError: new ActionError('signup_ticket_invalid', 'expired') })
    expect(await runCreateAccount(deps)).toEqual({ kind: 'ticket_invalid' })
    expect(calls).toContain('emailTicketInvalidated')
    expect(calls).not.toContain('registrationFailed')
    expect(session.ticket).toBe('')
  })
})
