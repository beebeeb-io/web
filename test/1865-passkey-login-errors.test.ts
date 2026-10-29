import { describe, expect, test } from 'bun:test'
import { passkeyLoginErrorMessage, PASSKEY_LOGIN_NEUTRAL } from '../src/lib/passkey-errors'

function dom(name: string, message: string): Error {
  const e = new Error(message)
  e.name = name
  return e
}

describe('passkeyLoginErrorMessage (task 1865)', () => {
  const RAW = 'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.'

  test('NotAllowedError maps to the account-neutral sentence, not the raw browser text', () => {
    const msg = passkeyLoginErrorMessage(dom('NotAllowedError', RAW))
    expect(msg).toBe(PASSKEY_LOGIN_NEUTRAL)
    expect(msg).not.toContain('operation')
  })

  test('AbortError and TimeoutError map to the same sentence', () => {
    expect(passkeyLoginErrorMessage(dom('AbortError', 'aborted'))).toBe(PASSKEY_LOGIN_NEUTRAL)
    expect(passkeyLoginErrorMessage(dom('TimeoutError', 'timed out'))).toBe(PASSKEY_LOGIN_NEUTRAL)
  })

  test('the sentence never says whether the account or a passkey exists', () => {
    expect(PASSKEY_LOGIN_NEUTRAL).not.toMatch(/no (such )?account|not registered|does not exist|has no passkey|no passkeys? (registered|found)/i)
  })

  test('other errors keep their own (server) message; non-errors get a plain fallback', () => {
    expect(passkeyLoginErrorMessage(new Error('Too many attempts. Try again later.'))).toBe('Too many attempts. Try again later.')
    expect(passkeyLoginErrorMessage(new Error('  '))).toBe('Passkey sign-in failed. Please try again.')
    expect(passkeyLoginErrorMessage('x')).toBe('Passkey sign-in failed. Please try again.')
  })
})
